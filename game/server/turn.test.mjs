// Tests for server/turn.mjs — coturn REST-API ephemeral TURN credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { turnCredentials, iceServers } from './turn.mjs';

const SECRET = 'test-static-auth-secret';
// Fixed clock: 1_700_000_000_000 ms => floor(/1000) = 1_700_000_000 s.
const NOW = 1_700_000_000_000;
const NOW_SEC = Math.floor(NOW / 1000); // 1700000000

// INDEPENDENT reference implementation of the coturn password:
// base64(HMAC-SHA1(secret, username)).
function expectedCredential(secret, username) {
  return createHmac('sha1', secret).update(username).digest('base64');
}

test('turnCredentials: username is the expiry timestamp when no userId', () => {
  const ttlSec = 3600;
  const c = turnCredentials({ secret: SECRET, ttlSec, now: NOW });
  assert.ok(c);
  const expiry = NOW_SEC + ttlSec;
  assert.equal(c.username, String(expiry), 'username == floor(now/1000)+ttlSec');
  assert.equal(c.ttl, ttlSec, 'ttl is propagated');

  // Credential must match an independently computed HMAC-SHA1 base64.
  assert.equal(c.credential, expectedCredential(SECRET, c.username));
});

test('turnCredentials: username is "<expiry>:<userId>" when userId given', () => {
  const ttlSec = 1200;
  const userId = 'player-42';
  const c = turnCredentials({ secret: SECRET, ttlSec, now: NOW, userId });
  assert.ok(c);
  const expiry = NOW_SEC + ttlSec;
  assert.equal(c.username, `${expiry}:${userId}`);
  assert.equal(c.ttl, ttlSec);

  // Independent HMAC over the EXACT username (including the userId segment).
  assert.equal(c.credential, expectedCredential(SECRET, `${expiry}:${userId}`));
});

test('turnCredentials: defaults ttlSec to 3600', () => {
  const c = turnCredentials({ secret: SECRET, now: NOW });
  assert.ok(c);
  assert.equal(c.ttl, 3600);
  assert.equal(c.username, String(NOW_SEC + 3600));
  assert.equal(c.credential, expectedCredential(SECRET, c.username));
});

test('turnCredentials: returns null when secret is falsy', () => {
  assert.equal(turnCredentials({ secret: '', now: NOW }), null);
  assert.equal(turnCredentials({ secret: undefined, now: NOW }), null);
  assert.equal(turnCredentials({ secret: null, now: NOW }), null);
  assert.equal(turnCredentials({}), null, 'no secret at all => null');
});

test('iceServers: always includes a stun: entry (even without a secret)', () => {
  const { iceServers: servers, ttl } = iceServers({ now: NOW });
  assert.ok(Array.isArray(servers));
  // Exactly one entry — the stun one — when there is no secret.
  assert.equal(servers.length, 1, 'only STUN when no secret');
  const stun = servers[0];
  assert.deepEqual(stun.urls, ['stun:turn.graysongames.com:3478']);
  assert.equal(stun.username, undefined, 'STUN entry carries no creds');
  assert.equal(stun.credential, undefined);
  assert.equal(ttl, 0, 'ttl is 0 when no credentials are issued');
});

test('iceServers: with a secret, includes stun + turn(udp+tcp) + turns, sharing creds', () => {
  const ttlSec = 3600;
  const userId = 'u-7';
  const { iceServers: servers, ttl } = iceServers({
    secret: SECRET,
    ttlSec,
    now: NOW,
    userId,
  });

  // The independent credentials we expect every TURN/TURNS entry to carry.
  const cred = turnCredentials({ secret: SECRET, ttlSec, now: NOW, userId });
  assert.ok(cred);
  assert.equal(ttl, ttlSec, 'ttl propagated from credentials');

  // STUN (no creds).
  const stun = servers.find((s) => s.urls.some((u) => u.startsWith('stun:')));
  assert.ok(stun, 'stun entry present');
  assert.equal(stun.username, undefined);

  // TURN entry carries udp + tcp transports and the shared creds.
  const turn = servers.find((s) => s.urls.some((u) => u.startsWith('turn:')));
  assert.ok(turn, 'turn entry present');
  assert.deepEqual(turn.urls, [
    'turn:turn.graysongames.com:3478?transport=udp',
    'turn:turn.graysongames.com:3478?transport=tcp',
  ]);
  assert.equal(turn.username, cred.username, 'turn carries same username');
  assert.equal(turn.credential, cred.credential, 'turn carries same credential');

  // TURNS (tls) entry carries the SAME creds.
  const turns = servers.find((s) => s.urls.some((u) => u.startsWith('turns:')));
  assert.ok(turns, 'turns entry present');
  assert.deepEqual(turns.urls, ['turns:turn.graysongames.com:5349?transport=tcp']);
  assert.equal(turns.username, cred.username, 'turns carries same username');
  assert.equal(turns.credential, cred.credential, 'turns carries same credential');

  // Independent check: the shared credential really is the coturn HMAC.
  assert.equal(turn.credential, expectedCredential(SECRET, cred.username));
  assert.equal(turns.credential, expectedCredential(SECRET, cred.username));

  // stun + turn + turns => 3 entries.
  assert.equal(servers.length, 3);
});

test('iceServers: host defaults to turn.graysongames.com', () => {
  const { iceServers: servers } = iceServers({ secret: SECRET, now: NOW });
  for (const s of servers) {
    for (const u of s.urls) {
      assert.ok(
        u.includes('turn.graysongames.com'),
        `url ${u} should use the default host`,
      );
    }
  }
});

test('iceServers: a custom host is honoured across all entries', () => {
  const host = 'turn.example.test';
  const { iceServers: servers } = iceServers({ secret: SECRET, host, now: NOW });
  assert.deepEqual(servers[0].urls, [`stun:${host}:3478`]);
  assert.deepEqual(servers[1].urls, [
    `turn:${host}:3478?transport=udp`,
    `turn:${host}:3478?transport=tcp`,
  ]);
  assert.deepEqual(servers[2].urls, [`turns:${host}:5349?transport=tcp`]);
});
