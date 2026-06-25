import { describe, it, expect, afterEach, vi } from 'vitest';

import { fetchIceServers } from '../config';

// ---------------------------------------------------------------------------
// The public STUN fallback config.ts hands back on any failure. fetchIceServers
// *always* resolves — it never rejects — so every failure mode below should
// yield this single-element array with a stun: url.
// ---------------------------------------------------------------------------
const STUN_FALLBACK_URL = 'stun:stun.l.google.com:19302';

function expectStunFallback(servers: RTCIceServer[]): void {
  expect(Array.isArray(servers)).toBe(true);
  expect(servers).toHaveLength(1);
  const urls = servers[0]!.urls;
  const flat = Array.isArray(urls) ? urls : [urls];
  expect(flat.some((u) => u.startsWith('stun:'))).toBe(true);
  expect(flat).toContain(STUN_FALLBACK_URL);
}

/** Build a minimal Response-shaped object for fetch to resolve with. */
function fakeResponse(opts: { ok?: boolean; json?: () => unknown }): Response {
  return {
    ok: opts.ok ?? true,
    json: opts.json ?? (() => ({})),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchIceServers — success path', () => {
  it('returns the iceServers array from the API response body', async () => {
    const fromServer: RTCIceServer[] = [
      { urls: ['stun:stun.example.com:3478'] },
      { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'c' },
    ];
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: true, json: () => ({ iceServers: fromServer }) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const servers = await fetchIceServers();
    expect(servers).toEqual(fromServer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchIceServers — fallback paths', () => {
  it('falls back to public STUN when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expectStunFallback(await fetchIceServers());
  });

  it('falls back to public STUN when res.ok is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false })),
    );
    expectStunFallback(await fetchIceServers());
  });

  it('falls back to public STUN when the body has no iceServers field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: true, json: () => ({}) })),
    );
    expectStunFallback(await fetchIceServers());
  });

  it('falls back to public STUN when iceServers is an empty array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: true, json: () => ({ iceServers: [] }) })),
    );
    expectStunFallback(await fetchIceServers());
  });

  it('falls back to public STUN when iceServers is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: true, json: () => ({ iceServers: 'nope' }) })),
    );
    expectStunFallback(await fetchIceServers());
  });

  it('falls back to public STUN when the body is invalid JSON (json() throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          json: () => {
            throw new Error('Unexpected token');
          },
        }),
      ),
    );
    expectStunFallback(await fetchIceServers());
  });
});
