import { describe, it, expect } from 'vitest';
import { weekKeyFor, isCupWeekendOpen, resetIfNewWeek } from '../weekly';
import type { StarsState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(weekKey: string): StarsState {
  return {
    version: 1,
    coins: 0,
    owned: {},
    squad: { formation: '4-4-2', starters: new Array(11).fill(null) },
    club: { name: 'Test FC', kit: { shirt: '#fff', shorts: '#fff', socks: '#fff' } },
    challenge: { weekKey, points: 99, played: 5, rewardsClaimed: [0] },
    cup: { weekKey, qualified: true, played: 3, wins: 2, losses: 1, finished: false, rewardClaimed: false },
    battles: { weekKey, points: 50, played: 4 },
    owner: {
      boardMood: 44,
      fanMood: 42,
      pressPressure: 68,
      form: ['L', 'W'],
      headline: 'Old pressure follows the owner.',
    },
    rivals: {
      weekKey,
      points: 777,
      played: 7,
      wins: 4,
      draws: 1,
      losses: 2,
      rewardsClaimed: [350],
    },
    worldTour: {
      weekKey,
      currentMatch: 2,
      completed: false,
      rewardsClaimed: false,
      stageRewardsClaimed: [0, 1],
    },
    weekly: { lastGrantWeek: weekKey },
    arcadeTokens: { balance: 2, lastDailyGrantDay: '2026-06-14', lastWeeklyGrantWeek: weekKey },
    packRngSeed: 42,
  };
}

// ---------------------------------------------------------------------------
// weekKeyFor
// ---------------------------------------------------------------------------
describe('weekKeyFor', () => {
  it('returns a string matching ISO week format', () => {
    // 2026-06-16 is a Tuesday — week 25
    const ts = Date.UTC(2026, 5, 16); // month is 0-indexed
    const key = weekKeyFor(ts);
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('2026-06-18 (Thursday) is in 2026-W25', () => {
    // 18 Jun 2026 is a Thursday
    const ts = Date.UTC(2026, 5, 18);
    expect(weekKeyFor(ts)).toBe('2026-W25');
  });

  it('Monday of same week and Sunday both share a key', () => {
    // 2026-06-15 = Monday W25, 2026-06-21 = Sunday W25
    const mon = Date.UTC(2026, 5, 15);
    const sun = Date.UTC(2026, 5, 21);
    expect(weekKeyFor(mon)).toBe(weekKeyFor(sun));
  });

  it('consecutive weeks produce different keys', () => {
    const week25Mon = Date.UTC(2026, 5, 15);
    const week26Mon = Date.UTC(2026, 5, 22);
    expect(weekKeyFor(week25Mon)).not.toBe(weekKeyFor(week26Mon));
  });

  it('timestamps exactly one week apart differ', () => {
    const ts = Date.UTC(2026, 5, 16);
    const tsPlus7 = ts + 7 * 24 * 3600 * 1000;
    expect(weekKeyFor(ts)).not.toBe(weekKeyFor(tsPlus7));
  });

  it('Jan 1 2026 (Thursday) is in W01', () => {
    // 2026-01-01 is a Thursday
    const ts = Date.UTC(2026, 0, 1);
    expect(weekKeyFor(ts)).toBe('2026-W01');
  });
});

// ---------------------------------------------------------------------------
// isCupWeekendOpen
// ---------------------------------------------------------------------------
describe('isCupWeekendOpen', () => {
  it('true on a known Saturday (2026-06-20)', () => {
    const sat = Date.UTC(2026, 5, 20);
    expect(isCupWeekendOpen(sat)).toBe(true);
  });

  it('true on a known Sunday (2026-06-21)', () => {
    const sun = Date.UTC(2026, 5, 21);
    expect(isCupWeekendOpen(sun)).toBe(true);
  });

  it('false on a Wednesday (2026-06-17)', () => {
    const wed = Date.UTC(2026, 5, 17);
    expect(isCupWeekendOpen(wed)).toBe(false);
  });

  it('false on a Monday', () => {
    const mon = Date.UTC(2026, 5, 15);
    expect(isCupWeekendOpen(mon)).toBe(false);
  });

  it('false on a Friday', () => {
    const fri = Date.UTC(2026, 5, 19);
    expect(isCupWeekendOpen(fri)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resetIfNewWeek
// ---------------------------------------------------------------------------
describe('resetIfNewWeek', () => {
  it('resets counters when the week changes', () => {
    const oldWeek = '2026-W24';
    const state = makeState(oldWeek);

    // Move to 2026-06-15 (Monday of W25)
    const ts = Date.UTC(2026, 5, 15);
    const result = resetIfNewWeek(state, ts);

    expect(result.challenge.weekKey).toBe('2026-W25');
    expect(result.challenge.points).toBe(0);
    expect(result.challenge.played).toBe(0);
    expect(result.challenge.rewardsClaimed).toHaveLength(0);

    expect(result.battles.weekKey).toBe('2026-W25');
    expect(result.battles.points).toBe(0);
    expect(result.battles.played).toBe(0);

    expect(result.cup.weekKey).toBe('2026-W25');
    expect(result.cup.qualified).toBe(false);
    expect(result.cup.played).toBe(0);
    expect(result.cup.wins).toBe(0);
    expect(result.cup.losses).toBe(0);
    expect(result.cup.finished).toBe(false);
    expect(result.cup.rewardClaimed).toBe(false);
    expect(result.arcadeTokens.balance).toBe(2);

    expect(result.rivals.weekKey).toBe('2026-W25');
    expect(result.rivals.points).toBe(0);
    expect(result.rivals.played).toBe(0);
    expect(result.rivals.rewardsClaimed).toEqual([]);
    expect(result.worldTour.weekKey).toBe('2026-W25');
    expect(result.worldTour.currentMatch).toBe(0);
    expect(result.worldTour.completed).toBe(false);
    expect(result.worldTour.stageRewardsClaimed).toEqual([]);
    expect(result.owner.form).toEqual([]);
  });

  it('is a no-op within the same week', () => {
    const wk = '2026-W25';
    const state = makeState(wk);

    // Any timestamp in W25
    const ts = Date.UTC(2026, 5, 16); // Tuesday W25
    const result = resetIfNewWeek(state, ts);

    expect(result.challenge.points).toBe(99);
    expect(result.challenge.played).toBe(5);
    expect(result.battles.points).toBe(50);
    expect(result.cup.wins).toBe(2);
    expect(result.rivals.points).toBe(777);
    expect(result.worldTour.currentMatch).toBe(2);
  });

  it('returns the same state object (mutates in place)', () => {
    const state = makeState('2026-W24');
    const ts = Date.UTC(2026, 5, 15); // W25
    const result = resetIfNewWeek(state, ts);
    expect(result).toBe(state);
  });
});
