import type { MatchConfig } from '../../sim/types';
import { Rng } from '../../sim/rng';
import { ensureOwnerModeState, defaultWorldTourState } from './ownerMode';
import { genOpponent, hashString, type Opponent } from './opponents';
import { squadRating } from './squad';
import type { StarsState } from './types';

export type WorldTourHandicap =
  | 'no-chemistry'
  | 'negative-momentum'
  | 'hostile-press'
  | 'tired-legs'
  | 'must-win-by-two';

export interface WorldTourStage {
  index: number;
  title: string;
  handicap: WorldTourHandicap;
  rewardCoins: number;
}

export const WORLD_TOUR_STAGES: WorldTourStage[] = [
  { index: 0, title: 'Chemistry Test', handicap: 'no-chemistry', rewardCoins: 500 },
  { index: 1, title: 'Bad Start', handicap: 'negative-momentum', rewardCoins: 750 },
  { index: 2, title: 'Hostile Headlines', handicap: 'hostile-press', rewardCoins: 1000 },
  { index: 3, title: 'Heavy Legs', handicap: 'tired-legs', rewardCoins: 1250 },
  { index: 4, title: 'Owner Derby', handicap: 'must-win-by-two', rewardCoins: 2500 },
];

export function currentWorldTourStage(state: StarsState): WorldTourStage | null {
  ensureOwnerModeState(state);
  return state.worldTour.completed ? null : WORLD_TOUR_STAGES[state.worldTour.currentMatch] ?? null;
}

export function worldTourOpponents(state: StarsState, weekKey: string): Opponent[] {
  const base = Math.max(squadRating(state), 62);
  return WORLD_TOUR_STAGES.map((stage) => {
    const target = Math.max(54, Math.min(94, base - 4 + stage.index * 3));
    const rng = new Rng(hashString(`world-tour-${weekKey}-${stage.index}`));
    return genOpponent(rng, target, `World Tour ${stage.index + 1}`, `tour-${weekKey}-${stage.index}`);
  });
}

export function recordWorldTourResult(
  state: StarsState,
  outcome: { score: [number, number]; winner: -1 | 0 | 1 },
  weekKey: string,
): { advanced: boolean; completed: boolean; rewardCoins: number; lines: string[] } {
  ensureOwnerModeState(state);
  if (state.worldTour.weekKey !== weekKey) {
    state.worldTour = defaultWorldTourState(weekKey);
  }
  const stage = currentWorldTourStage(state);
  if (!stage) return { advanced: false, completed: true, rewardCoins: 0, lines: ['World Tour complete'] };

  const won = outcome.winner === 0;
  const wonByTwo = outcome.score[0] - outcome.score[1] >= 2;
  const cleared = won && (stage.handicap !== 'must-win-by-two' || wonByTwo);
  if (!cleared) {
    state.owner.pressPressure = Math.min(100, state.owner.pressPressure + 4);
    state.owner.headline = `${state.club.name} owner told to solve World Tour test.`;
    return { advanced: false, completed: false, rewardCoins: 0, lines: ['World Tour stage failed'] };
  }

  const firstClear = !state.worldTour.stageRewardsClaimed.includes(stage.index);
  const rewardCoins = firstClear ? stage.rewardCoins : 0;
  if (firstClear) state.worldTour.stageRewardsClaimed.push(stage.index);
  state.worldTour.currentMatch += 1;
  state.worldTour.completed = state.worldTour.currentMatch >= WORLD_TOUR_STAGES.length;
  state.owner.fanMood = Math.min(100, state.owner.fanMood + 3);
  state.owner.pressPressure = Math.max(0, state.owner.pressPressure - 2);
  state.owner.headline = state.worldTour.completed
    ? `${state.club.name} complete the World Tour.`
    : `${state.club.name} clear ${stage.title}.`;

  return {
    advanced: true,
    completed: state.worldTour.completed,
    rewardCoins,
    lines: [
      `World Tour: ${stage.title} cleared`,
      rewardCoins ? `+${rewardCoins} coins` : 'Reward already claimed',
    ],
  };
}

function starterForm(value: number, cfg: MatchConfig): Record<number, number> {
  return Object.fromEntries(cfg.teams[0].lineup.starters.map((idx) => [idx, value]));
}

export function applyWorldTourHandicap(cfg: MatchConfig, stage: WorldTourStage): void {
  if (stage.handicap === 'negative-momentum') cfg.initialMomentum = [-8, 4];
  if (stage.handicap === 'no-chemistry') cfg.teams[0].playerForm = starterForm(50, cfg);
  if (stage.handicap === 'hostile-press') cfg.initialMomentum = [-4, 2];
  if (stage.handicap === 'tired-legs') cfg.teams[0].playerForm = starterForm(44, cfg);
}
