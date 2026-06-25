import { describe, it, expect, beforeEach } from 'vitest';
import {
  newSeasons,
  loadSeasons,
  saveSeasons,
  recordResult,
  opponentFor,
  seasonComplete,
  promotionThreshold,
  relegationThreshold,
  divisionName,
  GAMES_PER_SEASON,
  BOTTOM_DIVISION,
  TOP_DIVISION,
  seasonsSlots,
} from '../ladder';
import type { SeasonsState } from '../ladder';
import { TEAMS } from '../../../data/teams';

// ---------------------------------------------------------------------------
// Map-backed fake localStorage for node test env
// ---------------------------------------------------------------------------
function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  globalThis.localStorage = makeFakeStorage();
});

// ---------------------------------------------------------------------------
// Basic construction
// ---------------------------------------------------------------------------

describe('newSeasons', () => {
  it('starts at division 5, season 1, step 0, points 0', () => {
    const s = newSeasons(3);
    expect(s.division).toBe(BOTTOM_DIVISION);
    expect(s.seasonNo).toBe(1);
    expect(s.step).toBe(0);
    expect(s.points).toBe(0);
    expect(s.wins).toBe(0);
    expect(s.draws).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.teamIdx).toBe(3);
    expect(s.titles).toBe(0);
    expect(s.lastOutcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10 wins from division 5 → promoted to division 4, season 2
// ---------------------------------------------------------------------------

describe('10 wins → promoted', () => {
  it('increments points and then promotes', () => {
    const s = newSeasons(0);

    // Feed 9 wins; should not be complete yet
    for (let i = 0; i < 9; i++) {
      recordResult(s, { score: [2, 0], winner: 0 });
    }
    expect(s.step).toBe(9);
    expect(s.points).toBe(27);
    expect(seasonComplete(s)).toBe(false);

    // 10th win triggers season rollover
    recordResult(s, { score: [2, 0], winner: 0 });

    // After rollover the state is the NEW season
    expect(s.lastOutcome).toBe('promoted');
    expect(s.division).toBe(4);
    expect(s.seasonNo).toBe(2);
    expect(s.step).toBe(0);
    expect(s.points).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10 losses from division 5 → relegated but clamped at division 5
// ---------------------------------------------------------------------------

describe('10 losses from division 5 → stays at 5 (clamped)', () => {
  it('relegation outcome but division clamps at BOTTOM_DIVISION', () => {
    const s = newSeasons(0);
    expect(s.division).toBe(BOTTOM_DIVISION);

    for (let i = 0; i < GAMES_PER_SEASON; i++) {
      recordResult(s, { score: [0, 2], winner: 1 });
    }

    expect(s.lastOutcome).toBe('relegated');
    expect(s.division).toBe(BOTTOM_DIVISION); // clamped — cannot go below 5
    expect(s.seasonNo).toBe(2);
    expect(s.step).toBe(0);
    expect(s.points).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mid-table results
// ---------------------------------------------------------------------------

describe('mid-table points', () => {
  it('5 draws + 5 losses (5 pts) → relegated', () => {
    const s = newSeasons(0);
    // 5 draws
    for (let i = 0; i < 5; i++) {
      recordResult(s, { score: [1, 1], winner: -1 });
    }
    // 5 losses
    for (let i = 0; i < 5; i++) {
      recordResult(s, { score: [0, 2], winner: 1 });
    }
    // 5 pts ≤ 9 → relegated
    expect(s.lastOutcome).toBe('relegated');
  });

  it('6 wins + 4 losses (18 pts) → stayed', () => {
    const s = newSeasons(0);
    for (let i = 0; i < 6; i++) {
      recordResult(s, { score: [1, 0], winner: 0 });
    }
    for (let i = 0; i < 4; i++) {
      recordResult(s, { score: [0, 1], winner: 1 });
    }
    // 18 pts → not >= 20 (no promo) and not <= 9 (no rel) → stayed
    expect(s.lastOutcome).toBe('stayed');
  });
});

// ---------------------------------------------------------------------------
// Champion (top division + enough points)
// ---------------------------------------------------------------------------

describe('champion', () => {
  it('winning the top division awards a title and sets lastOutcome=champion', () => {
    const s = newSeasons(0);
    s.division = TOP_DIVISION; // manually advance to division 1

    // 7 wins = 21 pts ≥ 20
    for (let i = 0; i < 7; i++) {
      recordResult(s, { score: [2, 0], winner: 0 });
    }
    // 3 losses
    for (let i = 0; i < 3; i++) {
      recordResult(s, { score: [0, 1], winner: 1 });
    }

    expect(s.lastOutcome).toBe('champion');
    expect(s.titles).toBe(1);
    expect(s.division).toBe(TOP_DIVISION); // stays in Premier Division
    expect(s.seasonNo).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// opponentFor — valid index, != teamIdx, deterministic
// ---------------------------------------------------------------------------

describe('opponentFor', () => {
  it('returns a valid TEAMS index not equal to teamIdx', () => {
    const s = newSeasons(2);
    const opp = opponentFor(s, 0);
    expect(opp).toBeGreaterThanOrEqual(0);
    expect(opp).toBeLessThan(TEAMS.length);
    expect(opp).not.toBe(2);
  });

  it('is deterministic for the same (seasonNo, step)', () => {
    const s = newSeasons(1);
    const a = opponentFor(s, 3);
    const b = opponentFor(s, 3);
    expect(a).toBe(b);
  });

  it('returns different opponents for different steps', () => {
    const s = newSeasons(0);
    const results = new Set(
      Array.from({ length: GAMES_PER_SEASON }, (_, step) => opponentFor(s, step)),
    );
    // Very unlikely all 10 fixtures happen to land on the exact same team
    expect(results.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// divisionName
// ---------------------------------------------------------------------------

describe('divisionName', () => {
  it('returns Premier Division for 1', () => {
    expect(divisionName(1)).toBe('Premier Division');
  });

  it('returns Division N for 2..5', () => {
    expect(divisionName(5)).toBe('Division 5');
    expect(divisionName(2)).toBe('Division 2');
  });
});

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

describe('thresholds', () => {
  it('promotion is 20', () => expect(promotionThreshold()).toBe(20));
  it('relegation is 9', () => expect(relegationThreshold()).toBe(9));
});

// ---------------------------------------------------------------------------
// Save → load round-trip
// ---------------------------------------------------------------------------

describe('save/load', () => {
  it('round-trips correctly', () => {
    const s = newSeasons(5);
    s.division = 3;
    s.seasonNo = 4;
    s.points = 12;
    s.wins = 4;
    s.draws = 0;
    s.losses = 6;
    s.titles = 1;
    s.lastOutcome = 'stayed';

    saveSeasons(s);

    const loaded = loadSeasons();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.teamIdx).toBe(5);
    expect(loaded!.division).toBe(3);
    expect(loaded!.seasonNo).toBe(4);
    expect(loaded!.points).toBe(12);
    expect(loaded!.titles).toBe(1);
    expect(loaded!.lastOutcome).toBe('stayed');
  });

  it('returns null when no save exists', () => {
    expect(loadSeasons()).toBeNull();
  });

  it('ignores saves with wrong version', () => {
    seasonsSlots.create({ version: 99, teamIdx: 0, division: 5 } as unknown as SeasonsState);
    expect(loadSeasons()).toBeNull();
  });
});
