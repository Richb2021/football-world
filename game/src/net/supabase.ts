import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const GAME_ID = 'soccer';

export const supabase: SupabaseClient | null =
  URL && ANON ? createClient(URL, ANON) : null;

export const hasSupabase = (): boolean => supabase !== null;
