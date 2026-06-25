import { supabase, GAME_ID } from './supabase';
import type { TeamData } from '../sim/types';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BackendService {
  publishSquad?(team: TeamData, rating: number): Promise<void>;
  submitScore?(board: 'rivals' | 'challenge' | 'cup' | 'chronicle', points: number, weekKey: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocalBackend — delegates to localStorage-backed store
// ---------------------------------------------------------------------------

export class LocalBackend implements BackendService {}

// ---------------------------------------------------------------------------
// SupabaseBackend — cloud-primary, local fallback, never throws
// ---------------------------------------------------------------------------

export class SupabaseBackend implements BackendService {
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async publishSquad(team: TeamData, rating: number): Promise<void> {
    if (!supabase) return;
    try {
      // shared `cards` table holds per-game user content blobs
      await supabase.from('cards').insert({
        user_id: this.userId,
        game_id: GAME_ID,
        data: { squad: team, rating },
      });
    } catch (e) {
      console.warn('SupabaseBackend.publishSquad failed', e);
    }
  }

  async submitScore(
    board: 'rivals' | 'challenge' | 'cup' | 'chronicle',
    points: number,
    weekKey: string,
  ): Promise<void> {
    if (!supabase) return;
    try {
      // shared `weekly_points` table: PK (user_id, game_id, week, mode)
      const week = Number(weekKey.replace(/\D/g, '')) || 0;
      await supabase.from('weekly_points').upsert({
        user_id: this.userId,
        game_id: GAME_ID,
        week,
        mode: board,
        points,
      }, { onConflict: 'user_id,game_id,week,mode' });
    } catch (e) {
      console.warn('SupabaseBackend.submitScore failed', e);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getBackend(userId: string | null): BackendService {
  return supabase && userId ? new SupabaseBackend(userId) : new LocalBackend();
}
