// Grayson Games realtime — WebSocket signaling + matchmaking for P2P head-to-head.
// Wraps the pure matchmaking core (matchmaking.mjs) with a `ws` server. Players
// queue for a mode, get paired into a room, then relay WebRTC signaling blobs to
// each other through this server; once connected they talk peer-to-peer directly.
//
// ── DEPLOY ──────────────────────────────────────────────────────────────────
//   Install deps once on the box:   cd server && npm install   (pulls in `ws`)
//   Run:                            node realtime.mjs
//   Port:                           process.env.RT_PORT, default 8090.
//   It sits behind the SAME nginx as api.mjs — either reverse-proxy a `/rt`
//   location to ws://127.0.0.1:8090 (with the Upgrade/Connection headers set so
//   WebSockets pass through), or expose :8090 directly. Run it under the same
//   process manager (pm2/systemd) as api.mjs.
//   TURN: coturn (separate service) provides the TURN/STUN relay clients use for
//   NAT traversal; this server only does signaling, never media.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createMatchmaker } from './matchmaking.mjs';

const PORT = Number(process.env.RT_PORT) || 8090;

// Injected sources keep matchmaking.mjs pure: stable room ids + 31-bit int seeds
// (mulberry32-friendly, matching the sim's seed shape).
const mm = createMatchmaker({
  nextRoomId: () => randomUUID(),
  nextSeed: () => (Math.random() * 0x7fffffff) | 0,
});

// playerId -> live socket, so we can push to a peer by id.
const sockets = new Map();

function send(playerId, msg) {
  const ws = sockets.get(playerId);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  const playerId = randomUUID();
  ws.playerId = playerId;
  ws.token = null;
  sockets.set(playerId, ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'queue': {
        ws.token = msg.token ?? null; // stored for now; not yet validated
        ws.game = typeof msg.game === 'string' ? msg.game : undefined;
        let room;
        try {
          // game defaults to 'bball' inside the matchmaker for the legacy client;
          // the soccer client always sends game:'soccer' so the two never cross-match.
          room = mm.enqueue(playerId, msg.mode, ws.game);
        } catch {
          send(playerId, { type: 'error', error: 'unknown mode' });
          return;
        }
        if (room) {
          // notify both peers with their role + the shared seed
          for (const p of room.players) {
            send(p.id, { type: 'matched', roomId: room.roomId, role: p.role, seed: room.seed });
          }
        }
        break;
      }
      case 'signal': {
        // relay the opaque signaling blob verbatim to the other peer
        const peer = mm.peerOf(playerId);
        if (peer) send(peer.id, { type: 'signal', data: msg.data });
        break;
      }
      case 'cancel': {
        mm.dequeue(playerId);
        break;
      }
      case 'ping': {
        // keepalive: peers hold this signaling socket open for the whole match
        // (it doubles as presence — close ⇒ peerLeft), so keep it warm through
        // the proxy's idle timeout in both directions.
        send(playerId, { type: 'pong' });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    const result = mm.remove(playerId); // frees queue + tears down room
    if (result?.peer) send(result.peer.id, { type: 'peerLeft' });
    sockets.delete(playerId);
  });

  ws.on('error', () => { /* close handler does the cleanup */ });
});

console.log(`grayson-realtime listening on :${PORT} (ws signaling + matchmaking)`);
