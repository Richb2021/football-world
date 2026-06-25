// Server-backed real-time transport for head-to-head play.
//
// Handshake (against grayson-realtime, wss://api.graysongames.com/rt):
//   1. open WS, send {type:'queue', game:'soccer', mode}
//   2. server pairs two players → {type:'matched', role, seed} to both
//   3. host creates an RTCDataChannel + offer; SDP/ICE relay verbatim through the
//      WS as {type:'signal', data}; guest answers
//   4. once the data channel opens we run host-authoritative play P2P over it,
//      reusing the exact NetMsg protocol from online.ts
//
// The signaling WS is KEPT OPEN for the whole match as a presence channel: the
// server tears the room down and notifies the peer with {type:'peerLeft'} when a
// socket closes, so closing early would falsely drop a live match. A lightweight
// app-level ping keeps the proxy connection warm.
import { fetchIceServers, RT_URL } from './config';
import type { NetMsg } from './online';
import type { NetTransport } from './transport';

export type Role = 'host' | 'guest';

type SignalData =
  | { sdp: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null };

type ServerMsg =
  | { type: 'matched'; roomId: string; role: Role; seed: number }
  | { type: 'signal'; data: SignalData }
  | { type: 'peerLeft' }
  | { type: 'pong' }
  | { type: 'error'; error: string };

export interface MatchResult {
  session: RtcSession;
  role: Role;
  seed: number;
}

export interface ConnectOpts {
  onStatus?: (s: string) => void;
}
export interface HostOpts extends ConnectOpts {
  onCode?: (code: string) => void;
}

const CONNECT_TIMEOUT_MS = 45000;
const PING_MS = 25000;

export class RtcSession implements NetTransport {
  onMessage: ((m: NetMsg) => void) | null = null;
  role: Role = 'host';
  seed = 0;

  private _onClose: (() => void) | null = null;
  private closeNotified = false;
  private pendingClose = false;
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private connected = false; // data channel open
  private closed = false;

  private constructor() {}

  /** The consumer assigns onClose only after connect() resolves; if a disconnect
   *  already landed in that microtask window it is replayed on assignment. */
  get onClose(): (() => void) | null {
    return this._onClose;
  }
  set onClose(fn: (() => void) | null) {
    this._onClose = fn;
    if (fn && this.pendingClose && !this.closeNotified && !this.closed) {
      this.closeNotified = true;
      fn();
    }
  }

  /** Fire onClose at most once for a remote-initiated teardown. Several signals
   *  (peerLeft, ws close, channel close, connection-state) can all observe the
   *  same drop — this collapses them into a single consumer notification. A
   *  locally-initiated close() suppresses it (the consumer already knows). */
  private notifyClosed(): void {
    if (this.closeNotified || this.closed) return;
    if (this._onClose) {
      this.closeNotified = true;
      this._onClose();
    } else {
      this.pendingClose = true;
    }
  }

  /** Quick match: queue for a public mode and let the server pair you. */
  static quickMatch(mode = 'quick', opts: ConnectOpts = {}): Promise<MatchResult> {
    return RtcSession.connect(mode, opts);
  }

  /** Host a private friend room. The generated code is handed back via onCode;
   *  the promise resolves when a friend joins with the same code. */
  static privateHost(opts: HostOpts = {}): Promise<MatchResult> {
    const code = makeCode();
    opts.onCode?.(code);
    return RtcSession.connect(`code:${code}`, opts);
  }

  /** Join a friend's private room by code. */
  static privateJoin(code: string, opts: ConnectOpts = {}): Promise<MatchResult> {
    return RtcSession.connect(`code:${code.trim().toUpperCase()}`, opts);
  }

  private static async connect(mode: string, opts: ConnectOpts): Promise<MatchResult> {
    const iceServers = await fetchIceServers();
    const session = new RtcSession();
    return new Promise<MatchResult>((resolve, reject) => {
      let settled = false;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.close();
        reject(e);
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.connected = true;
        resolve({ session, role: session.role, seed: session.seed });
      };
      const timeout = setTimeout(
        () => fail(new Error('Match timed out — please try again')),
        CONNECT_TIMEOUT_MS,
      );

      const ws = new WebSocket(RT_URL);
      session.ws = ws;

      ws.onopen = (): void => {
        opts.onStatus?.('Searching for an opponent…');
        ws.send(JSON.stringify({ type: 'queue', game: 'soccer', mode }));
        session.startPing();
      };
      ws.onerror = (): void => { if (!session.connected) fail(new Error('Could not reach the matchmaking server')); };
      ws.onclose = (): void => {
        session.stopPing();
        // Only matters during setup. Once the P2P data channel is up, the
        // signaling socket is irrelevant — mobile networks routinely drop it
        // while the data channel stays live, so its close must NOT end the match.
        if (!session.connected) fail(new Error('Disconnected from matchmaking'));
      };
      ws.onmessage = (ev: MessageEvent): void => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMsg;
        } catch {
          return;
        }
        switch (msg.type) {
          case 'error':
            fail(new Error(msg.error || 'matchmaking error'));
            break;
          case 'matched':
            session.role = msg.role;
            session.seed = msg.seed;
            opts.onStatus?.('Opponent found — connecting…');
            void session.beginWebrtc(iceServers, succeed, fail);
            break;
          case 'signal':
            void session.onSignal(msg.data);
            break;
          case 'peerLeft':
            // Before connect: the opponent abandoned matchmaking → fail.
            // After connect: this only means their SIGNALING socket dropped, not
            // that they left the match (the P2P data channel may be fine). A real
            // in-match disconnect surfaces via the data channel close / pc failure.
            if (!session.connected) fail(new Error('Opponent left before the match started'));
            break;
          default:
            break; // pong / unknown
        }
      };
    });
  }

  private async beginWebrtc(
    iceServers: RTCIceServer[],
    onConnected: () => void,
    fail: (e: Error) => void,
  ): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc; // set synchronously, before any await, so onSignal never races ahead

    pc.onicecandidate = (e: RTCPeerConnectionIceEvent): void => {
      this.sendSignal({ candidate: e.candidate ? e.candidate.toJSON() : null });
    };
    pc.onconnectionstatechange = (): void => {
      const st = pc.connectionState;
      // 'disconnected' is deliberately NOT treated as terminal — ICE frequently
      // recovers from it; channel-close + the server's peerLeft are the fast,
      // reliable drop signals. 'failed'/'closed' are terminal.
      if (st === 'failed' || st === 'closed') {
        if (this.connected) this.notifyClosed();
        else fail(new Error('Could not establish a connection'));
      }
    };

    const wire = (ch: RTCDataChannel): void => {
      this.channel = ch;
      ch.onopen = (): void => onConnected();
      ch.onmessage = (e: MessageEvent): void => {
        let m: NetMsg;
        try {
          m = JSON.parse(typeof e.data === 'string' ? e.data : '') as NetMsg;
        } catch {
          return;
        }
        this.onMessage?.(m);
      };
      ch.onclose = (): void => {
        if (this.connected) this.notifyClosed();
      };
    };

    if (this.role === 'host') {
      wire(pc.createDataChannel('game', { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({ sdp: offer });
    } else {
      pc.ondatachannel = (e: RTCDataChannelEvent): void => wire(e.channel);
      // the host's offer arrives via onSignal
    }
  }

  private async onSignal(data: SignalData): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    if ('sdp' in data && data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      this.remoteSet = true;
      const queued = this.pendingCandidates.splice(0);
      for (const c of queued) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* stale candidate — ignore */
        }
      }
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal({ sdp: answer });
      }
    } else if ('candidate' in data) {
      if (!data.candidate) return; // end-of-candidates marker
      if (this.remoteSet) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          /* ignore */
        }
      } else {
        this.pendingCandidates.push(data.candidate); // buffer until remote desc set
      }
    }
  }

  private sendSignal(data: SignalData): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', data }));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(m: NetMsg): void {
    const ch = this.channel;
    if (ch && ch.readyState === 'open') {
      try {
        ch.send(JSON.stringify(m));
      } catch (e) {
        console.warn('rtc send failed', e);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    try {
      this.send({ k: 'bye' });
    } catch {
      /* channel may already be gone */
    }
    try { this.channel?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.channel = null;
    this.pc = null;
    this.ws = null;
  }
}

function makeCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
