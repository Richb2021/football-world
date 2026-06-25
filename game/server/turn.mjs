// Grayson Games TURN credentials — ephemeral coturn long-term creds.
//
// coturn is configured with `use-auth-secret` + a shared `static-auth-secret`
// (== this process's TURN_SECRET). Under that scheme the TURN username is an
// expiry unix-timestamp (optionally `<expiry>:<userId>`) and the password is
// base64(HMAC-SHA1(secret, username)). Clients fetch these from /api/turn and
// pass them verbatim into their RTCPeerConnection iceServers — the shared secret
// itself never reaches the browser. This is the well-known coturn REST API.
import { createHmac } from 'node:crypto';

/**
 * @param {object} o
 * @param {string} o.secret  shared static-auth-secret (== coturn's)
 * @param {number} [o.ttlSec] credential lifetime in seconds (default 1h)
 * @param {number} [o.now]    current epoch ms (injectable for tests)
 * @param {string} [o.userId] optional user binding, folded into the username
 * @returns {{username:string, credential:string, ttl:number}|null} null if no secret
 */
export function turnCredentials({ secret, ttlSec = 3600, now = Date.now(), userId } = {}) {
  if (!secret) return null;
  const expiry = Math.floor(now / 1000) + ttlSec;
  const username = userId ? `${expiry}:${userId}` : String(expiry);
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, ttl: ttlSec };
}

/**
 * Build an RTCPeerConnection-ready iceServers list: a STUN entry plus TURN
 * (udp+tcp) and TURNS (tls) entries carrying ephemeral creds. STUN is always
 * present; TURN entries are added only when a secret is configured.
 * @returns {{iceServers:RTCIceServer[], ttl:number}}
 */
export function iceServers({ secret, host = 'turn.graysongames.com', ttlSec, now, userId } = {}) {
  const cred = turnCredentials({ secret, ttlSec, now, userId });
  const servers = [{ urls: [`stun:${host}:3478`] }];
  if (cred) {
    servers.push({
      urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`],
      username: cred.username,
      credential: cred.credential,
    });
    servers.push({
      urls: [`turns:${host}:5349?transport=tcp`],
      username: cred.username,
      credential: cred.credential,
    });
  }
  return { iceServers: servers, ttl: cred?.ttl ?? 0 };
}
