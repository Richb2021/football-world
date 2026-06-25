/** Shared pure helpers for Manager Mode. No DOM, no engine imports. */
import { overallRating } from '../../sim/formations';
import { anyTeamById } from '../../data/teams';
import { nationById, tiersOf, type NationTier } from '../../data/nations';
import type { PlayerAttrs, FormationId, Lineup, KitColors } from '../../sim/types';
import type { ManagerPlayer, ManagerState } from './types';
import { clamp } from './types';

export { overallRating };
export const ovr = overallRating;

/** Squad strength = mean overall of the strongest 14 (a starting XI + 3 subs). */
export function clubStrength(squad: PlayerAttrs[]): number {
  if (!squad.length) return 50;
  const sorted = squad.slice().sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 14);
  return Math.round(sorted.reduce((s, p) => s + overallRating(p), 0) / sorted.length);
}

export function teamDataOf(clubId: string) {
  const t = anyTeamById(clubId);
  if (!t) throw new Error(`unknown club ${clubId}`);
  return t;
}

export function clubNameOf(state: ManagerState, clubId: string): string {
  return anyTeamById(clubId)?.name ?? clubId;
}

export function nationTiers(state: ManagerState): NationTier[] {
  const n = nationById(state.nationId);
  return n ? tiersOf(n) : [];
}

export function leagueIdOfTier(state: ManagerState, tier: number): string | undefined {
  return nationTiers(state).find((t) => t.tier === tier)?.leagueId;
}

export function roundMoney(v: number): number {
  return Math.max(10, Math.round(v / 10) * 10);
}

/** Promote a raw PlayerAttrs (from team data) into a ManagerPlayer with live state. */
export function toManagerPlayer(p: PlayerAttrs, rng: () => number): ManagerPlayer {
  const r = overallRating(p);
  return {
    ...p,
    form: 50,
    morale: 60,
    fitness: 92,
    contractYears: 1 + Math.floor(rng() * 4),
    wage: Math.max(1, Math.round((r * r) / 60)),
    potential: clamp(r + Math.floor(rng() * 12) - 3, r, 99),
  };
}

const FORMATIONS_NEED: Record<string, { DF: number; MF: number; FW: number }> = {
  '4-4-2': { DF: 4, MF: 4, FW: 2 },
  '4-3-3': { DF: 4, MF: 3, FW: 3 },
  '4-2-3-1': { DF: 4, MF: 5, FW: 1 },
  '4-5-1': { DF: 4, MF: 5, FW: 1 },
  '3-5-2': { DF: 3, MF: 5, FW: 2 },
  '5-3-2': { DF: 5, MF: 3, FW: 2 },
};

/** Auto-pick a valid 11 (1 GK + a balanced DF/MF/FW split) from a squad. */
export function autoLineup(squad: PlayerAttrs[], formation: FormationId = '4-2-3-1'): Lineup {
  const need = FORMATIONS_NEED[formation] ?? { DF: 4, MF: 5, FW: 1 };
  const byPos = (pos: PlayerAttrs['pos']) =>
    squad.map((p, i) => ({ i, r: overallRating(p) })).filter((x) => squad[x.i].pos === pos).sort((a, b) => b.r - a.r);
  const take = (list: { i: number }[], n: number, used: Set<number>) => {
    const out: number[] = [];
    for (const x of list) {
      if (out.length >= n) break;
      if (!used.has(x.i)) { out.push(x.i); used.add(x.i); }
    }
    return out;
  };
  const used = new Set<number>();
  const gk = byPos('GK');
  const starters = [...take(gk, 1, used)];
  const dfPool = byPos('DF'); const mfPool = byPos('MF'); const fwPool = byPos('FW');
  starters.push(...take(dfPool, need.DF, used));
  starters.push(...take(mfPool, need.MF, used));
  starters.push(...take(fwPool, need.FW, used));
  // top up from whoever's left, best-rated first
  if (starters.length < 11) {
    const rest = squad.map((_, i) => i).filter((i) => !used.has(i)).sort((a, b) => overallRating(squad[b]) - overallRating(squad[a]));
    for (const i of rest) { if (starters.length >= 11) break; starters.push(i); used.add(i); }
  }
  // trim
  return { formation, starters: starters.slice(0, 11) };
}

/** Resolve a lineup: prefer an explicit override, then the team's default, else auto. */
export function resolveLineup(
  squad: PlayerAttrs[],
  teamDefault: Lineup | undefined,
  preferred?: { formation?: FormationId; starters?: number[] },
): Lineup {
  if (preferred?.starters && preferred.starters.length === 11) {
    const valid = preferred.starters.every((i) => i >= 0 && i < squad.length);
    const hasGk = preferred.starters.some((i) => squad[i]?.pos === 'GK');
    if (valid && hasGk) return { formation: preferred.formation ?? teamDefault?.formation ?? '4-2-3-1', starters: preferred.starters };
  }
  if (teamDefault && teamDefault.starters?.length === 11 && teamDefault.starters.every((i) => i >= 0 && i < squad.length)) {
    return teamDefault;
  }
  return autoLineup(squad, preferred?.formation ?? teamDefault?.formation ?? '4-2-3-1');
}

/** Map a starting XI's form (0-100, 50 neutral) for the match engine's playerForm lever. */
export function formMap(squad: ManagerPlayer[], starters: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const idx of starters) out[idx] = clamp(squad[idx]?.form ?? 50);
  return out;
}

function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Resolve home/away kits, switching the away set if it clashes with the home shirt. */
export function pickManagerKits(homeColors: { home: KitColors; away: KitColors }, awayColors: { home: KitColors; away: KitColors }): [KitColors, KitColors] {
  const homeShirt = homeColors.home;
  let away = awayColors.away;
  if (Math.abs(lum(homeShirt.shirt) - lum(away.shirt)) < 0.18) away = awayColors.home;
  return [homeShirt, away];
}
