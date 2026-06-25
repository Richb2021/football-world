/**
 * Football World — MANAGER MODE in-season cup. A single-elimination knockout
 * bracket (with byes) drawn from a nation's cup entrants, played on specific
 * league matchdays spread across the season. On a cup matchday the user plays
 * their cup tie (their league game that day is auto-simmed); CPU ties resolve via
 * simulateKnockout. Pure data + logic — the engine wires it into the season loop.
 */
import { Rng } from '../../sim/rng';
import { simulateKnockout } from '../../sim/statSim';
import { nationById, tiersOf } from '../../data/nations';
import { anyTeamById } from '../../data/teams';
import type { ManagerState, ManagerCup, CupTie, PendingFixture } from './types';
import { clamp } from './types';
import { clubStrength } from './utils';

/** Sentinel leagueId marking a cup tie in a PendingFixture. */
export const CUP_LEAGUE_ID = '__cup__';

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Resolve the entrant club ids for a nation's primary cup. */
function cupEntrants(state: ManagerState): string[] {
  const nation = nationById(state.nationId);
  if (!nation || !nation.cups?.length) return [];
  const entries = nation.cups[0].entries;
  const tiers = tiersOf(nation);
  let clubIds: string[];
  if (nation.type === 'single') {
    clubIds = (nation.teamPool ?? tiers.flatMap((t) => t.teamIds)).slice();
  } else if (entries === 'top-tier') {
    clubIds = tiers.filter((t) => t.tier === 1).flatMap((t) => t.teamIds);
  } else if (entries === 'top-two-tiers') {
    clubIds = tiers.filter((t) => t.tier <= 2).flatMap((t) => t.teamIds);
  } else {
    clubIds = tiers.flatMap((t) => t.teamIds); // whole-nation
  }
  return clubIds.filter((id) => state.squads[id] && anyTeamById(id));
}

/** Build a fresh cup for the start of a season. Returns null if the nation has no cup. */
export function buildSeasonCup(state: ManagerState, rng: Rng): ManagerCup | null {
  const nation = nationById(state.nationId);
  if (!nation?.cups?.length) return null;
  const entrants = cupEntrants(state);
  if (entrants.length < 2) return null;

  // random seeded draw, padded to a power of two with byes
  const draw: (string | null)[] = entrants.slice();
  for (let i = draw.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [draw[i], draw[j]] = [draw[j], draw[i]];
  }
  const size = nextPow2(draw.length);
  while (draw.length < size) draw.push(null);

  const round0: CupTie[] = [];
  for (let i = 0; i < size; i += 2) round0.push({ homeClubId: draw[i], awayClubId: draw[i + 1] });

  const cupRounds = Math.round(Math.log2(size));
  const totalRounds = state.totalRounds || 1;
  const roundMatchdays: number[] = [];
  for (let r = 0; r < cupRounds; r++) {
    roundMatchdays.push(clamp(Math.floor(((r + 1) * totalRounds) / (cupRounds + 1)), 0, totalRounds - 1));
  }

  return {
    name: nation.cups[0].name,
    rounds: [round0],
    roundMatchdays,
    currentRound: 0,
    userEliminated: false,
    winner: null,
  };
}

/** True when the current league matchday is the one scheduled for the next cup round. */
export function isCupMatchday(state: ManagerState): boolean {
  const c = state.cup;
  return !!c && c.winner === null
    && c.currentRound < c.rounds.length
    && c.currentRound < c.roundMatchdays.length
    && state.matchday === c.roundMatchdays[c.currentRound];
}

export function userStillInCup(state: ManagerState): boolean {
  const c = state.cup;
  return !!c && !c.userEliminated && c.winner === null;
}

/** The user's cup tie for the current cup matchday, or null. */
export function userCupTieNow(state: ManagerState): PendingFixture | null {
  const c = state.cup;
  if (!c || !isCupMatchday(state) || !userStillInCup(state)) return null;
  const ties = c.rounds[c.currentRound] ?? [];
  for (const t of ties) {
    if (t.winner !== undefined) continue;
    if (t.homeClubId === state.userClubId || t.awayClubId === state.userClubId) {
      return {
        leagueId: CUP_LEAGUE_ID, round: c.currentRound,
        homeClubId: t.homeClubId ?? state.userClubId, awayClubId: t.awayClubId ?? state.userClubId,
        cupTie: true,
      };
    }
  }
  return null;
}

/** Simulate the CPU cup ties (and byes) for the current cup round. */
export function simCupRoundCPUs(state: ManagerState, rng: Rng): void {
  const c = state.cup;
  if (!c || !isCupMatchday(state)) return;
  const ties = c.rounds[c.currentRound] ?? [];
  for (const t of ties) {
    if (t.winner !== undefined) continue;
    if (t.homeClubId && t.awayClubId) {
      if (t.homeClubId === state.userClubId || t.awayClubId === state.userClubId) continue; // user plays theirs
      const h = clubStrength(state.squads[t.homeClubId] ?? []);
      const a = clubStrength(state.squads[t.awayClubId] ?? []);
      const res = simulateKnockout(h, a, rng);
      t.homeGoals = res.score[0];
      t.awayGoals = res.score[1];
      t.winner = res.winner === 0 ? t.homeClubId : t.awayClubId;
    } else {
      t.winner = t.homeClubId ?? t.awayClubId; // bye
    }
  }
}

/** When every tie in the current round is decided, pair the winners into the next round. */
export function advanceCupRound(state: ManagerState): void {
  const c = state.cup;
  if (!c || c.winner !== null) return;
  const round = c.rounds[c.currentRound];
  if (!round || round.some((t) => t.winner === undefined)) return; // not all decided yet
  const winners = round.map((t) => t.winner ?? null).filter((w): w is string => w !== null);
  if (winners.length <= 1) {
    c.winner = winners[0] ?? null;
    return;
  }
  const next: CupTie[] = [];
  for (let i = 0; i + 1 < winners.length; i += 2) next.push({ homeClubId: winners[i], awayClubId: winners[i + 1] });
  if (winners.length % 2 === 1) next.push({ homeClubId: winners[winners.length - 1], awayClubId: null }); // odd one out gets a bye
  c.rounds.push(next);
  c.currentRound += 1;
}

/**
 * Record the user's cup tie result. `winnerSide` is the match winner (0=home, 1=away)
 * after extra time / penalties — cup ties cannot be drawn, so it must come from the
 * match outcome, not the scoreline. Returns whether the user won.
 */
export function recordCupUserTie(state: ManagerState, fx: PendingFixture, score: [number, number], winnerSide: 0 | 1): boolean {
  const c = state.cup;
  if (!c) return false;
  const ties = c.rounds[c.currentRound] ?? [];
  const tie = ties.find((t) => (t.homeClubId === state.userClubId || t.awayClubId === state.userClubId) && t.winner === undefined);
  if (!tie) return false;
  tie.homeGoals = score[0];
  tie.awayGoals = score[1];
  const userIsHome = tie.homeClubId === state.userClubId;
  const userWon = (winnerSide === 0) === userIsHome;
  tie.winner = userWon ? state.userClubId : (userIsHome ? tie.awayClubId : tie.homeClubId);
  if (!userWon) c.userEliminated = true;
  return userWon;
}
