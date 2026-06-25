import { TEAMS } from '../data/teams';
import { GROUPS_BY_ID } from '../data/worldCup';
import { autoLineup, normalizeLineupForFormation, overallRating, teamDefaultLineup } from '../sim/formations';
import { Rng } from '../sim/rng';
import { simulateFixture, simulateKnockout } from '../sim/statSim';
import type { FormationId, PlayerAttrs } from '../sim/types';
import { roundRobin, computeTable, type TableRow } from './fixtures';
import { aiTransferChurn, clubBudget } from './transfers';
import type { PhoneInbox, MoraleDelta, PressTone } from '../meta/metaTypes';
import type { CupNarrativeState } from './cupNarrative';
import { createEmptyCupNarrative, isInternationalCupCareer } from './cupNarrative';

/** dressing-room / public mood that the press + events move around (0-100). */
export interface CareerSentiment {
  fans: number;
  media: number;
  squad: number;
  pressure: number;
}

export const CAREER_MOMENTUM_MIN = -12;
export const CAREER_MOMENTUM_MAX = 12;

export type CareerMode = 'league' | 'cup' | 'season';
export type TrainingFocus = 'balanced' | 'fitness' | 'technical' | 'attacking' | 'defending';
export type TrainingIntensity = 'light' | 'normal' | 'hard';

export interface TrainingPlan {
  focus: TrainingFocus;
  intensity: TrainingIntensity;
}

export interface CareerPlayerState {
  fitness: number;
  form: number;
  morale: number;
  sharpness: number;
  unavailableUntilStep?: number;
  unavailableReason?: string;
}

export interface CareerBoard {
  expectation: string;
  confidence: number;
}

export interface TransferNegotiation {
  teamId: string;
  playerName: string;
  counterOffer: number;
  round: number;
}

export interface CupTie {
  a: number;
  b: number;
  score?: [number, number];
  etPens?: boolean;
  winner?: 0 | 1;
}

export interface CupRound {
  name: string;
  ties: CupTie[];
  byes: number[];
}

export type CalEvent =
  | { kind: 'window'; label: string }
  | { kind: 'league'; round: number }
  | { kind: 'cup'; round: number };

export interface Career {
  version: 2;
  mode: CareerMode;
  /** which league registry entry this career belongs to */
  leagueId?: string;
  /** the (possibly user-edited) World Cup groups as team ids, A–L. When set, the
   * cup runs with these instead of the default real-draw groups. */
  cupGroups?: string[][];
  /** User-entered International Cup manager identity. Falls back to generated
   * fictional manager names for older saves. */
  managerName?: string;
  seed: number;
  userTeam: number;
  formation: FormationId;
  starters: string[]; // player names; resolved against squad each match
  squads: Record<string, PlayerAttrs[]>;
  budget: number;
  calendar: CalEvent[];
  step: number;
  fixtures: [number, number][][];
  results: Record<string, [number, number]>;
  cupRounds: CupRound[];
  cupAlive: boolean;
  news: string[];
  training: TrainingPlan;
  playerStates: Record<string, CareerPlayerState>;
  board: CareerBoard;
  negotiations: TransferNegotiation[];
  finished: boolean;
  /** meta layer (cup mode): phone inbox, public/dressing-room mood, unhappy
   * players and any press conference currently owed. All optional for back-compat. */
  inbox?: PhoneInbox;
  sentiment?: CareerSentiment;
  /** Competition-level team momentum, keyed by team id. International Cup uses
   * this between fixtures; one-off modes leave match momentum at zero. */
  momentum?: Record<string, number>;
  unhappy?: string[];
  pendingPress?: PressTone | null;
  cupNarrative?: CupNarrativeState;
}

/** cup structure for any entry count: a preliminary round trims the field to a power of two */
export function cupStructure(teamCount: number) {
  let half = 1;
  while (half * 2 < teamCount) half *= 2; // field size after the preliminary round
  const prelimTies = teamCount - half; // ties needed to trim the field to `half`
  const sizeName = (size: number) => (
    size > 8 ? `Round of ${size}` : size === 8 ? 'Quarter-Final' : size === 4 ? 'Semi-Final' : 'Final'
  );
  const names: string[] = [];
  if (prelimTies > 0) names.push('First Round');
  for (let size = half; size >= 2; size /= 2) names.push(sizeName(size));
  return { half, prelimTies, roundCount: names.length, names };
}

/** The cup groups a career is using — the user-edited set if present, else the
 * default real-draw groups. */
export function careerGroups(career: Pick<Career, 'cupGroups'>): string[][] {
  return career.cupGroups ?? GROUPS_BY_ID;
}

export function newCareer(mode: CareerMode, userTeam: number, seed: number, leagueId?: string, cupGroups?: string[][]): Career {
  const rng = new Rng(seed);
  const squads: Record<string, PlayerAttrs[]> = {};
  for (const t of TEAMS) squads[t.id] = t.players.map((p) => ({ ...p }));

  const isWC = leagueId === 'international-cup';
  let groups = cupGroups ?? GROUPS_BY_ID;
  let fixtures: [number, number][][] = [];
  if (isWC) {
    const toIndices = (gs: string[][]) => gs.map(group =>
      group.map(id => TEAMS.findIndex(t => t.id === id)).filter(idx => idx !== -1)
    );
    // A custom/edited draw must give exactly 4 valid teams per group; otherwise the
    // fixture destructure below would emit `undefined` slots and corrupt the cup.
    // Fall back to the canonical groups so both the fixtures and the persisted
    // cupGroups stay valid.
    if (toIndices(groups).some((g) => g.length !== 4)) groups = GROUPS_BY_ID;
    const groupIndices = toIndices(groups);
    const groupFixtures: [number, number][][] = [[], [], []];
    for (const group of groupIndices) {
      const [g0, g1, g2, g3] = group;
      groupFixtures[0].push([g0, g1], [g2, g3]);
      groupFixtures[1].push([g0, g2], [g1, g3]);
      groupFixtures[2].push([g0, g3], [g1, g2]);
    }
    fixtures = groupFixtures;
  } else {
    fixtures = mode === 'cup' ? [] : roundRobin(TEAMS.length, seed);
  }

  const cup = cupStructure(isWC ? 32 : TEAMS.length);
  const cupRounds: CupRound[] = [];
  if (mode === 'cup' && isWC) {
    // We don't initialize cupRounds[0] yet, because we need to play the group stage first!
  } else if (mode !== 'league') {
    const order = shuffled(TEAMS.map((_, i) => i), rng);
    const ties = cup.prelimTies > 0 ? cup.prelimTies : TEAMS.length / 2;
    cupRounds.push({
      name: cup.names[0],
      ties: Array.from({ length: ties }, (_, i) => ({ a: order[i * 2], b: order[i * 2 + 1] })),
      byes: order.slice(ties * 2),
    });
  }

  const calendar: CalEvent[] = [];
  if (mode === 'league') {
    for (let r = 0; r < fixtures.length; r++) calendar.push({ kind: 'league', round: r });
  } else if (mode === 'cup') {
    if (isWC) {
      calendar.push({ kind: 'league', round: 0 });
      calendar.push({ kind: 'league', round: 1 });
      calendar.push({ kind: 'league', round: 2 });
      for (let r = 0; r < 5; r++) calendar.push({ kind: 'cup', round: r });
    } else {
      for (let r = 0; r < cup.roundCount; r++) calendar.push({ kind: 'cup', round: r });
    }
  } else {
    calendar.push({ kind: 'window', label: 'Pre-Season Transfer Window' });
    // spread the cup rounds evenly through the league season
    const cupAfter: Record<number, number> = {};
    for (let c = 0; c < cup.roundCount; c++) {
      cupAfter[Math.min(fixtures.length - 1, Math.round(((c + 1) * fixtures.length) / (cup.roundCount + 0.2)) - 1)] = c;
    }
    const midWindow = Math.floor(fixtures.length / 2) - 1;
    for (let r = 0; r < fixtures.length; r++) {
      calendar.push({ kind: 'league', round: r });
      if (r === midWindow) calendar.push({ kind: 'window', label: 'January Transfer Window' });
      if (cupAfter[r] !== undefined) calendar.push({ kind: 'cup', round: cupAfter[r] });
    }
  }

  const team = TEAMS[userTeam];
  const initialLineup = teamDefaultLineup({ ...team, players: squads[team.id] });
  const formation: FormationId = initialLineup.formation;
  const xi = initialLineup.starters;
  const career: Career = {
    version: 2,
    mode,
    leagueId,
    cupGroups: isWC ? groups.map((g) => [...g]) : undefined,
    seed,
    userTeam,
    formation,
    starters: xi.map((i) => squads[team.id][i].name),
    squads,
    budget: mode === 'season' ? clubBudget(team.strength) : 0,
    calendar,
    step: 0,
    fixtures,
    results: {},
    cupRounds,
    cupAlive: mode !== 'league',
    news: [],
    training: { focus: 'balanced', intensity: 'normal' },
    playerStates: {},
    board: boardForTeam(team.strength),
    negotiations: [],
    momentum: {},
    finished: false,
  };
  ensureCareerSystems(career);
  return career;
}

export function ensureCareerSystems(career: Career): Career {
  career.training ??= { focus: 'balanced', intensity: 'normal' };
  career.playerStates ??= {};
  career.board ??= boardForTeam(TEAMS[career.userTeam]?.strength ?? 70);
  career.negotiations ??= [];
  career.inbox ??= { messages: [] };
  career.sentiment ??= { fans: 60, media: 55, squad: 60, pressure: 40 };
  career.momentum ??= {};
  career.unhappy ??= [];
  career.pendingPress ??= null;
  if (isInternationalCupCareer(career)) {
    career.cupNarrative ??= createEmptyCupNarrative(career.step ?? 0);
    career.cupNarrative.arcs ??= [];
    career.cupNarrative.headlines ??= [];
    career.cupNarrative.requiredMessageIds ??= [];
    career.cupNarrative.pendingTeamEvents ??= [];
    career.cupNarrative.lastGeneratedStep ??= career.step ?? 0;
  }
  const teamId = TEAMS[career.userTeam]?.id;
  const squad = teamId ? career.squads[teamId] ?? [] : [];
  for (const player of squad) {
    const key = playerStateKey(teamId, player.name);
    career.playerStates[key] ??= {
      fitness: 84,
      form: 50,
      morale: 58,
      sharpness: 56,
    };
  }
  return career;
}

function unavailableStateActive(state: CareerPlayerState | undefined, step: number): boolean {
  return (state?.unavailableUntilStep ?? -1) > step;
}

export function isPlayerUnavailable(career: Career, teamId: string, playerName: string): boolean {
  ensureCareerSystems(career);
  return unavailableStateActive(career.playerStates[playerStateKey(teamId, playerName)], career.step);
}

export function playerAvailabilityLabel(career: Career, teamId: string, playerName: string): string | null {
  ensureCareerSystems(career);
  const state = career.playerStates[playerStateKey(teamId, playerName)];
  if (!unavailableStateActive(state, career.step)) return null;
  return state?.unavailableReason ?? 'OUT NEXT MATCH';
}

export function markPlayerUnavailable(
  career: Career,
  teamId: string,
  playerName: string,
  unavailableMatches: number,
  reason = 'Unavailable',
): void {
  ensureCareerSystems(career);
  const state = career.playerStates[playerStateKey(teamId, playerName)];
  if (!state) return;
  const matches = Math.max(1, Math.ceil(unavailableMatches));
  state.unavailableUntilStep = Math.max(state.unavailableUntilStep ?? career.step, career.step + matches);
  state.unavailableReason = reason;
}

export function careerStarterIndexes(career: Career, formation: FormationId = career.formation, requestedIndexes?: number[]): number[] {
  ensureCareerSystems(career);
  const teamId = TEAMS[career.userTeam].id;
  const squad = career.squads[teamId] ?? [];
  const unavailable = new Set(squad
    .map((p, i) => (isPlayerUnavailable(career, teamId, p.name) ? i : -1))
    .filter((i) => i >= 0));
  const requested = requestedIndexes
    ? requestedIndexes.filter((i, idx, arr) => i >= 0 && i < squad.length && arr.indexOf(i) === idx)
    : career.starters
      .map((name) => squad.findIndex((p) => p.name === name))
      .filter((i) => i >= 0);
  let starters = normalizeLineupForFormation(squad, formation, requested.filter((i) => !unavailable.has(i)))
    .filter((i, idx, arr) => !unavailable.has(i) && arr.indexOf(i) === idx);
  if (starters.length >= 11) return starters.slice(0, 11);

  const available = squad.map((player, idx) => ({ player, idx })).filter(({ idx }) => !unavailable.has(idx));
  if (available.length >= 11) {
    const availableStarters = autoLineup(available.map(({ player }) => player), formation).map((idx) => available[idx].idx);
    if (availableStarters.length >= 11) return availableStarters.slice(0, 11);
  }

  starters = normalizeLineupForFormation(squad, formation, starters);
  return starters.length >= 11 ? starters.slice(0, 11) : autoLineup(squad, formation);
}

export function careerMomentumForTeam(career: Career, teamIdx: number): number {
  ensureCareerSystems(career);
  const id = TEAMS[teamIdx]?.id;
  if (!id) return 0;
  return clamp(career.momentum?.[id] ?? 0, CAREER_MOMENTUM_MIN, CAREER_MOMENTUM_MAX);
}

export function setCareerMomentumForTeam(career: Career, teamIdx: number, value: number): void {
  ensureCareerSystems(career);
  const id = TEAMS[teamIdx]?.id;
  if (!id) return;
  career.momentum![id] = clamp(value, CAREER_MOMENTUM_MIN, CAREER_MOMENTUM_MAX);
}

export function adjustCareerMomentumForTeam(career: Career, teamIdx: number, delta: number): void {
  setCareerMomentumForTeam(career, teamIdx, careerMomentumForTeam(career, teamIdx) + delta);
}

export function recordCareerMatchMomentum(
  career: Career,
  homeIdx: number,
  awayIdx: number,
  matchMomentum: [number, number],
  score?: [number, number],
): void {
  ensureCareerSystems(career);
  const apply = (teamIdx: number, side: 0 | 1) => {
    const current = careerMomentumForTeam(career, teamIdx);
    const scoreSwing = score ? (score[side] - score[1 - side]) * 0.55 : 0;
    const next = current * 0.42 + matchMomentum[side] * 0.72 + scoreSwing;
    setCareerMomentumForTeam(career, teamIdx, next);
  };
  apply(homeIdx, 0);
  apply(awayIdx, 1);
}

export function recordCareerResultMomentum(career: Career, homeIdx: number, awayIdx: number, score: [number, number]): void {
  const homeDiff = score[0] - score[1];
  const awayDiff = -homeDiff;
  const homeResult = homeDiff > 0 ? 2.2 : homeDiff < 0 ? -2.0 : 0.25;
  const awayResult = awayDiff > 0 ? 2.2 : awayDiff < 0 ? -2.0 : 0.25;
  recordCareerMatchMomentum(career, homeIdx, awayIdx, [
    clamp(homeResult + homeDiff * 0.35, CAREER_MOMENTUM_MIN, CAREER_MOMENTUM_MAX),
    clamp(awayResult + awayDiff * 0.35, CAREER_MOMENTUM_MIN, CAREER_MOMENTUM_MAX),
  ], score);
}

export function setTrainingPlan(career: Career, plan: Partial<TrainingPlan>) {
  ensureCareerSystems(career);
  career.training = {
    focus: plan.focus ?? career.training.focus,
    intensity: plan.intensity ?? career.training.intensity,
  };
  career.news.push(`Training set to ${trainingLabel(career.training)}.`);
}

export function applyTrainingWeek(career: Career, rng = new Rng(career.seed ^ career.step)): void {
  ensureCareerSystems(career);
  const teamId = TEAMS[career.userTeam].id;
  const squad = career.squads[teamId] ?? [];
  if (!squad.length) return;
  const plan = career.training;
  const workload = plan.intensity === 'hard' ? 1.35 : plan.intensity === 'light' ? 0.72 : 1;
  const recovery = plan.intensity === 'light' ? 5 : plan.intensity === 'hard' ? -5 : 1;
  const picks = shuffled(squad.map((_, i) => i), rng).slice(0, plan.intensity === 'hard' ? 5 : 4);
  for (const idx of picks) {
    const player = squad[idx];
    const state = career.playerStates[playerStateKey(teamId, player.name)] ??= {
      fitness: 84,
      form: 50,
      morale: 58,
      sharpness: 56,
    };
    state.fitness = clamp(state.fitness + recovery + rng.range(-1.5, 2.5), 35, 100);
    state.sharpness = clamp(state.sharpness + 4 * workload + rng.range(0, 2.5), 0, 100);
    state.form = clamp(state.form + 1.8 * workload + rng.range(-1, 2), 0, 100);
    state.morale = clamp(state.morale + (plan.intensity === 'hard' ? -1 : 1) + rng.range(-1, 2), 0, 100);
    improvePlayerForTraining(player, plan.focus, workload, rng);
  }
  const first = squad[picks[0]];
  if (first) career.news.push(`${trainingLabel(plan)} lifted ${first.name}'s sharpness in training.`);
}

/** live strength: half base reputation, half current squad quality, nudged by
 * the user squad's form (the only side that tracks form). */
export function effectiveStrength(career: Career, teamIdx: number): number {
  ensureCareerSystems(career);
  const t = TEAMS[teamIdx];
  const squad = career.squads[t.id];
  const ratingPool = teamIdx === career.userTeam
    ? squad.filter((p) => !isPlayerUnavailable(career, t.id, p.name))
    : squad;
  const ratings = (ratingPool.length >= 11 ? ratingPool : squad).map((p) => overallRating(p)).sort((a, b) => b - a).slice(0, 11);
  const avg = ratings.reduce((s, v) => s + v, 0) / (ratings.length || 1);
  let base = t.strength * 0.5 + avg * 0.55;
  if (teamIdx === career.userTeam) {
    const forms = squad.map((p) => career.playerStates[playerStateKey(t.id, p.name)]?.form ?? 50);
    const avgForm = forms.reduce((s, v) => s + v, 0) / (forms.length || 1);
    base += (avgForm - 50) * 0.06; // ±3 strength swing at form extremes
  }
  if (career.leagueId === 'international-cup') {
    base += careerMomentumForTeam(career, teamIdx) * 0.18;
  }
  return base;
}

/** Per-squad-index current form (0-100) for the user's team, for MatchTeamConfig.playerForm. */
export function userStarterForm(career: Career): Record<number, number> {
  ensureCareerSystems(career);
  const teamId = TEAMS[career.userTeam].id;
  const squad = career.squads[teamId] ?? [];
  const map: Record<number, number> = {};
  squad.forEach((p, i) => {
    map[i] = career.playerStates[playerStateKey(teamId, p.name)]?.form ?? 50;
  });
  return map;
}

export function currentEvent(career: Career): CalEvent | null {
  ensureCareerSystems(career);
  return career.calendar[career.step] ?? null;
}

export function userFixture(career: Career): { opponent: number; home: boolean; round: number } | null {
  ensureCareerSystems(career);
  const ev = currentEvent(career);
  if (!ev) return null;
  if (ev.kind === 'league') {
    const round = career.fixtures[ev.round];
    for (const [h, a] of round) {
      if (h === career.userTeam) return { opponent: a, home: true, round: ev.round };
      if (a === career.userTeam) return { opponent: h, home: false, round: ev.round };
    }
    return null;
  }
  if (ev.kind === 'cup' && career.cupAlive) {
    const cup = career.cupRounds[ev.round];
    if (!cup) return null;
    for (const tie of cup.ties) {
      if (tie.a === career.userTeam) return { opponent: tie.b, home: true, round: ev.round };
      if (tie.b === career.userTeam) return { opponent: tie.a, home: false, round: ev.round };
    }
  }
  return null;
}

/**
 * Resolve the current calendar event. userScore is [userGoals, oppGoals] when the user
 * played a match this event (cup: pass userWon for shootout outcomes).
 */
export function advance(career: Career, userScore?: [number, number], userWon?: boolean) {
  ensureCareerSystems(career);
  const ev = currentEvent(career);
  if (!ev) { career.finished = true; return; }
  const rng = new Rng(career.seed ^ (career.step * 2654435761));

  if (ev.kind === 'window') {
    career.news.push(...aiTransferChurn(career.squads, TEAMS[career.userTeam].id, rng).map((n) => n.text));
  } else if (ev.kind === 'league') {
    const round = career.fixtures[ev.round];
    round.forEach(([h, a], i) => {
      const key = `${ev.round}:${i}`;
      if (career.results[key]) return;
      if (h === career.userTeam || a === career.userTeam) {
        if (userScore) {
          career.results[key] = h === career.userTeam ? [userScore[0], userScore[1]] : [userScore[1], userScore[0]];
        }
        return;
      }
      const result = simulateFixture(effectiveStrength(career, h), effectiveStrength(career, a), rng);
      career.results[key] = result;
      if (career.leagueId === 'international-cup') recordCareerResultMomentum(career, h, a, result);
    });
    // Transition World Cup groups to Round of 32
    if (ev.round === 2 && career.leagueId === 'international-cup') {
      const qualified = computeWorldCupKnockoutTeams(career);
      const order = shuffled(qualified, rng);
      career.cupRounds[0] = {
        name: 'Round of 32',
        ties: Array.from({ length: 16 }, (_, i) => ({ a: order[i * 2], b: order[i * 2 + 1] })),
        byes: [],
      };
      career.cupAlive = qualified.includes(career.userTeam);
      if (!career.cupAlive) {
        career.news.push(`You finished outside the qualifying spots. You are out of the cup.`);
      } else {
        career.news.push(`Brilliant! You qualified for the Round of 32!`);
      }
    }
  } else if (ev.kind === 'cup') {
    const cup = career.cupRounds[ev.round];
    if (cup) {
      for (const tie of cup.ties) {
        if (tie.winner !== undefined) continue;
        const isUser = tie.a === career.userTeam || tie.b === career.userTeam;
        if (isUser && career.cupAlive && userScore) {
          const userIsA = tie.a === career.userTeam;
          tie.score = userIsA ? [userScore[0], userScore[1]] : [userScore[1], userScore[0]];
          const w = userScore[0] === userScore[1]
            ? (userWon ? 0 : 1) // shootout
            : userScore[0] > userScore[1] ? 0 : 1;
          tie.winner = (userIsA ? w : 1 - w) as 0 | 1;
          tie.etPens = userScore[0] === userScore[1];
          if ((tie.winner === 0 ? tie.a : tie.b) !== career.userTeam) career.cupAlive = false;
        } else {
          const r = simulateKnockout(effectiveStrength(career, tie.a), effectiveStrength(career, tie.b), rng);
          tie.score = r.score;
          tie.winner = r.winner;
          tie.etPens = r.etPens;
          if (career.leagueId === 'international-cup') recordCareerResultMomentum(career, tie.a, tie.b, r.score);
          if (isUser) career.cupAlive = false;
        }
      }
      // build next round
      const winners = cup.ties.map((t) => (t.winner === 0 ? t.a : t.b));
      const pool = [...winners, ...cup.byes];
      const structure = cupStructure(career.leagueId === 'international-cup' ? 32 : TEAMS.length);
      if (pool.length >= 2 && ev.round < structure.roundCount - 1) {
        const order = shuffled(pool, rng);
        career.cupRounds[ev.round + 1] = {
          name: structure.names[ev.round + 1] ?? 'Final',
          ties: Array.from({ length: order.length / 2 }, (_, i) => ({ a: order[i * 2], b: order[i * 2 + 1] })),
          byes: [],
        };
      }
    }
  }

  if (career.mode === 'season') applyTrainingWeek(career, rng);
  updateBoardConfidence(career);
  career.step++;
  if (career.step >= career.calendar.length) career.finished = true;
}

export function leagueTable(career: Career): TableRow[] {
  ensureCareerSystems(career);
  const results = new Map(Object.entries(career.results).map(([k, v]) => [k, v] as [string, [number, number]]));
  return computeTable(TEAMS.length, results, career.fixtures);
}

export function cupWinner(career: Career): number | null {
  ensureCareerSystems(career);
  const final = career.cupRounds[cupStructure(career.leagueId === 'international-cup' ? 32 : TEAMS.length).roundCount - 1];
  const tie = final?.ties[0];
  if (tie?.winner === undefined) return null;
  return tie.winner === 0 ? tie.a : tie.b;
}

export function playerStateKey(teamId: string, playerName: string): string {
  return `${teamId}:${playerName}`;
}

function boardForTeam(strength: number): CareerBoard {
  const expectation = strength >= 84
    ? 'Finish in the top four and challenge for the cup'
    : strength >= 74
      ? 'Finish in the top half'
      : strength >= 64
        ? 'Finish clear of trouble'
        : 'Finish above the relegation places';
  return { expectation, confidence: 65 };
}

function updateBoardConfidence(career: Career) {
  if (career.mode === 'cup' || !career.fixtures.length) return;
  const table = leagueTable(career);
  const pos = table.findIndex((row) => row.team === career.userTeam) + 1;
  if (!pos) return;
  const strength = TEAMS[career.userTeam].strength;
  const target = strength >= 84 ? 4 : strength >= 74 ? 10 : strength >= 64 ? 16 : 19;
  const delta = target - pos;
  career.board.confidence = clamp(career.board.confidence + delta * 0.35, 8, 98);
}

function improvePlayerForTraining(player: PlayerAttrs, focus: TrainingFocus, workload: number, rng: Rng) {
  const bump = () => (rng.next() < 0.32 * workload ? 1 : 0);
  const improve = (key: 'pace' | 'pass' | 'shoot' | 'tackle' | 'keeping') => {
    player[key] = Math.min(99, player[key] + bump());
  };
  if (focus === 'balanced') {
    improve(player.pos === 'GK' ? 'keeping' : player.pos === 'DF' ? 'tackle' : player.pos === 'FW' ? 'shoot' : 'pass');
    if (rng.next() < 0.4) improve('pace');
  } else if (focus === 'fitness') {
    improve('pace');
  } else if (focus === 'technical') {
    improve('pass');
  } else if (focus === 'attacking') {
    improve('shoot');
    if (player.pos !== 'GK') improve('pass');
  } else if (focus === 'defending') {
    improve(player.pos === 'GK' ? 'keeping' : 'tackle');
  }
}

function trainingLabel(plan: TrainingPlan): string {
  const focus = plan.focus[0].toUpperCase() + plan.focus.slice(1);
  return `${focus} ${plan.intensity}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function shuffled<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeWorldCupKnockoutTeams(career: Career): number[] {
  const groupIndices = careerGroups(career).map(group =>
    group.map(id => TEAMS.findIndex(t => t.id === id)).filter(idx => idx !== -1)
  );

  const standings = groupIndices.map((group, groupIdx) => {
    const stats = group.map(teamIdx => ({
      team: teamIdx,
      pts: 0,
      gd: 0,
      gf: 0
    }));

    for (let r = 0; r < 3; r++) {
      const roundFixtures = career.fixtures[r];
      if (!roundFixtures) continue;
      roundFixtures.forEach(([h, a], i) => {
        if (group.includes(h) && group.includes(a)) {
          const key = `${r}:${i}`;
          const res = career.results[key];
          if (res) {
            const [gh, ga] = res;
            const hStat = stats.find(s => s.team === h);
            const aStat = stats.find(s => s.team === a);
            if (hStat && aStat) {
              hStat.gf += gh;
              hStat.gd += (gh - ga);
              aStat.gf += ga;
              aStat.gd += (ga - gh);
              if (gh > ga) hStat.pts += 3;
              else if (ga > gh) aStat.pts += 3;
              else { hStat.pts += 1; aStat.pts += 1; }
            }
          }
        }
      });
    }

    stats.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });

    return stats;
  });

  const top2: { team: number; pts: number; gd: number; gf: number }[] = [];
  const thirds: { team: number; pts: number; gd: number; gf: number }[] = [];
  standings.forEach(groupStats => {
    top2.push(groupStats[0], groupStats[1]);
    thirds.push(groupStats[2]);
  });

  thirds.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });

  const best8Thirds = thirds.slice(0, 8);
  return [...top2, ...best8Thirds].map(s => s.team);
}

export function groupStandingForUser(career: Career): string {
  const userTeamIdx = career.userTeam;
  const groups = careerGroups(career);
  const groupIdx = groups.findIndex(group =>
    group.some(id => TEAMS.findIndex(t => t.id === id) === userTeamIdx)
  );
  if (groupIdx === -1) return '';
  const groupChar = String.fromCharCode(65 + groupIdx); // A, B, C...

  const group = groups[groupIdx].map(id => TEAMS.findIndex(t => t.id === id)).filter(idx => idx !== -1);
  const stats = group.map(teamIdx => ({
    team: teamIdx,
    pts: 0,
    gd: 0,
    gf: 0
  }));

  for (let r = 0; r < 3; r++) {
    const roundFixtures = career.fixtures[r];
    if (!roundFixtures) continue;
    roundFixtures.forEach(([h, a], i) => {
      if (group.includes(h) && group.includes(a)) {
        const key = `${r}:${i}`;
        const res = career.results[key];
        if (res) {
          const [gh, ga] = res;
          const hStat = stats.find(s => s.team === h);
          const aStat = stats.find(s => s.team === a);
          if (hStat && aStat) {
            hStat.gf += gh; hStat.gd += (gh - ga);
            aStat.gf += ga; aStat.gd += (ga - gh);
            if (gh > ga) hStat.pts += 3;
            else if (ga > gh) aStat.pts += 3;
            else { hStat.pts += 1; aStat.pts += 1; }
          }
        }
      }
    });
  }

  stats.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });

  const pos = stats.findIndex(s => s.team === userTeamIdx) + 1;
  return `GP ${groupChar}: P${pos}`;
}
