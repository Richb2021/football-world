import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const GAME_ID = 'soccer';

// Cross-device saves live in a SOCCER-OWNED table, kept separate from the shared
// `saves` table (used by the basketball game) so soccer's slot schema can never
// affect it. See docs/supabase/2026-06-26-soccer-saves-table.sql.
export const SAVES_TABLE = 'soccer_saves';

export const supabase: SupabaseClient | null =
  URL && ANON ? createClient(URL, ANON) : null;

export const hasSupabase = (): boolean => supabase !== null;
