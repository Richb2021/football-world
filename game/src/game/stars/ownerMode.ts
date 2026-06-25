import type { StarsOwnerProfile, StarsRivalsWeeklyState, StarsState, StarsWorldTourState } from './types';
import { weekKeyFor } from './weekly';

export function defaultOwnerProfile(): StarsOwnerProfile {
  return {
    boardMood: 55,
    fanMood: 55,
    pressPressure: 35,
    form: [],
    headline: 'A new owner era begins.',
  };
}

export function defaultRivalsState(weekKey: string): StarsRivalsWeeklyState {
  return {
    weekKey,
    points: 0,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    rewardsClaimed: [],
  };
}

export function defaultWorldTourState(weekKey: string): StarsWorldTourState {
  return {
    weekKey,
    currentMatch: 0,
    completed: false,
    rewardsClaimed: false,
    stageRewardsClaimed: [],
  };
}

export function ensureOwnerModeState<T extends StarsState>(state: T, now = Date.now()): T {
  const weekKey = weekKeyFor(now);
  state.owner ??= defaultOwnerProfile();
  state.owner.form ??= [];
  state.rivals ??= defaultRivalsState(weekKey);
  state.worldTour ??= defaultWorldTourState(weekKey);
  if (!state.rivals.weekKey) state.rivals.weekKey = weekKey;
  if (!state.worldTour.weekKey) state.worldTour.weekKey = weekKey;
  return state;
}

export function ownerPressureLabel(owner: StarsOwnerProfile): 'LOW' | 'STEADY' | 'HIGH' | 'CRISIS' {
  if (owner.pressPressure >= 85) return 'CRISIS';
  if (owner.pressPressure >= 65) return 'HIGH';
  if (owner.pressPressure >= 40) return 'STEADY';
  return 'LOW';
}

export function currentRivalsDivision(rivals: StarsRivalsWeeklyState): number {
  return Math.max(1, Math.min(10, 10 - Math.floor(rivals.points / 350)));
}

type StarsOutcome = { score: [number, number]; winner: -1 | 0 | 1 };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function weeklyRivalsPoints(outcome: StarsOutcome): number {
  const goalsFor = outcome.score[0];
  const goalsAgainst = outcome.score[1];
  const base = outcome.winner === 0 ? 120 : outcome.winner === -1 ? 55 : 20;
  return base + goalsFor * 12 + (goalsAgainst === 0 ? 25 : 0);
}

export function applyWeeklyRivalsResult(
  state: StarsState,
  outcome: StarsOutcome,
  now = Date.now(),
): { points: number; lines: string[] } {
  ensureOwnerModeState(state, now);
  const weekKey = weekKeyFor(now);
  if (state.rivals.weekKey !== weekKey) state.rivals = defaultRivalsState(weekKey);

  const points = weeklyRivalsPoints(outcome);
  const result = outcome.winner === 0 ? 'W' : outcome.winner === -1 ? 'D' : 'L';
  state.rivals.points += points;
  state.rivals.played += 1;
  if (result === 'W') state.rivals.wins += 1;
  else if (result === 'D') state.rivals.draws += 1;
  else state.rivals.losses += 1;
  state.owner.form = [result, ...state.owner.form].slice(0, 5);

  const heavyLoss = outcome.winner === 1 && outcome.score[1] - outcome.score[0] >= 3;
  const win = outcome.winner === 0;
  state.owner.fanMood = clamp(state.owner.fanMood + (win ? 5 : heavyLoss ? -8 : -3), 0, 100);
  state.owner.boardMood = clamp(state.owner.boardMood + (win ? 3 : heavyLoss ? -7 : -2), 0, 100);
  state.owner.pressPressure = clamp(state.owner.pressPressure + (win ? -5 : heavyLoss ? 12 : 5), 0, 100);
  state.owner.headline = win
    ? `${state.club.name} owner gets reward for a bold week.`
    : heavyLoss
      ? `Questions grow around ${state.club.name}'s owner after a heavy defeat.`
      : `${state.club.name} owner faces pressure after dropped points.`;

  return { points, lines: [`Weekly Rivals +${points} pts`, state.owner.headline] };
}
