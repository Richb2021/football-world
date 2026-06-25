/**
 * Football World — MANAGER MODE targets: season expectations, board evaluation,
 * the sack, and job offers.
 *
 * The board sets a target per season based on the squad's strength relative to
 * its tier; after the final whistle we grade the finish, swing confidence and
 * (if it has fallen too far) hand the manager their cards. Sacked or riding
 * high, rival clubs come knocking with fresh job offers. Pure data + logic.
 */
import type { Rng } from '../../sim/rng';
import { computeTable, type TableRow } from '../fixtures';
import { anyTeamById } from '../../data/teams';
import { nationById, tiersOf } from '../../data/nations';
import type { ManagerState, SeasonTarget, TargetKind } from './types';
import { clamp } from './types';
import { clubStrength } from './utils';

/** A rival club willing to hire the manager. */
export interface JobOffer {
  clubId: string;
  clubName: string;
  tier: number;
  leagueId: string;
}

// -------------------------------------------------------------- helpers

/** The club ids occupying a given tier in the manager's nation. */
function tierClubIds(state: ManagerState, tier: number): string[] {
  const nation = nationById(state.nationId);
  if (nation) {
    const t = tiersOf(nation).find((x) => x.tier === tier);
    if (t) return t.teamIds.slice();
  }
  // fall back to whatever the live state records for that tier
  return Object.keys(state.clubTier).filter((id) => state.clubTier[id] === tier);
}

/** Strength of every club in the tier, with ids, strongest first. */
function tierRankedByStrength(state: ManagerState, ids: string[]): { id: string; str: number }[] {
  return ids
    .map((id) => ({ id, str: clubStrength(state.squads[id] ?? []) }))
    .sort((a, b) => b.str - a.str);
}

// -------------------------------------------------------------- target setting

/** Derive the board's seasonal expectation for a club from its squad strength vs the tier. */
export function seasonTargetFor(state: ManagerState, clubId: string, tier: number): SeasonTarget {
  const nation = nationById(state.nationId);
  const promotionSlots = nation?.promotion ?? 3;
  const relegationSlots = nation?.relegation ?? 3;

  const ids = tierClubIds(state, tier);
  const ranked = tierRankedByStrength(state, ids);
  const teamCount = ranked.length || 1;
  const pos = ranked.findIndex((r) => r.id === clubId); // 0-based, -1 if missing
  const rank = pos < 0 ? teamCount : pos + 1;

  const avgStr = ranked.length
    ? ranked.reduce((s, r) => s + r.str, 0) / ranked.length
    : 50;
  const clubStr = clubStrength(state.squads[clubId] ?? []);
  const isTopTier = tier <= 1;

  let kind: TargetKind;
  let minPosition: number;
  let description: string;

  if (rank <= 2) {
    // genuine title contender
    kind = 'title';
    minPosition = 1;
    description = 'Win the title';
  } else if (clubStr > avgStr + 0.5) {
    // above-average — push for promotion (or continental qualification at the top)
    if (isTopTier) {
      kind = 'promotion';
      minPosition = 5;
      description = 'Qualify for continental football';
    } else {
      kind = 'promotion';
      minPosition = promotionSlots + 1;
      description = 'Mount a promotion push';
    }
  } else if (rank <= Math.ceil(teamCount / 2)) {
    // broad midtable pack — a playoff / respectability target
    if (teamCount <= 4) {
      kind = 'mid-table';
      minPosition = Math.max(1, Math.ceil(teamCount / 2));
      description = 'Finish mid-table';
    } else {
      kind = 'playoffs';
      minPosition = Math.max(1, Math.ceil(teamCount / 2));
      description = 'Reach the playoffs';
    }
  } else {
    // weak squad — survival is the only realistic ask
    kind = 'survival';
    minPosition = Math.max(1, teamCount - relegationSlots);
    description = 'Battle to beat the drop';
  }

  return { tier, minPosition, description, kind };
}

// -------------------------------------------------------------- evaluation

/** Build a sorted league table for a league from the live results (no engine import). */
function tableFor(state: ManagerState, leagueId: string): TableRow[] {
  const ids = state.leagueTeamIds[leagueId] ?? [];
  const fx = state.fixtures[leagueId] ?? [];
  const res = state.results[leagueId] ?? {};
  const resultsMap = new Map<string, [number, number]>(Object.entries(res));
  return computeTable(ids.length, resultsMap, fx);
}

/** Grade the user's finish against the board's target. */
export function evaluateTarget(state: ManagerState): { met: boolean; finish: number; margin: number; summary: string } {
  const target = state.board.target;
  const userLeague = state.clubLeagueId[state.userClubId];
  const ids = state.leagueTeamIds[userLeague] ?? [];
  const table = tableFor(state, userLeague);
  const userIdx = ids.indexOf(state.userClubId);

  let finish: number;
  if (userIdx < 0) {
    finish = (ids.length || 1);
  } else {
    const rowPos = table.findIndex((r) => r.team === userIdx);
    finish = rowPos < 0 ? (ids.length || 1) : rowPos + 1;
  }

  const minPosition = target.minPosition;
  const met = finish <= minPosition;
  const margin = minPosition - finish;
  const summary = `Finished ${finish} (target ${minPosition}) — ${met ? 'target met' : 'target missed'}`;
  return { met, finish, margin, summary };
}

// -------------------------------------------------------------- board reaction

/** Apply the end-of-season board reaction: confidence swings, warnings, possible sacking. */
export function applyBoardEvaluation(state: ManagerState, rng: Rng): { sacked: boolean } {
  void rng; // reserved for future flavour variance; the thresholds are deterministic
  const ev = evaluateTarget(state);

  if (ev.met) {
    const big = ev.margin >= 3;
    state.board.confidence = clamp(state.board.confidence + (big ? 25 : 16));
    state.reputation = clamp(state.reputation + (big ? 6 : 3));
    state.sentiment.fans = clamp(state.sentiment.fans + (big ? 8 : 4));
    state.sentiment.media = clamp(state.sentiment.media + (big ? 6 : 3));
  } else {
    const bad = ev.margin <= -4;
    state.board.confidence = clamp(state.board.confidence - (bad ? 38 : 22));
    state.board.warnings += 1;
    state.reputation = clamp(state.reputation - 4);
    state.sentiment.fans = clamp(state.sentiment.fans - (bad ? 10 : 5));
    state.sentiment.pressure = clamp(state.sentiment.pressure + (bad ? 14 : 8));
  }

  const sacked = state.board.confidence < 25 || state.board.warnings >= 2;
  return { sacked };
}

// -------------------------------------------------------------- job offers

/** Reputation (0-100) maps roughly to a club-strength band a manager can attract. */
function reputationToStrength(reputation: number): number {
  return Math.round(40 + (reputation / 100) * 45); // ~40 .. ~85
}

/** Generate 2-4 rival job offers for the manager, weighted to reachable clubs. */
export function jobOffers(state: ManagerState, rng: Rng): JobOffer[] {
  const nation = nationById(state.nationId);
  if (!nation) return [];

  // every club in the nation with a known squad + tier
  const allIds = Object.keys(state.clubTier);
  const candidates = allIds
    .filter((id) => id !== state.userClubId)
    .map((id) => ({
      id,
      str: clubStrength(state.squads[id] ?? []),
      tier: state.clubTier[id] ?? 1,
      leagueId: state.clubLeagueId[id],
    }))
    .filter((c) => !!c.leagueId);

  if (!candidates.length) return [];

  const recentlySacked = state.phase === 'job-offers' || state.phase === 'sacked';
  const targetStr = reputationToStrength(state.reputation);

  // score each candidate: prefer clubs whose strength the manager can plausibly reach
  const scored = candidates.map((c) => {
    let score = 1 / (1 + Math.abs(c.str - targetStr)); // closeness to reputation band
    if (recentlySacked) {
      // after the sack: lean to weaker / lower-tier rebuilds, away from giants
      score *= c.tier >= 2 ? 1.5 : 0.6;
      score *= c.str <= targetStr + 4 ? 1.4 : 0.7;
    } else if (state.reputation >= 60) {
      // riding high: keep one genuine step-up in the mix
      score *= c.str > targetStr ? 1.25 : 1.0;
    }
    // jitter so ties break deterministically per rng
    score *= 0.7 + rng.next() * 0.6;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const want = Math.min(scored.length, rng.range(2, 5)); // 2..4
  const picked = scored.slice(0, want);

  return picked.map((c) => ({
    clubId: c.id,
    clubName: anyTeamById(c.id)?.name ?? c.id,
    tier: c.tier,
    leagueId: c.leagueId,
  }));
}
