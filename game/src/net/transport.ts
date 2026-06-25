import type { NetMsg } from './online';

/**
 * The minimal surface the live match loop (matchRunner) needs from any net
 * transport. Both the legacy PeerJS `NetSession` and the server-backed
 * `RtcSession` satisfy this structurally, so the host-authoritative match
 * runner is transport-agnostic.
 */
export interface NetTransport {
  onMessage: ((m: NetMsg) => void) | null;
  onClose: (() => void) | null;
  send(m: NetMsg): void;
  close(): void;
}
