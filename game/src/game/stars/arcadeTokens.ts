import { weekKeyFor } from './weekly';
import type { ArcadeTokensState } from './types';

export const ARCADE_TOKEN_RULES = {
  startingBalance: 3,
  dailyGrant: 1,
  dailyRefillCap: 3,
  weeklyGrant: 5,
  maxBalance: 20,
  paidMaxBalance: 999,
  challengeEntryCost: 1,
} as const;

export function arcadeDayKey(now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function createArcadeTokensState(now = Date.now()): ArcadeTokensState {
  return {
    balance: ARCADE_TOKEN_RULES.startingBalance,
    lastDailyGrantDay: arcadeDayKey(now),
    lastWeeklyGrantWeek: weekKeyFor(now),
  };
}

export function normaliseArcadeTokensState(
  state: ArcadeTokensState | null | undefined,
  now = Date.now(),
): ArcadeTokensState {
  if (!state || typeof state !== 'object') return createArcadeTokensState(now);
  const balance = Number.isFinite(state.balance) ? Math.floor(state.balance) : ARCADE_TOKEN_RULES.startingBalance;
  return {
    balance: clampPaidTokenBalance(balance),
    lastDailyGrantDay: state.lastDailyGrantDay || arcadeDayKey(now),
    lastWeeklyGrantWeek: state.lastWeeklyGrantWeek || weekKeyFor(now),
  };
}

export function ensureArcadeTokenGrants(state: ArcadeTokensState, now = Date.now()): boolean {
  let changed = false;
  const week = weekKeyFor(now);
  if (state.lastWeeklyGrantWeek !== week) {
    addArcadeTokens(state, ARCADE_TOKEN_RULES.weeklyGrant);
    state.lastWeeklyGrantWeek = week;
    changed = true;
  }

  const day = arcadeDayKey(now);
  if (state.lastDailyGrantDay !== day) {
    if (state.balance < ARCADE_TOKEN_RULES.dailyRefillCap) {
      const refill = Math.min(
        ARCADE_TOKEN_RULES.dailyGrant,
        ARCADE_TOKEN_RULES.dailyRefillCap - state.balance,
      );
      addArcadeTokens(state, refill);
    }
    state.lastDailyGrantDay = day;
    changed = true;
  }

  return changed;
}

export function addArcadeTokens(state: ArcadeTokensState, amount: number): ArcadeTokensState {
  const current = Math.max(0, Math.floor(state.balance));
  if (current >= ARCADE_TOKEN_RULES.maxBalance) {
    state.balance = clampPaidTokenBalance(current);
    return state;
  }
  state.balance = clampTokenBalance(current + Math.max(0, Math.floor(amount)));
  return state;
}

export function addPaidArcadeTokens(state: ArcadeTokensState, amount: number): ArcadeTokensState {
  state.balance = clampPaidTokenBalance(state.balance + Math.max(0, Math.floor(amount)));
  return state;
}

export function canSpendArcadeToken(
  state: ArcadeTokensState,
  cost = ARCADE_TOKEN_RULES.challengeEntryCost,
): boolean {
  return state.balance >= cost;
}

export function spendArcadeToken(
  state: ArcadeTokensState,
  cost = ARCADE_TOKEN_RULES.challengeEntryCost,
): boolean {
  if (!canSpendArcadeToken(state, cost)) return false;
  state.balance = Math.max(0, state.balance - cost);
  return true;
}

function clampTokenBalance(balance: number): number {
  return Math.max(0, Math.min(ARCADE_TOKEN_RULES.maxBalance, balance));
}

function clampPaidTokenBalance(balance: number): number {
  return Math.max(0, Math.min(ARCADE_TOKEN_RULES.paidMaxBalance, balance));
}
