import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// rtc.ts negotiates over a signaling WebSocket and an RTCPeerConnection/
// RTCDataChannel, both of which it pulls off the global scope at call time.
// Vitest runs in node with no DOM, so we install minimal, fully-controllable
// fakes as globals and drive the handshake by hand. fetchIceServers (pulled in
// via the config import) does a global fetch, so that is stubbed too.
//
// The session code is async (createOffer/createAnswer/set*Description all
// await), so after firing an event we `await flush()` to let those microtask
// chains run to completion before asserting.
// ---------------------------------------------------------------------------

import { RtcSession } from '../rtc';

/** Drain the microtask queue a few times so chained awaits settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// FakeWebSocket — records every JSON-parsed message it is asked to send and
// exposes helpers so the test can fire open / message / close at will. The most
// recently constructed instance is captured on the constructor for the test to
// grab.
// ---------------------------------------------------------------------------

interface OutMsg {
  type: string;
  [k: string]: unknown;
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;

  url: string;
  readyState = FakeWebSocket.OPEN;
  sent: OutMsg[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as OutMsg);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // --- test drivers -------------------------------------------------------
  fireOpen(): void {
    this.onopen?.();
  }
  fireMessage(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  fireClose(): void {
    this.onclose?.();
  }
  fireError(): void {
    this.onerror?.();
  }

  /** Most-recent signal payload of a given shape pushed onto the wire. */
  signalsSent(): unknown[] {
    return this.sent.filter((m) => m.type === 'signal').map((m) => m.data);
  }
}

// ---------------------------------------------------------------------------
// FakeRTCDataChannel
// ---------------------------------------------------------------------------

class FakeRTCDataChannel {
  label: string;
  readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(label: string) {
    this.label = label;
  }

  send(raw: string): void {
    this.sent.push(raw);
  }
  close(): void {
    this.readyState = 'closed';
  }

  // --- test drivers -------------------------------------------------------
  fireOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
  fireMessage(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  fireClose(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

// ---------------------------------------------------------------------------
// FakeRTCPeerConnection — records calls so the test can assert ordering of
// setRemoteDescription vs addIceCandidate (the ICE-buffering case).
// ---------------------------------------------------------------------------

interface PcCall {
  op: string;
  arg?: unknown;
}

class FakeRTCPeerConnection {
  static last: FakeRTCPeerConnection | null = null;

  calls: PcCall[] = [];
  localChannel: FakeRTCDataChannel | null = null;
  connectionState: RTCPeerConnectionState = 'new';

  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: FakeRTCDataChannel }) => void) | null = null;

  constructor(_config?: RTCConfiguration) {
    FakeRTCPeerConnection.last = this;
  }

  createDataChannel(label: string): FakeRTCDataChannel {
    this.calls.push({ op: 'createDataChannel', arg: label });
    this.localChannel = new FakeRTCDataChannel(label);
    return this.localChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.calls.push({ op: 'createOffer' });
    return { type: 'offer', sdp: 'OFFER_SDP' };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.calls.push({ op: 'createAnswer' });
    return { type: 'answer', sdp: 'ANSWER_SDP' };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.calls.push({ op: 'setLocalDescription', arg: desc });
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.calls.push({ op: 'setRemoteDescription', arg: desc });
  }
  async addIceCandidate(c: unknown): Promise<void> {
    this.calls.push({ op: 'addIceCandidate', arg: c });
  }

  close(): void {
    this.calls.push({ op: 'close' });
  }

  opsOf(op: string): PcCall[] {
    return this.calls.filter((c) => c.op === op);
  }
}

// ---------------------------------------------------------------------------
// Global install / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  FakeWebSocket.last = null;
  FakeRTCPeerConnection.last = null;
  vi.useFakeTimers(); // pins the ping setInterval so nothing leaks/fires
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] }),
    })),
  );
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Helper: kick off a quickMatch and walk to the point a WS exists + is open. */
async function startAndOpen(mode = 'quick') {
  const p = RtcSession.quickMatch(mode);
  await flush(); // let fetchIceServers + `new WebSocket` happen
  const ws = FakeWebSocket.last!;
  expect(ws).toBeTruthy();
  ws.fireOpen();
  await flush();
  return { p, ws };
}

// ===========================================================================
// HOST
// ===========================================================================

describe('RtcSession — host quick match', () => {
  it('queues, offers, connects, sends over the channel, and reports peerLeft', async () => {
    const { p, ws } = await startAndOpen('quick');

    // 1. queue message sent on open
    expect(ws.sent).toContainEqual({ type: 'queue', game: 'soccer', mode: 'quick' });

    // 2. matched as host → data channel created + offer sent
    ws.fireMessage({ type: 'matched', roomId: 'r1', role: 'host', seed: 12345 });
    await flush();

    const pc = FakeRTCPeerConnection.last!;
    expect(pc).toBeTruthy();
    expect(pc.opsOf('createDataChannel')).toHaveLength(1);

    const signals = ws.signalsSent();
    const offerSignal = signals.find(
      (d) => (d as { sdp?: { type?: string } }).sdp?.type === 'offer',
    ) as { sdp: RTCSessionDescriptionInit };
    expect(offerSignal).toBeTruthy();
    expect(offerSignal.sdp.type).toBe('offer');

    // 3. data channel open → quickMatch resolves with role/seed/session
    pc.localChannel!.fireOpen();
    const result = await p;
    expect(result.role).toBe('host');
    expect(result.seed).toBe(12345);
    expect(result.session).toBeInstanceOf(RtcSession);

    // 4. send() serializes onto the data channel
    result.session.send({ k: 'inp', t: 1, p: 0, ax: 0, ay: 0, a: 0, b: 0 } as never);
    expect(pc.localChannel!.sent).toContain(
      JSON.stringify({ k: 'inp', t: 1, p: 0, ax: 0, ay: 0, a: 0, b: 0 }),
    );

    // 5. peerLeft AFTER connect is IGNORED — a peer's signaling socket dropping
    //    is not a match disconnect (the P2P data channel is the source of truth)
    const onClose = vi.fn();
    result.session.onClose = onClose;
    ws.fireMessage({ type: 'peerLeft' });
    await flush();
    expect(onClose).not.toHaveBeenCalled();

    // 6. the DATA CHANNEL closing IS a real disconnect → onClose fires once
    pc.localChannel!.fireClose();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// GUEST
// ===========================================================================

describe('RtcSession — guest', () => {
  it('waits for the channel, answers the offer, and resolves on channel open', async () => {
    const { p, ws } = await startAndOpen('quick');

    ws.fireMessage({ type: 'matched', roomId: 'r1', role: 'guest', seed: 7 });
    await flush();

    const pc = FakeRTCPeerConnection.last!;
    expect(pc).toBeTruthy();

    // guest does NOT create a data channel locally — it waits for ondatachannel
    expect(pc.opsOf('createDataChannel')).toHaveLength(0);
    expect(typeof pc.ondatachannel).toBe('function');

    // host's offer arrives → setRemoteDescription + answer sent back
    ws.fireMessage({ type: 'signal', data: { sdp: { type: 'offer', sdp: 'x' } } });
    await flush();

    expect(pc.opsOf('setRemoteDescription')).toHaveLength(1);
    expect(pc.opsOf('setRemoteDescription')[0]!.arg).toEqual({ type: 'offer', sdp: 'x' });

    const answerSignal = ws
      .signalsSent()
      .find((d) => (d as { sdp?: { type?: string } }).sdp?.type === 'answer') as {
      sdp: RTCSessionDescriptionInit;
    };
    expect(answerSignal).toBeTruthy();
    expect(answerSignal.sdp.type).toBe('answer');

    // ondatachannel(channel) + channel open → promise resolves
    const channel = new FakeRTCDataChannel('game');
    pc.ondatachannel!({ channel });
    await flush();
    channel.fireOpen();

    const result = await p;
    expect(result.role).toBe('guest');
    expect(result.seed).toBe(7);
    expect(result.session).toBeInstanceOf(RtcSession);
  });

  it('buffers ICE candidates that arrive before the offer, then flushes them', async () => {
    const { ws } = await startAndOpen('quick');

    ws.fireMessage({ type: 'matched', roomId: 'r1', role: 'guest', seed: 7 });
    await flush();

    const pc = FakeRTCPeerConnection.last!;

    // candidate arrives BEFORE the offer → must NOT be added yet (buffered)
    const candidate = { candidate: 'candA', sdpMid: '0', sdpMLineIndex: 0 };
    ws.fireMessage({ type: 'signal', data: { candidate } });
    await flush();
    expect(pc.opsOf('addIceCandidate')).toHaveLength(0);

    // now the offer applies → setRemoteDescription happens, THEN the buffered
    // candidate is flushed (so addIceCandidate must come after setRemoteDescription)
    ws.fireMessage({ type: 'signal', data: { sdp: { type: 'offer', sdp: 'x' } } });
    await flush();

    const added = pc.opsOf('addIceCandidate');
    expect(added).toHaveLength(1);
    expect(added[0]!.arg).toEqual(candidate);

    // ordering: setRemoteDescription strictly before addIceCandidate
    const order = pc.calls.map((c) => c.op);
    expect(order.indexOf('setRemoteDescription')).toBeLessThan(order.indexOf('addIceCandidate'));
  });
});

// ===========================================================================
// ERROR
// ===========================================================================

describe('RtcSession — error', () => {
  it('rejects the connect promise on a server error message before connect', async () => {
    const { p, ws } = await startAndOpen('quick');

    ws.fireMessage({ type: 'error', error: 'no room' });
    await flush();

    await expect(p).rejects.toThrow('no room');
  });
});
