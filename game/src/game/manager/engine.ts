/**
 * Football World — MANAGER MODE engine: the season loop, league tables, CPU
 * matchday simulation, promotion/relegation, season rollover and the user-match
 * result pipeline. Reuses the primitives in fixtures.ts / statSim.ts / transfers.ts.
 *
 * Pure data + logic — no DOM. The four sibling modules (market/training/targets/meta)
 * implement the cross-cutting features the engine calls into; see types.ts contract.
 */
import { Rng } from '../../sim/rng';
import { roundRobin, computeTable, type TableRow } from '../fixtures';
import { simulateFixture } from '../../sim/statSim';
import { clubBudget } from '../transfers';
import { nationById, tiersOf, type NationTier } from '../../data/nations';
import { anyTeamById } from '../../data/teams';
import type { ManagerState, ManagerPlayer, LeagueStanding, PendingFixture, SeasonTarget } from './types';
import { clamp, playerKey } from './types';
import { clubStrength, teamDataOf, toManagerPlayer, clubNameOf, resolveLineup } from './utils';
import { ensureManagerSystems } from './saves';
import { cpuTransferMarket, youthIntake, tickScouting } from './market';
import { applyTrainingTick, ageAndDevelopOffseason } from './training';
import { seasonTargetFor, applyBoardEvaluation, evaluateTarget } from './targets';
import { recordUserMatchNarrative, seedManagerInbox } from './meta';

export { resolveLineup } from './utils';

const resultKey = (round: number, i: number) => `${round}:${i}`;

const sortedTeamIds = (ids: string[]): string[] =>
  ids.slice().sort((a, b) => (anyTeamById(a)?.name ?? a).localeCompare(anyTeamById(b)?.name ?? b));

// -------------------------------------------------------------- creation

export function createManagerCareer(opts: { nationId: string; clubId: string; managerName: string; seed: number }): ManagerState {
  const nation = nationById(opts.nationId);
  if (!nation) throw new Error(`unknown nation ${opts.nationId}`);
  if (!anyTeamById(opts.clubId)) throw new Error(`unknown club ${opts.clubId}`);
  const rng = new Rng(opts.seed);
  const tiers = tiersOf(nation);

  const clubTier: Record<string, number> = {};
  const clubLeagueId: Record<string, string> = {};
  const squads: Record<string, ManagerPlayer[]> = {};
  const leagueTeamIds: Record<string, string[]> = {};
  const fixtures: Record<string, [number, number][][]> = {};
  const results: Record<string, Record<string, [number, number]>> = {};

  const buildTier = (tier: NationTier) => {
    const ids = sortedTeamIds(tier.teamIds);
    leagueTeamIds[tier.leagueId] = ids;
    for (const id of ids) {
      clubTier[id] = tier.tier;
      clubLeagueId[id] = tier.leagueId;
      squads[id] = teamDataOf(id).players.map((p) => toManagerPlayer(p, () => rng.next()));
    }
    fixtures[tier.leagueId] = roundRobin(ids.length, (opts.seed + tier.tier * 97) >>> 0);
    results[tier.leagueId] = {};
  };

  if (nation.type === 'pyramid') {
    for (const tier of tiers) buildTier(tier);
  } else {
    // single-tier (World): one flat league of the pool
    const ids = sortedTeamIds(nation.teamPool ?? []);
    const leagueId = `${nation.id}-league`;
    leagueTeamIds[leagueId] = ids;
    for (const id of ids) {
      clubTier[id] = 1;
      clubLeagueId[id] = leagueId;
      squads[id] = teamDataOf(id).players.map((p) => toManagerPlayer(p, () => rng.next()));
    }
    fixtures[leagueId] = roundRobin(ids.length, opts.seed);
    results[leagueId] = {};
  }

  const totalRounds = Math.max(0, ...Object.values(fixtures).map((f) => f.length));
  const userTier = clubTier[opts.clubId] ?? 1;
  const userStr = clubStrength(squads[opts.clubId] ?? []);

  const state: ManagerState = {
    version: 1,
    managerName: opts.managerName,
    reputation: 40,
    nationId: opts.nationId,
    userClubId: opts.clubId,
    season: 1,
    year: 2026,
    clubTier,
    clubLeagueId,
    squads,
    leagueTeamIds,
    fixtures,
    results,
    matchday: 0,
    totalRounds,
    transferBudget: clubBudget(userStr),
    wageBudget: Math.max(50, Math.round(clubBudget(userStr) / 40)),
    windowPhase: 'summer',
    scoutAssignments: [],
    scoutedPlayers: {},
    trainingFocus: 'balanced',
    sentiment: { fans: 55, media: 55, squad: 60, pressure: 30 },
    board: { confidence: 60, target: { tier: userTier, minPosition: 1, description: 'Survive the season', kind: 'survival' }, warnings: 0 },
    inbox: { messages: [] },
    headlines: [],
    jobHistory: [{
      clubId: opts.clubId,
      clubName: anyTeamById(opts.clubId)?.name ?? opts.clubId,
      tier: userTier,
      seasonFrom: 1,
      seasonTo: null,
      outcome: 'current',
    }],
    lastSeasonReview: [],
    phase: 'in-season',
    pendingUserFixture: null,
    seed: opts.seed,
  };

  state.board.target = seasonTargetFor(state, opts.clubId, userTier);
  seedManagerInbox(state);
  state.pendingUserFixture = userFixtureThisMatchday(state);
  return ensureManagerSystems(state);
}

// -------------------------------------------------------------- tables

export function userLeagueId(state: ManagerState): string {
  return state.clubLeagueId[state.userClubId];
}

export function leagueTableOf(state: ManagerState, leagueId: string): LeagueStanding[] {
  const ids = state.leagueTeamIds[leagueId] ?? [];
  const fx = state.fixtures[leagueId] ?? [];
  const res = state.results[leagueId] ?? {};
  const resultsMap = new Map<string, [number, number]>(Object.entries(res));
  const rows = computeTable(ids.length, resultsMap, fx);
  return rows.map((r: TableRow) => ({
    clubId: ids[r.team] ?? `?${r.team}`,
    played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, points: r.points,
  }));
}

export function standingsForUserLeague(state: ManagerState): LeagueStanding[] {
  return leagueTableOf(state, userLeagueId(state));
}

export function currentTierOf(state: ManagerState, clubId: string): number {
  return state.clubTier[clubId] ?? 1;
}

// -------------------------------------------------------------- matchday

/** The user's fixture for the current round, or null if none / already played. */
export function userFixtureThisMatchday(state: ManagerState): PendingFixture | null {
  const leagueId = userLeagueId(state);
  const ids = state.leagueTeamIds[leagueId] ?? [];
  const round = state.matchday;
  const pairs = state.fixtures[leagueId]?.[round];
  if (!pairs) return null;
  const userIdx = ids.indexOf(state.userClubId);
  if (userIdx < 0) return null;
  for (let i = 0; i < pairs.length; i++) {
    const [h, a] = pairs[i];
    if (h === userIdx || a === userIdx) {
      const playedKey = resultKey(round, i);
      if ((state.results[leagueId] ?? {})[playedKey]) return null; // already resolved
      return { leagueId, round, homeClubId: ids[h], awayClubId: ids[a], cupTie: false };
    }
  }
  return null;
}

/** Simulate every CPU-vs-CPU fixture in the current round across all leagues. */
export function simMatchdayCPUs(state: ManagerState, rng: Rng): void {
  for (const [leagueId, fx] of Object.entries(state.fixtures)) {
    const ids = state.leagueTeamIds[leagueId] ?? [];
    const round = state.matchday;
    const pairs = fx[round];
    if (!pairs) continue;
    state.results[leagueId] = state.results[leagueId] ?? {};
    for (let i = 0; i < pairs.length; i++) {
      const [h, a] = pairs[i];
      const homeId = ids[h], awayId = ids[a];
      if (homeId === state.userClubId || awayId === state.userClubId) continue; // user plays theirs
      if (state.results[leagueId][resultKey(round, i)]) continue;
      const homeStr = clubStrength(state.squads[homeId] ?? []);
      const awayStr = clubStrength(state.squads[awayId] ?? []);
      state.results[leagueId][resultKey(round, i)] = simulateFixture(homeStr, awayStr, rng);
    }
  }
}

/** Record the user's just-played result and ripple form/morale/board effects. */
export function recordUserResult(state: ManagerState, score: [number, number], rng: Rng): void {
  const fx = state.pendingUserFixture;
  if (!fx) return;
  const ids = state.leagueTeamIds[fx.leagueId] ?? [];
  const pairs = state.fixtures[fx.leagueId]?.[fx.round] ?? [];
  const userIdx = ids.indexOf(state.userClubId);
  let pairIndex = -1;
  for (let i = 0; i < pairs.length; i++) if (pairs[i][0] === userIdx || pairs[i][1] === userIdx) { pairIndex = i; break; }
  if (pairIndex >= 0) {
    state.results[fx.leagueId] = state.results[fx.leagueId] ?? {};
    state.results[fx.leagueId][resultKey(fx.round, pairIndex)] = score;
  }

  const userIsHome = fx.homeClubId === state.userClubId;
  const opponentClubId = userIsHome ? fx.awayClubId : fx.homeClubId;
  const [hg, ag] = score;
  const userGoals = userIsHome ? hg : ag;
  const oppGoals = userIsHome ? ag : hg;
  const result = userGoals > oppGoals ? 'win' : userGoals < oppGoals ? 'loss' : 'draw';

  // form / morale / fitness for the user squad (starters carry the swing)
  const squad = state.squads[state.userClubId] ?? [];
  const team = teamDataOf(state.userClubId);
  const starters = new Set(resolveLineup(squad, team.defaultLineup).starters);
  for (let idx = 0; idx < squad.length; idx++) {
    const p = squad[idx];
    if (starters.has(idx)) {
      const swing = result === 'win' ? 6 : result === 'loss' ? -7 : -1;
      p.form = clamp(p.form + swing + rng.range(-2, 3));
      p.morale = clamp(p.morale + swing * 0.7 + rng.range(-1, 2));
      p.fitness = clamp(p.fitness - 8 - rng.range(0, 6), 30, 100);
    } else {
      p.form = clamp(p.form + (p.form < 50 ? 1.5 : -1) + rng.range(-1, 1));
      p.morale = clamp(p.morale - 1.5 + rng.range(-1, 1));
      p.fitness = clamp(p.fitness + 4, 30, 100);
    }
  }

  const s = state.sentiment;
  if (result === 'win') { s.fans = clamp(s.fans + 8); s.squad = clamp(s.squad + 6); s.media = clamp(s.media + 5); s.pressure = clamp(s.pressure - 6); state.board.confidence = clamp(state.board.confidence + 5); }
  else if (result === 'loss') { s.fans = clamp(s.fans - 8); s.squad = clamp(s.squad - 6); s.media = clamp(s.media - 6); s.pressure = clamp(s.pressure + 9); state.board.confidence = clamp(state.board.confidence - 7); }
  else { s.pressure = clamp(s.pressure + 2); }

  recordUserMatchNarrative(state, score, opponentClubId, rng);
  state.pendingUserFixture = null;
}

/** Quick-sim the user's fixture (used when the player skips playing the match). */
export function quickSimUserFixture(state: ManagerState, rng: Rng): [number, number] {
  const fx = state.pendingUserFixture;
  if (!fx) return [0, 0];
  const userIsHome = fx.homeClubId === state.userClubId;
  const homeStr = clubStrength(state.squads[fx.homeClubId] ?? []);
  const awayStr = clubStrength(state.squads[fx.awayClubId] ?? []);
  const score = simulateFixture(homeStr, awayStr, rng); // canonical [home, away]
  recordUserResult(state, score, rng);
  return userIsHome ? score : [score[1], score[0]];
}

// -------------------------------------------------------------- advance / season

function windowForMatchday(matchday: number, totalRounds: number): 'summer' | 'winter' | 'closed' {
  const mid = Math.floor(totalRounds / 2);
  if (matchday <= 2) return 'summer';
  if (matchday >= mid && matchday <= mid + 2) return 'winter';
  return 'closed';
}

/** Advance one matchday after the user fixture is resolved. Returns whether the season ended. */
export function advance(state: ManagerState, rng: Rng): { seasonEnded: boolean } {
  // safety: if the user still has a pending fixture, quick-sim it
  if (state.pendingUserFixture) quickSimUserFixture(state, rng);
  // simulate the CPU-vs-CPU fixtures concurrent with the matchday just played
  simMatchdayCPUs(state, rng);

  state.matchday += 1;
  applyTrainingTick(state, rng);
  tickScouting(state, rng);

  state.windowPhase = windowForMatchday(state.matchday, state.totalRounds);
  if (state.windowPhase !== 'closed' && rng.next() < 0.6) {
    cpuTransferMarket(state, rng);
  }

  if (state.matchday >= state.totalRounds) {
    endSeason(state, rng);
    return { seasonEnded: true };
  }

  state.pendingUserFixture = userFixtureThisMatchday(state);
  if (!state.pendingUserFixture) {
    // odd-team rotation bye (rare) — resolve CPUs and step again
    simMatchdayCPUs(state, rng);
    return advance(state, rng);
  }
  return { seasonEnded: false };
}

function applyPromotionRelegation(state: ManagerState): void {
  const nation = nationById(state.nationId);
  if (!nation || nation.type !== 'pyramid') return;
  const P = nation.promotion ?? 3;
  const R = nation.relegation ?? 3;
  const sortedTiers = tiersOf(nation).slice().sort((a, b) => a.tier - b.tier);
  for (let k = 0; k < sortedTiers.length - 1; k++) {
    const upper = sortedTiers[k];
    const lower = sortedTiers[k + 1];
    const upperTable = leagueTableOf(state, upper.leagueId);
    const lowerTable = leagueTableOf(state, lower.leagueId);
    const relegated = upperTable.slice(-R).map((r) => r.clubId);
    const promoted = lowerTable.slice(0, P).map((r) => r.clubId);
    for (const id of promoted) { state.clubTier[id] = upper.tier; state.clubLeagueId[id] = upper.leagueId; }
    for (const id of relegated) { state.clubTier[id] = lower.tier; state.clubLeagueId[id] = lower.leagueId; }
  }
}

export function endSeason(state: ManagerState, rng: Rng): void {
  // ensure the final round's CPU fixtures are resolved
  simMatchdayCPUs(state, rng);

  // Evaluate the season on the final tables BEFORE promotion/relegation reshuffles
  // clubs (after pro/rel the user's league context changes).
  const userLeague = state.clubLeagueId[state.userClubId];
  const table = leagueTableOf(state, userLeague);
  const userFinish = table.findIndex((r) => r.clubId === state.userClubId) + 1;
  const champions = table[0];
  const ev = evaluateTarget(state);
  const evalResult = applyBoardEvaluation(state, rng);

  const lines: string[] = [];
  lines.push(`<b>CHAMPIONS:</b> ${champions ? clubNameOf(state, champions.clubId) : '—'}`);
  lines.push(`You finished <b>${userFinish ? ordinal(userFinish) : '—'}</b> — target ${ev.met ? 'MET' : 'MISSED'} (${state.board.target.description}).`);
  lines.push(`Board confidence <b>${Math.round(state.board.confidence)}%</b> · Reputation <b>${Math.round(state.reputation)}</b>`);
  if (evalResult.sacked) lines.push(`<b style="color:#e0644a">THE BOARD HAVE SACKED YOU. Find a new club to continue.</b>`);
  else if (userFinish === 1) lines.push(`<b style="color:#39d98a">CHAMPIONS! The fans will never forget this season.</b>`);
  state.lastSeasonReview = lines;

  applyPromotionRelegation(state);

  if (evalResult.sacked) state.phase = 'job-offers';
  else startNextSeason(state, rng);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function startNextSeason(state: ManagerState, rng: Rng): void {
  state.season += 1;
  state.year += 1;
  state.matchday = 0;

  ageAndDevelopOffseason(state, rng);
  // youth intake refreshes the user's academy (and a little across the league)
  const intake = youthIntake(state, rng);
  const userSquad = state.squads[state.userClubId] ?? [];
  for (const p of intake) userSquad.push(p);

  // rebuild per-league team lists / fixtures / results from current tier assignments
  const nation = nationById(state.nationId);
  const allClubIds = Object.keys(state.clubTier);
  const byLeague = new Map<string, string[]>();
  for (const id of allClubIds) {
    const lid = state.clubLeagueId[id];
    if (!byLeague.has(lid)) byLeague.set(lid, []);
    byLeague.get(lid)!.push(id);
  }
  state.leagueTeamIds = {};
  state.fixtures = {};
  state.results = {};
  for (const [lid, ids] of byLeague) {
    const sorted = sortedTeamIds(ids);
    state.leagueTeamIds[lid] = sorted;
    state.fixtures[lid] = roundRobin(sorted.length, (state.seed + state.season * 131 + lid.length * 7) >>> 0);
    state.results[lid] = {};
  }
  state.totalRounds = Math.max(0, ...Object.values(state.fixtures).map((f) => f.length));

  const userStr = clubStrength(state.squads[state.userClubId] ?? []);
  state.transferBudget = clubBudget(userStr) + Math.round(state.transferBudget * 0.25);
  state.wageBudget = Math.max(50, Math.round(clubBudget(userStr) / 40));
  state.windowPhase = 'summer';
  state.board.target = seasonTargetFor(state, state.userClubId, state.clubTier[state.userClubId] ?? 1);
  state.board.warnings = 0;
  state.phase = 'in-season';
  state.pendingUserFixture = userFixtureThisMatchday(state);
  // close out the job-history "current" entry is handled by takeJob; mark a new season note
  void nation;
}

/** Accept a job at a new club (after being sacked or taking a bigger offer).
 *  Resets the career around the new club. Called by the Manager UI when
 *  phase === 'job-offers'. */
export function takeJob(state: ManagerState, clubId: string): void {
  if (!anyTeamById(clubId)) return;
  for (const job of state.jobHistory) {
    if (job.outcome === 'current') {
      job.seasonTo = state.season;
      job.outcome = state.phase === 'job-offers' ? 'sacked' : 'moved-up';
    }
  }
  state.userClubId = clubId;
  const tier = state.clubTier[clubId] ?? 1;
  const userStr = clubStrength(state.squads[clubId] ?? []);
  state.transferBudget = clubBudget(userStr);
  state.wageBudget = Math.max(50, Math.round(clubBudget(userStr) / 40));
  state.board.target = seasonTargetFor(state, clubId, tier);
  state.board.confidence = 60;
  state.board.warnings = 0;
  state.sentiment = { fans: 55, media: 55, squad: 60, pressure: 30 };
  state.jobHistory.push({ clubId, clubName: anyTeamById(clubId)?.name ?? clubId, tier, seasonFrom: state.season, seasonTo: null, outcome: 'current' });
  state.phase = 'in-season';
  state.pendingUserFixture = userFixtureThisMatchday(state);
}
