import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Force the offline path: mock supabase as null before any module under test
// imports it.  This simulates the "no VITE_SUPABASE_* env vars" condition
// described in the spec, regardless of .env.local on the developer's machine.
// ---------------------------------------------------------------------------
vi.mock('../supabase', () => ({
  supabase: null,
  GAME_ID: 'soccer',
  hasSupabase: () => false,
}));

import { getBackend, LocalBackend } from '../backend';
import { currentUser, signInWithEmail } from '../auth';

// ---------------------------------------------------------------------------
// Backend factory — offline path (supabase mocked as null)
// ---------------------------------------------------------------------------

describe('getBackend — offline (no supabase client)', () => {
  it('returns LocalBackend for null userId', () => {
    expect(getBackend(null)).toBeInstanceOf(LocalBackend);
  });

  it('returns LocalBackend even with a userId (supabase is null)', () => {
    expect(getBackend('u1')).toBeInstanceOf(LocalBackend);
  });
});

// ---------------------------------------------------------------------------
// Auth helpers — offline path (supabase mocked as null)
// ---------------------------------------------------------------------------

describe('auth — offline path', () => {
  it('currentUser resolves to null without throwing', async () => {
    await expect(currentUser()).resolves.toBeNull();
  });

  it('signInWithEmail resolves to {ok:false,error:"offline"} without throwing', async () => {
    const result = await signInWithEmail('x@y.com');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
  });
});
