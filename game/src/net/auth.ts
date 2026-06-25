import { supabase } from './supabase';

export interface AuthUser {
  id: string;
  email?: string;
}

/** Returns the currently signed-in user, or null if no client / not signed in. Never throws. */
export async function currentUser(): Promise<AuthUser | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) return null;
    return { id: u.id, email: u.email ?? undefined };
  } catch {
    return null;
  }
}

/**
 * Send a magic-link OTP to `email`.
 * Returns `{ok:false,error:'offline'}` when no Supabase client is configured.
 * Converts Supabase errors to `{ok:false,error:string}`. Never throws.
 */
export async function signInWithEmail(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'offline' };
  try {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

/** Sign out the current user. No-op (resolves immediately) if no client. Never throws. */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // swallow
  }
}

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function.
 * Returns a no-op unsubscribe immediately if no Supabase client is configured.
 */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  if (!supabase) return () => {};
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    const u = session?.user ?? null;
    cb(u ? { id: u.id, email: u.email ?? undefined } : null);
  });
  return () => subscription.unsubscribe();
}
