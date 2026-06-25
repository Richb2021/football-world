// Endpoints for Grayson Games server-backed online play (signaling + TURN).
// Overridable via Vite env for local testing; default to the production box.

export const RT_URL: string =
  import.meta.env.VITE_RT_URL ?? 'wss://api.graysongames.com/rt';

export const TURN_ENDPOINT: string =
  import.meta.env.VITE_TURN_ENDPOINT ?? 'https://api.graysongames.com/api/turn';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'https://api.graysongames.com';

export const PAYPAL_CLIENT_ID: string =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ?? '';

// Public STUN fallback so negotiation still works if our TURN endpoint is
// unreachable (dev, or a transient API outage). TURN relay needs the real creds,
// but plain STUN gets most non-symmetric NATs connected.
const FALLBACK_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

/** Fetch ephemeral ICE servers (STUN + TURN with short-lived creds) from the
 *  API. Always resolves — falls back to public STUN on any error. */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await fetch(TURN_ENDPOINT, { method: 'GET' });
    if (!r.ok) return FALLBACK_ICE;
    const j = (await r.json()) as { iceServers?: RTCIceServer[] };
    const list = Array.isArray(j?.iceServers) ? j.iceServers : null;
    return list && list.length ? list : FALLBACK_ICE;
  } catch {
    return FALLBACK_ICE;
  }
}
