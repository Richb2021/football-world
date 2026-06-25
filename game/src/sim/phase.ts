import type { SimPhase } from './types';

/**
 * A "break" is any stoppage in play — the only time a substitution may be made
 * and the moment a queued online pause is allowed to take effect. Open play,
 * a live penalty, the shoot-out, and the finished states are NOT breaks.
 */
export function isBreakPhase(phase: SimPhase): boolean {
  return (
    phase !== 'play'
    && phase !== 'penaltyKick'
    && phase !== 'penalties'
    && phase !== 'fullTime'
    && phase !== 'finished'
  );
}
