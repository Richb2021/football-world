import { Buffer } from 'node:buffer';
import { paypalAmount, productBySku } from './paypalProducts.mjs';

export function isWrappedSaveData(data) {
  return Boolean(data && typeof data === 'object' && 'payload' in data && 'meta' in data);
}

export function starsPayloadFromSaveData(data) {
  if (!data || typeof data !== 'object') return null;
  const payload = isWrappedSaveData(data) ? data.payload : data;
  if (!payload || typeof payload !== 'object' || payload.version !== 1) return null;
  return payload;
}

export function grantProductToSaveData(saveData, product, purchaseId) {
  const payload = starsPayloadFromSaveData(saveData);
  if (!payload) return { changed: false, data: saveData, reason: 'no-stars-save' };

  payload.purchaseIds ??= [];
  if (payload.purchaseIds.includes(purchaseId)) {
    return { changed: false, data: saveData, reason: 'duplicate' };
  }

  payload.coins = Math.max(0, Math.floor(payload.coins ?? 0) + Math.max(0, Math.floor(product.coins ?? 0)));
  payload.arcadeTokens ??= { balance: 0, lastDailyGrantDay: '', lastWeeklyGrantWeek: '' };
  payload.arcadeTokens.balance = Math.max(0, Math.floor(payload.arcadeTokens.balance ?? 0) + Math.max(0, Math.floor(product.tokens ?? 0)));
  payload.purchaseIds.push(purchaseId);
  return { changed: true, data: saveData };
}

export function purchaseGrant(product, purchaseId) {
  return {
    purchaseId,
    sku: product.sku,
    coins: product.coins,
    tokens: product.tokens,
  };
}

export function paypalBaseUrl() {
  return process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export async function paypalAccessToken(fetchImpl = fetch) {
  const client = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!client || !secret) throw new Error('PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET missing');

  const auth = Buffer.from(`${client}:${secret}`).toString('base64');
  const response = await fetchImpl(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`paypal token failed: ${response.status}`);
  }
  return body.access_token;
}

export async function createPayPalOrder({ sku, userId, game, fetchImpl = fetch }) {
  const product = productBySku(sku);
  if (!product) return { ok: false, status: 400, error: 'unknown sku' };

  const token = await paypalAccessToken(fetchImpl);
  const response = await fetchImpl(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: product.sku,
        custom_id: JSON.stringify({ userId, game, sku: product.sku }).slice(0, 127),
        description: product.name,
        amount: paypalAmount(product),
      }],
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.id) {
    return { ok: false, status: 502, error: 'paypal order failed', detail: body };
  }
  return { ok: true, product, order: body };
}

export function readCaptureId(paypalCaptureBody) {
  const units = paypalCaptureBody?.purchase_units;
  const captures = Array.isArray(units)
    ? units.flatMap((unit) => unit?.payments?.captures ?? [])
    : [];
  return captures[0]?.id ?? null;
}
