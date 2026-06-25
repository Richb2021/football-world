import type { StarsState } from './types';
import { CUP_TIERS } from './economy';
import { isCupWeekendOpen } from './weekly';

/** True if the player can enter the Cup Stars this weekend. */
export function cupCanEnter(state: StarsState, now: number): boolean {
  return (
    state.cup.qualified &&
    isCupWeekendOpen(now) &&
    !state.cup.finished &&
    state.cup.played < 10
  );
}

/** Mark the squad as cup-qualified. */
export function markCupQualified(state: StarsState): void {
  state.cup.qualified = true;
}

/**
 * Record a cup match result.
 * Increments played and wins/losses; sets finished when played reaches 10.
 */
export function cupRecord(state: StarsState, won: boolean): void {
  state.cup.played++;
  if (won) {
    state.cup.wins++;
  } else {
    state.cup.losses++;
  }
  if (state.cup.played >= 10) {
    state.cup.finished = true;
  }
}

export interface CupReward {
  coins: number;
  packIds: string[];
  tokens: number;
}

/**
 * Returns the cumulative rewards for all CUP_TIERS with wins >= tier.wins.
 */
export function cupRewards(wins: number): CupReward {
  let coins = 0;
  let tokens = 0;
  const packIds: string[] = [];

  for (const tier of CUP_TIERS) {
    if (wins >= tier.wins) {
      if (tier.coins !== undefined) coins += tier.coins;
      if (tier.packId !== undefined) packIds.push(tier.packId);
      if (tier.tokens !== undefined) tokens += tier.tokens;
    }
  }

  return { coins, packIds, tokens };
}
