// Supabase-backed "real squads" layer for Squad Battles: publish your own XI so
// other players can face it, and fetch other players' published squads as
// opponents. All best-effort and offline/guest-safe — never throws.
import { supabase, GAME_ID } from '../../net/supabase';
import type { Opponent } from './opponents';
import { buildStarsTeam, squadRating, resolveStarters } from './squad';
import type { StarsState } from './types';
import type { TeamData } from '../../sim/types';

function clampStars(overall: number): number {
  return Math.max(1, Math.min(5, Math.round(((overall - 50) / 45) * 5)));
}

/** Publish the player's current XI to the shared `cards` table (one row per
 * user). No-ops for guests or an incomplete squad. */
export async function publishMySquad(state: StarsState, userId: string | null): Promise<void> {
  if (!supabase || !userId) return;
  const resolved = resolveStarters(state);
  if (resolved.some((c) => c === null)) return; // only publish a complete XI
  try {
    const cards = resolved.filter((c): c is NonNullable<typeof c> => !!c);
    const team = buildStarsTeam(cards, state.club, state.squad.formation);
    const rating = squadRating(state);
    // keep a single current squad per user: delete prior soccer rows, then insert
    await supabase.from('cards').delete().eq('user_id', userId).eq('game_id', GAME_ID);
    await supabase.from('cards').insert({
      user_id: userId,
      game_id: GAME_ID,
      data: { squad: team, rating, club: state.club },
    });
  } catch (e) {
    console.warn('publishMySquad failed', e);
  }
}

interface PublishedSquad {
  squad?: TeamData;
  rating?: number;
  club?: { name?: string };
}

/** Fetch up to `count` other players' published squads as battle opponents,
 * nearest to `targetOverall`. Returns [] offline / when none are published. */
export async function fetchRealOpponents(
  myUserId: string | null,
  targetOverall: number,
  count: number,
): Promise<Opponent[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('cards')
      .select('user_id,data')
      .eq('game_id', GAME_ID)
      .limit(40);
    if (error || !data) return [];

    const seen = new Set<string>();
    const opps: Opponent[] = [];
    for (const row of data as { user_id: string; data: PublishedSquad }[]) {
      if (myUserId && row.user_id === myUserId) continue;
      if (seen.has(row.user_id)) continue;
      const squad = row.data?.squad;
      if (!squad || !Array.isArray(squad.players) || squad.players.length < 11) continue;
      seen.add(row.user_id);
      const overall = Math.round(row.data?.rating ?? 70);
      opps.push({
        id: 'real-' + row.user_id,
        label: row.data?.club?.name ?? 'Online Club',
        overall,
        stars: clampStars(overall),
        team: squad,
        lineup: { formation: '4-4-2', starters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        kit: squad.colors.home,
      });
    }
    opps.sort((a, b) => Math.abs(a.overall - targetOverall) - Math.abs(b.overall - targetOverall));
    return opps.slice(0, count);
  } catch {
    return [];
  }
}
