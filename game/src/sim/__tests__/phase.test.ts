import { describe, it, expect } from 'vitest';
import { isBreakPhase } from '../phase';
import type { SimPhase } from '../types';

describe('isBreakPhase', () => {
  const breaks: SimPhase[] = [
    'kickoff', 'throwIn', 'corner', 'goalKick', 'freeKick', 'goalCelebration',
    'halfTime', 'extraTimeBreak',
  ];
  const live: SimPhase[] = ['play', 'penaltyKick', 'penalties', 'fullTime', 'finished'];

  it('treats every stoppage as a break', () => {
    for (const p of breaks) expect(isBreakPhase(p)).toBe(true);
  });

  it('does not treat open play, live penalties, or the end states as a break', () => {
    for (const p of live) expect(isBreakPhase(p)).toBe(false);
  });
});
