import type { StarsState } from './types';
import { defaultRivalsState, defaultWorldTourState, ensureOwnerModeState } from './ownerMode';

/** Returns the ISO-8601 week key (UTC) for the given epoch ms, e.g. '2026-W25'. */
export function weekKeyFor(now: number): string {
  const d = new Date(now);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fdNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** True on Saturday (6) or Sunday (0) UTC. */
export function isCupWeekendOpen(now: number): boolean {
  const day = new Date(now).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Resets challenge, battles, and cup if the ISO week has rolled over.
 * Returns the (mutated) state. Caller is responsible for persisting.
 */
export function resetIfNewWeek(state: StarsState, now: number): StarsState {
  const wk = weekKeyFor(now);
  ensureOwnerModeState(state, now);
  if (state.challenge.weekKey !== wk) {
    state.challenge = { weekKey: wk, points: 0, played: 0, rewardsClaimed: [] };
    state.battles = { weekKey: wk, points: 0, played: 0 };
    state.cup = {
      weekKey: wk,
      qualified: false,
      played: 0,
      wins: 0,
      losses: 0,
      finished: false,
      rewardClaimed: false,
    };
    state.rivals = defaultRivalsState(wk);
    state.worldTour = defaultWorldTourState(wk);
    state.owner.form = [];
    state.owner.headline = 'A new All Star week begins.';
  }
  return state;
}
