// Live end-to-end check for grayson-realtime matchmaking + signaling, run against
// a real server (default: production). Uses Node 22's global WebSocket — no deps.
//
//   node server/livecheck.mjs                 # default wss://api.graysongames.com/rt
//   RT=ws://127.0.0.1:8090 node server/livecheck.mjs   # against a local instance
//
// Scenarios:
//   1. positive : two soccer 'quick' clients must pair (complementary roles, equal
//      seed) and relay a signal blob to each other.
//   2. crossgame: a soccer 'quick' client and a bball 'quick' client must NOT pair.
//   3. legacy   : two NO-game 'challenge' clients (the basketball client's shape)
//      must still pair — proves backward compatibility.
const RT = process.env.RT || 'wss://api.graysongames.com/rt';
const T = (ms) => new Promise((r) => setTimeout(r, ms));

function client(label) {
  const ws = new WebSocket(RT);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    inbox.push(m);
    const w = waiters.shift();
    if (w) w(m);
  });
  return {
    label, ws,
    open: () => new Promise((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true });
      ws.addEventListener('error', () => rej(new Error(`${label}: ws error`)), { once: true });
    }),
    send: (o) => ws.send(JSON.stringify(o)),
    // wait for next message of a type (or any) within ms; null on timeout
    next: (type, ms = 4000) => Promise.race([
      new Promise((res) => {
        const hit = inbox.find((m) => !type || m.type === type);
        if (hit) { inbox.splice(inbox.indexOf(hit), 1); return res(hit); }
        waiters.push((m) => { if (!type || m.type === type) res(m); else res(null); });
      }),
      T(ms).then(() => null),
    ]),
    close: () => { try { ws.close(); } catch {} },
  };
}

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function positive() {
  console.log('\n— scenario: positive (two soccer quick) —');
  const a = client('A'), b = client('B');
  await Promise.all([a.open(), b.open()]);
  a.send({ type: 'queue', game: 'soccer', mode: 'quick' });
  await T(150);
  b.send({ type: 'queue', game: 'soccer', mode: 'quick' });
  const [ma, mb] = await Promise.all([a.next('matched'), b.next('matched')]);
  ok(!!ma && !!mb, 'both clients received matched');
  if (ma && mb) {
    ok(ma.seed === mb.seed, `shared seed (${ma.seed} === ${mb.seed})`);
    ok(ma.role !== mb.role && ['host', 'guest'].includes(ma.role), `complementary roles (${ma.role}/${mb.role})`);
    // relay: A → B
    a.send({ type: 'signal', data: { hello: 'world' } });
    const sig = await b.next('signal');
    ok(!!sig && sig.data && sig.data.hello === 'world', 'signal relayed A→B verbatim');
  }
  a.close(); b.close();
  await T(150);
}

async function crossgame() {
  console.log('\n— scenario: crossgame (soccer vs bball, same mode) —');
  const a = client('soccer'), b = client('bball');
  await Promise.all([a.open(), b.open()]);
  a.send({ type: 'queue', game: 'soccer', mode: 'quick' });
  b.send({ type: 'queue', game: 'bball', mode: 'quick' });
  const [ma, mb] = await Promise.all([a.next('matched', 2500), b.next('matched', 2500)]);
  ok(ma === null && mb === null, 'soccer and bball did NOT cross-match');
  a.close(); b.close();
  await T(150);
}

async function legacy() {
  console.log('\n— scenario: legacy (no game field, mode challenge) —');
  const a = client('L1'), b = client('L2');
  await Promise.all([a.open(), b.open()]);
  a.send({ type: 'queue', mode: 'challenge' });
  await T(150);
  b.send({ type: 'queue', mode: 'challenge' });
  const [ma, mb] = await Promise.all([a.next('matched'), b.next('matched')]);
  ok(!!ma && !!mb, 'legacy no-game clients still pair');
  if (ma && mb) ok(ma.seed === mb.seed, `shared seed (${ma.seed})`);
  a.close(); b.close();
  await T(150);
}

const which = process.argv[2] || 'all';
console.log(`livecheck → ${RT}  (scenario: ${which})`);
try {
  if (which === 'all' || which === 'positive') await positive();
  if (which === 'all' || which === 'crossgame') await crossgame();
  if (which === 'all' || which === 'legacy') await legacy();
} catch (e) {
  console.log('FAIL  threw:', e.message);
  failures++;
}
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
