// Grayson Games API — shared by basketball + soccer. Validates a Supabase user token,
// then reads/writes that user's per-game save via PostgREST with the service_role key.
// Sport-agnostic: the game is the `:game` path segment ('bball' | 'soccer'); the save
// body is an opaque jsonb blob, so soccer reuses this endpoint unchanged.
import Fastify from 'fastify';
import { iceServers } from './turn.mjs';
import { createPayPalOrder, grantProductToSaveData, purchaseGrant, readCaptureId, paypalAccessToken } from './paypalPurchase.mjs';
import { productBySku } from './paypalProducts.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, TURN_SECRET } = process.env;
const TURN_HOST = process.env.TURN_HOST || 'turn.graysongames.com';
const GAMES = new Set(['bball', 'soccer']);
const app = Fastify({ logger: false });

// permissive CORS — auth is via bearer token (no cookies), so `*` is safe
app.addHook('onRequest', async (req, reply) => {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-methods', 'GET,PUT,POST,OPTIONS');
  reply.header('access-control-allow-headers', 'authorization,content-type');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

/** validate a Supabase access token → user id (or null) */
async function userId(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: authHeader },
  });
  if (!r.ok) return null;
  return (await r.json())?.id ?? null;
}

const sbHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'content-type': 'application/json',
};

app.get('/health', async () => ({ ok: true, service: 'grayson-api', ts: Date.now() }));

function eq(value) {
  return encodeURIComponent(String(value));
}

async function insertPurchase(uid, game, product, orderId) {
  const grant = purchaseGrant(product, orderId);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({
      user_id: uid,
      game_id: game,
      provider: 'paypal',
      provider_order_id: orderId,
      sku: product.sku,
      amount: product.amount,
      currency: product.currency,
      status: 'created',
      grant,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok && r.status !== 409) throw new Error(await r.text());
  return grant;
}

async function purchaseByOrder(uid, game, orderId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${eq(uid)}&game_id=eq.${eq(game)}&provider=eq.paypal&provider_order_id=eq.${eq(orderId)}&select=*`,
    { headers: sbHeaders },
  );
  if (!r.ok) throw new Error(await r.text());
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function completePurchase(orderId, captureId, grant) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?provider=eq.paypal&provider_order_id=eq.${eq(orderId)}`,
    {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({
        provider_capture_id: captureId,
        status: 'completed',
        grant,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!r.ok) throw new Error(await r.text());
}

async function applyGrantToCloudSave(uid, game, product, purchaseId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/saves?user_id=eq.${eq(uid)}&game_id=eq.${eq(game)}&mode=eq.stars&slot=eq.main&select=data,updated_at`,
    { headers: sbHeaders },
  );
  if (!r.ok) return;
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.data) return;
  const granted = grantProductToSaveData(row.data, product, purchaseId);
  if (!granted.changed) return;
  await fetch(`${SUPABASE_URL}/rest/v1/saves`, {
    method: 'POST',
    headers: { ...sbHeaders, prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: uid,
      game_id: game,
      mode: 'stars',
      slot: 'main',
      data: granted.data,
      updated_at: new Date().toISOString(),
    }),
  });
}

// GET /api/turn → { iceServers, ttl }. Ephemeral coturn creds the WebRTC client
// drops straight into its RTCPeerConnection. Auth is optional: a valid bearer
// token binds the creds to that user (accountability) but is not required, so
// guests can still establish a relay.
app.get('/api/turn', async (req) => {
  const uid = await userId(req.headers.authorization).catch(() => null);
  return iceServers({ secret: TURN_SECRET, host: TURN_HOST, userId: uid ?? undefined });
});

app.post('/api/:game/paypal/orders', async (req, reply) => {
  if (!GAMES.has(req.params.game)) return reply.code(404).send({ error: 'unknown game' });
  const uid = await userId(req.headers.authorization);
  if (!uid) return reply.code(401).send({ error: 'unauthorized' });
  const sku = String(req.body?.sku ?? '');
  try {
    const created = await createPayPalOrder({ sku, userId: uid, game: req.params.game });
    if (!created.ok) return reply.code(created.status).send({ error: created.error });
    const grant = await insertPurchase(uid, req.params.game, created.product, created.order.id);
    return { ok: true, orderId: created.order.id, grant };
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : 'paypal order failed' });
  }
});

app.post('/api/:game/paypal/orders/:orderId/capture', async (req, reply) => {
  if (!GAMES.has(req.params.game)) return reply.code(404).send({ error: 'unknown game' });
  const uid = await userId(req.headers.authorization);
  if (!uid) return reply.code(401).send({ error: 'unauthorized' });
  const orderId = String(req.params.orderId ?? '');
  try {
    const purchase = await purchaseByOrder(uid, req.params.game, orderId);
    if (!purchase) return reply.code(404).send({ error: 'unknown purchase' });
    const product = productBySku(purchase.sku);
    if (!product) return reply.code(409).send({ error: 'unknown sku' });
    const grant = purchase.grant ?? purchaseGrant(product, orderId);
    if (purchase.status === 'completed') return { ok: true, alreadyGranted: true, grant };

    const token = await paypalAccessToken();
    const captureRes = await fetch(`${process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const captureBody = await captureRes.json();
    if (!captureRes.ok || captureBody.status !== 'COMPLETED') {
      return reply.code(502).send({ error: 'paypal capture failed' });
    }
    const captureId = readCaptureId(captureBody);
    if (!captureId) return reply.code(502).send({ error: 'paypal capture missing id' });

    await applyGrantToCloudSave(uid, req.params.game, product, orderId);
    await completePurchase(orderId, captureId, grant);
    return { ok: true, alreadyGranted: false, grant };
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : 'paypal capture failed' });
  }
});

// GET /api/:game/save  → { data: <blob|null> }
app.get('/api/:game/save', async (req, reply) => {
  if (!GAMES.has(req.params.game)) return reply.code(404).send({ error: 'unknown game' });
  const uid = await userId(req.headers.authorization);
  if (!uid) return reply.code(401).send({ error: 'unauthorized' });
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/saves?user_id=eq.${uid}&game_id=eq.${req.params.game}&select=data`,
    { headers: sbHeaders },
  );
  const rows = await r.json();
  return { data: Array.isArray(rows) && rows[0] ? rows[0].data : null };
});

// PUT /api/:game/save  body { data: {...} } → { ok: true }
app.put('/api/:game/save', async (req, reply) => {
  if (!GAMES.has(req.params.game)) return reply.code(404).send({ error: 'unknown game' });
  const uid = await userId(req.headers.authorization);
  if (!uid) return reply.code(401).send({ error: 'unauthorized' });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/saves`, {
    method: 'POST',
    headers: { ...sbHeaders, prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: uid, game_id: req.params.game,
      data: req.body?.data ?? {}, updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) return reply.code(502).send({ error: 'save failed', detail: await r.text() });
  return { ok: true };
});

app.listen({ port: 8080, host: '127.0.0.1' }).catch((e) => { console.error(e); process.exit(1); });
