import { describe, it, expect } from 'vitest';
import { cupCanEnter, markCupQualified, cupRecord, cupRewards } from '../cupStars';
import type { StarsState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<StarsState['cup']> = {}): StarsState {
  return {
    version: 1,
    coins: 0,
    owned: {},
    squad: { formation: '4-4-2', starters: new Array(11).fill(null) },
    club: { name: 'Test FC', kit: { shirt: '#fff', shorts: '#fff', socks: '#fff' } },
    challenge: { weekKey: '2026-W25', points: 0, played: 0, rewardsClaimed: [] },
    cup: {
      weekKey: '2026-W25',
      qualified: false,
      played: 0,
      wins: 0,
      losses: 0,
      finished: false,
      rewardClaimed: false,
      ...overrides,
    },
    battles: { weekKey: '2026-W25', points: 0, played: 0 },
    owner: {
      boardMood: 55,
      fanMood: 55,
      pressPressure: 35,
      form: [],
      headline: 'A new owner era begins.',
    },
    rivals: {
      weekKey: '2026-W25',
      points: 0,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      rewardsClaimed: [],
    },
    worldTour: {
      weekKey: '2026-W25',
      currentMatch: 0,
      completed: false,
      rewardsClaimed: false,
      stageRewardsClaimed: [],
    },
    weekly: { lastGrantWeek: '2026-W25' },
    arcadeTokens: { balance: 3, lastDailyGrantDay: '2026-06-20', lastWeeklyGrantWeek: '2026-W25' },
    packRngSeed: 1,
  };
}

// Saturday 2026-06-20 UTC
const SAT_TS = Date.UTC(2026, 5, 20);
// Wednesday 2026-06-17 UTC
const WED_TS = Date.UTC(2026, 5, 17);

// ---------------------------------------------------------------------------
// cupCanEnter
// ---------------------------------------------------------------------------
describe('cupCanEnter', () => {
  it('false when not qualified', () => {
    const state = makeState({ qualified: false });
    expect(cupCanEnter(state, SAT_TS)).toBe(false);
  });

  it('false when not a cup weekend (Wednesday)', () => {
    const state = makeState({ qualified: true });
    expect(cupCanEnter(state, WED_TS)).toBe(false);
  });

  it('false when finished', () => {
    const state = makeState({ qualified: true, finished: true });
    expect(cupCanEnter(state, SAT_TS)).toBe(false);
  });

  it('false when played >= 10', () => {
    const state = makeState({ qualified: true, played: 10 });
    expect(cupCanEnter(state, SAT_TS)).toBe(false);
  });

  it('true when qualified, weekend, not finished, played < 10', () => {
    const state = makeState({ qualified: true, played: 5 });
    expect(cupCanEnter(state, SAT_TS)).toBe(true);
  });

  it('true on Sunday too', () => {
    const sun = Date.UTC(2026, 5, 21);
    const state = makeState({ qualified: true });
    expect(cupCanEnter(state, sun)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markCupQualified
// ---------------------------------------------------------------------------
describe('markCupQualified', () => {
  it('sets qualified to true', () => {
    const state = makeState({ qualified: false });
    markCupQualified(state);
    expect(state.cup.qualified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cupRecord
// ---------------------------------------------------------------------------
describe('cupRecord', () => {
  it('increments played and wins on a win', () => {
    const state = makeState();
    cupRecord(state, true);
    expect(state.cup.played).toBe(1);
    expect(state.cup.wins).toBe(1);
    expect(state.cup.losses).toBe(0);
  });

  it('increments played and losses on a loss', () => {
    const state = makeState();
    cupRecord(state, false);
    expect(state.cup.played).toBe(1);
    expect(state.cup.losses).toBe(1);
    expect(state.cup.wins).toBe(0);
  });

  it('sets finished when played reaches 10', () => {
    const state = makeState({ played: 9 });
    cupRecord(state, true);
    expect(state.cup.played).toBe(10);
    expect(state.cup.finished).toBe(true);
  });

  it('does not set finished before 10 played', () => {
    const state = makeState({ played: 8 });
    cupRecord(state, true);
    expect(state.cup.finished).toBe(false);
  });

  it('accumulates correctly across multiple calls', () => {
    const state = makeState();
    cupRecord(state, true);
    cupRecord(state, true);
    cupRecord(state, false);
    expect(state.cup.played).toBe(3);
    expect(state.cup.wins).toBe(2);
    expect(state.cup.losses).toBe(1);
    expect(state.cup.finished).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cupRewards
// ---------------------------------------------------------------------------
describe('cupRewards', () => {
  it('cupRewards(0) returns empty (no tiers reached)', () => {
    const r = cupRewards(0);
    expect(r.coins).toBe(0);
    expect(r.packIds).toHaveLength(0);
  });

  it('cupRewards(3) includes the first tier gold pack', () => {
    const r = cupRewards(3);
    expect(r.packIds).toContain('gold');
  });

  it('cupRewards(5) includes gold and premium packs', () => {
    const r = cupRewards(5);
    expect(r.packIds).toContain('gold');
    expect(r.packIds).toContain('premium');
  });

  it('cupRewards(7) includes gold + premium packs and 15000 coins', () => {
    const r = cupRewards(7);
    expect(r.packIds).toContain('gold');
    expect(r.packIds).toContain('premium');
    expect(r.coins).toBe(15000);
  });

  it('cupRewards(10) includes special pack and is cumulative', () => {
    const r = cupRewards(10);
    // All four tiers reached
    expect(r.packIds).toContain('gold');
    expect(r.packIds).toContain('premium');
    expect(r.packIds).toContain('special');
    expect(r.coins).toBe(15000);
    expect(r.packIds).toHaveLength(3);
  });

  it('cupRewards is cumulative (higher wins include lower tiers)', () => {
    const r5 = cupRewards(5);
    const r10 = cupRewards(10);
    // r10 should have at least as many packs as r5
    expect(r10.packIds.length).toBeGreaterThanOrEqual(r5.packIds.length);
  });
});
