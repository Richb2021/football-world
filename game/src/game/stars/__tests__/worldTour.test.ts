import { describe, expect, it } from 'vitest';
import { newStars } from '../store';
import {
  WORLD_TOUR_STAGES,
  applyWorldTourHandicap,
  currentWorldTourStage,
  recordWorldTourResult,
  worldTourOpponents,
} from '../worldTour';
import { starsMatchTeam } from '../squad';
import type { MatchConfig } from '../../../sim/types';

describe('World Tour', () => {
  it('has five weekly stages with unique handicaps', () => {
    expect(WORLD_TOUR_STAGES).toHaveLength(5);
    expect(new Set(WORLD_TOUR_STAGES.map((stage) => stage.handicap)).size).toBe(5);
  });

  it('generates five scaled opponents for the active week', () => {
    const state = newStars();
    const opponents = worldTourOpponents(state, '2026-W25');

    expect(opponents).toHaveLength(5);
    expect(opponents[4].overall).toBeGreaterThanOrEqual(opponents[0].overall);
  });

  it('advances stages on wins and locks after stage five', () => {
    const state = newStars();

    for (let i = 0; i < 5; i++) {
      recordWorldTourResult(state, { score: [2, 0], winner: 0 }, '2026-W25');
    }

    expect(state.worldTour.currentMatch).toBe(5);
    expect(state.worldTour.completed).toBe(true);
    expect(currentWorldTourStage(state)).toBeNull();
  });

  it('does not advance on a failed stage', () => {
    const state = newStars();

    recordWorldTourResult(state, { score: [0, 1], winner: 1 }, '2026-W25');

    expect(state.worldTour.currentMatch).toBe(0);
    expect(state.worldTour.completed).toBe(false);
  });

  it('can apply the negative momentum handicap to a match config', () => {
    const state = newStars();
    const home = starsMatchTeam(state, 'human');
    const away = starsMatchTeam(state, 'ai');
    const cfg: MatchConfig = {
      teams: [home, away],
      halfLengthSec: 60,
      difficulty: 1,
      cupTie: false,
      seed: 1,
    };

    applyWorldTourHandicap(cfg, WORLD_TOUR_STAGES.find((stage) => stage.handicap === 'negative-momentum')!);

    expect(cfg.initialMomentum?.[0]).toBeLessThan(0);
  });
});
