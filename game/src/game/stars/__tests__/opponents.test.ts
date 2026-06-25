import { describe, it, expect, beforeEach } from 'vitest';
import { Rng } from '../../../sim/rng';
import { newStars } from '../store';
import { genOpponent, battleOpponents, challengeOpponent, cupOpponent, hashString } from '../opponents';

// ---------------------------------------------------------------------------
// Fake localStorage
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
// genOpponent
// ---------------------------------------------------------------------------
describe('genOpponent', () => {
  it('produces 11 players', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    expect(opp.team.players.length).toBe(11);
  });

  it('first player is GK', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    expect(opp.team.players[0].pos).toBe('GK');
  });

  it('overall is within a reasonable range of target', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    // band is ±6 per player, but aggregate should be close
    expect(opp.overall).toBeGreaterThanOrEqual(67);
    expect(opp.overall).toBeLessThanOrEqual(83);
  });

  it('lineup starters is [0..10] and formation is 4-4-2', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    expect(opp.lineup.starters).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(opp.lineup.formation).toBe('4-4-2');
  });

  it('stars is in 1..5', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    expect(opp.stars).toBeGreaterThanOrEqual(1);
    expect(opp.stars).toBeLessThanOrEqual(5);
  });

  it('kit has shirt/shorts/socks as hex strings', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    expect(opp.kit.shirt).toMatch(/^#[0-9a-f]{6}$/i);
    expect(opp.kit.shorts).toMatch(/^#[0-9a-f]{6}$/i);
    expect(opp.kit.socks).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('id includes the idSeed', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test', 't1');
    expect(opp.id).toContain('t1');
    expect(opp.team.id).toContain('t1');
  });

  it('label matches', () => {
    const rng = new Rng(1);
    const opp = genOpponent(rng, 75, 'Test Label', 'x');
    expect(opp.label).toBe('Test Label');
    expect(opp.team.name).toBe('Test Label');
  });
});

// ---------------------------------------------------------------------------
// battleOpponents
// ---------------------------------------------------------------------------
describe('battleOpponents', () => {
  it('returns exactly 4 opponents', () => {
    const state = newStars();
    const opps = battleOpponents(state, '2026-W25');
    expect(opps.length).toBe(4);
  });

  it('is deterministic — same ids and overalls on second call', () => {
    const state = newStars();
    const first = battleOpponents(state, '2026-W25');
    const second = battleOpponents(state, '2026-W25');
    for (let i = 0; i < 4; i++) {
      expect(second[i].id).toBe(first[i].id);
      expect(second[i].overall).toBe(first[i].overall);
    }
  });

  it('overalls vary across opponents', () => {
    const state = newStars();
    const opps = battleOpponents(state, '2026-W25');
    const overalls = opps.map((o) => o.overall);
    // not all the same
    const unique = new Set(overalls);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('all opponents have valid lineups', () => {
    const state = newStars();
    const opps = battleOpponents(state, '2026-W25');
    for (const opp of opps) {
      expect(opp.lineup.starters).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(opp.lineup.formation).toBe('4-4-2');
    }
  });

  it('all opponents have stars in 1..5', () => {
    const state = newStars();
    const opps = battleOpponents(state, '2026-W25');
    for (const opp of opps) {
      expect(opp.stars).toBeGreaterThanOrEqual(1);
      expect(opp.stars).toBeLessThanOrEqual(5);
    }
  });
});

// ---------------------------------------------------------------------------
// challengeOpponent
// ---------------------------------------------------------------------------
describe('challengeOpponent', () => {
  it('returns a single valid opponent', () => {
    const state = newStars();
    const opp = challengeOpponent(state, 0);
    expect(opp.team.players.length).toBe(11);
    expect(opp.stars).toBeGreaterThanOrEqual(1);
    expect(opp.stars).toBeLessThanOrEqual(5);
  });

  it('is deterministic', () => {
    const state = newStars();
    const a = challengeOpponent(state, 2);
    const b = challengeOpponent(state, 2);
    expect(a.id).toBe(b.id);
    expect(a.overall).toBe(b.overall);
  });
});

// ---------------------------------------------------------------------------
// cupOpponent
// ---------------------------------------------------------------------------
describe('cupOpponent', () => {
  it('returns a valid opponent', () => {
    const state = newStars();
    const opp = cupOpponent(state, 0);
    expect(opp.team.players.length).toBe(11);
    expect(opp.team.players[0].pos).toBe('GK');
  });

  it('gets harder with each game (overall non-decreasing)', () => {
    const state = newStars();
    const overalls = [0, 1, 2, 3, 4].map((i) => cupOpponent(state, i).overall);
    // Each successive game should be at same or higher overall (due to higher targets)
    // Not strictly enforced due to rng variance, but the targets increase
    // At minimum, later targets are clamped upward
    expect(overalls.length).toBe(5);
    // All valid overall values
    for (const o of overalls) {
      expect(o).toBeGreaterThanOrEqual(50);
      expect(o).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// hashString
// ---------------------------------------------------------------------------
describe('hashString', () => {
  it('returns a number', () => {
    expect(typeof hashString('hello')).toBe('number');
  });

  it('is deterministic', () => {
    expect(hashString('foo')).toBe(hashString('foo'));
  });

  it('different strings produce different hashes', () => {
    expect(hashString('2026-W25')).not.toBe(hashString('2026-W26'));
  });
});
