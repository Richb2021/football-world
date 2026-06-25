import { describe, expect, it } from 'vitest';
import {
  ARCADE_TOKEN_RULES,
  addArcadeTokens,
  addPaidArcadeTokens,
  canSpendArcadeToken,
  createArcadeTokensState,
  ensureArcadeTokenGrants,
  spendArcadeToken,
} from '../arcadeTokens';

describe('arcade token wallet', () => {
  it('starts with enough tokens for a short arcade run', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));

    expect(state.balance).toBe(ARCADE_TOKEN_RULES.startingBalance);
    expect(state.lastDailyGrantDay).toBe('2026-06-20');
    expect(state.lastWeeklyGrantWeek).toBe('2026-W25');
  });

  it('adds one daily token only up to the daily refill cap', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));
    state.balance = 1;

    const changed = ensureArcadeTokenGrants(state, Date.UTC(2026, 5, 21));

    expect(changed).toBe(true);
    expect(state.balance).toBe(2);
    expect(state.lastDailyGrantDay).toBe('2026-06-21');
  });

  it('does not add the daily refill when already at the daily cap', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));
    state.balance = ARCADE_TOKEN_RULES.dailyRefillCap;

    ensureArcadeTokenGrants(state, Date.UTC(2026, 5, 21));

    expect(state.balance).toBe(ARCADE_TOKEN_RULES.dailyRefillCap);
  });

  it('adds the weekly token grant once and can go above the daily refill cap', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));

    ensureArcadeTokenGrants(state, Date.UTC(2026, 5, 22));
    const afterWeeklyGrant = state.balance;
    ensureArcadeTokenGrants(state, Date.UTC(2026, 5, 23));

    expect(afterWeeklyGrant).toBe(ARCADE_TOKEN_RULES.startingBalance + ARCADE_TOKEN_RULES.weeklyGrant);
    expect(state.balance).toBe(afterWeeklyGrant);
  });

  it('spends one token for a new Challenge Chronicle run or retry and rejects an empty wallet', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));

    expect(canSpendArcadeToken(state)).toBe(true);
    expect(spendArcadeToken(state)).toBe(true);
    expect(state.balance).toBe(ARCADE_TOKEN_RULES.startingBalance - 1);

    state.balance = 0;
    expect(canSpendArcadeToken(state)).toBe(false);
    expect(spendArcadeToken(state)).toBe(false);
    expect(state.balance).toBe(0);
  });

  it('caps earned bonus tokens at the max balance', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));

    addArcadeTokens(state, 999);

    expect(state.balance).toBe(ARCADE_TOKEN_RULES.maxBalance);
  });

  it('lets paid token purchases bypass the free-token max balance', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));
    state.balance = ARCADE_TOKEN_RULES.maxBalance - 2;

    addPaidArcadeTokens(state, 15);

    expect(state.balance).toBe(ARCADE_TOKEN_RULES.maxBalance + 13);
  });

  it('does not reduce a paid-over-cap balance during later free grants', () => {
    const state = createArcadeTokensState(Date.UTC(2026, 5, 20));
    state.balance = ARCADE_TOKEN_RULES.maxBalance + 10;

    ensureArcadeTokenGrants(state, Date.UTC(2026, 5, 22));

    expect(state.balance).toBe(ARCADE_TOKEN_RULES.maxBalance + 10);
  });
});
