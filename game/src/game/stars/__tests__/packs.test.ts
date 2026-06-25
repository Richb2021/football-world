import { describe, it, expect, beforeEach } from 'vitest';
import { openPack } from '../packs';
import { newStars } from '../store';
import { PACKS } from '../economy';
import type { StarsState } from '../types';

// ---------------------------------------------------------------------------
// Fake localStorage (node env has none)
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
// Helper: fresh state with enough coins to open any pack
// ---------------------------------------------------------------------------

function richState(): StarsState {
  const s = newStars();
  s.coins = 1_000_000;
  return s;
}

// ---------------------------------------------------------------------------
// Basic open-pack behaviour
// ---------------------------------------------------------------------------

describe('openPack basics', () => {
  for (const pack of PACKS) {
    it(`${pack.id}: returns exactly ${pack.size} cards`, () => {
      const s = richState();
      const { pulled } = openPack(s, pack.id);
      expect(pulled).toHaveLength(pack.size);
    });

    it(`${pack.id}: coins reduced by exactly ${pack.price}`, () => {
      const s = richState();
      const before = s.coins;
      openPack(s, pack.id);
      expect(s.coins).toBe(before - pack.price);
    });
  }
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('openPack errors', () => {
  it('throws on unknown packId', () => {
    const s = richState();
    expect(() => openPack(s, 'nonexistent')).toThrow('unknown pack');
  });

  it('throws on insufficient coins', () => {
    const s = newStars(); // starts with 5000 coins
    s.coins = 0;
    expect(() => openPack(s, 'bronze')).toThrow('insufficient coins');
  });
});

// ---------------------------------------------------------------------------
// Determinism: same seed → identical pulls
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same packRngSeed produces identical pulled cards', () => {
    const seed = 0x12345678;

    const s1 = richState();
    s1.packRngSeed = seed;
    const { pulled: p1 } = openPack(s1, 'gold');

    const s2 = richState();
    s2.packRngSeed = seed;
    const { pulled: p2 } = openPack(s2, 'gold');

    expect(p1.map((c) => c.id)).toEqual(p2.map((c) => c.id));
  });

  it('packRngSeed changes after opening', () => {
    const s = richState();
    const before = s.packRngSeed;
    openPack(s, 'bronze');
    expect(s.packRngSeed).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Consecutive opens differ
// ---------------------------------------------------------------------------

describe('consecutive opens', () => {
  it('two consecutive opens of the same pack differ in at least 1 card', () => {
    const s = richState();
    const { pulled: p1 } = openPack(s, 'silver');
    const { pulled: p2 } = openPack(s, 'silver');
    const ids1 = p1.map((c) => c.id).join(',');
    const ids2 = p2.map((c) => c.id).join(',');
    expect(ids1).not.toBe(ids2);
  });
});

// ---------------------------------------------------------------------------
// Guarantee: across 50 seeds, guaranteed packs always yield ≥1 card
// of the guaranteed rarity (or higher)
// ---------------------------------------------------------------------------

const RARITY_RANK: Record<string, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  special: 3,
};

describe('guarantee enforcement', () => {
  const guaranteedPacks = PACKS.filter((p) => p.guarantee !== undefined);

  for (const pack of guaranteedPacks) {
    it(`${pack.id} (guarantee: ${pack.guarantee}) always satisfied across 50 seeds`, () => {
      const guaranteeRank = RARITY_RANK[pack.guarantee!];
      for (let seed = 0; seed < 50; seed++) {
        const s = richState();
        s.packRngSeed = seed;
        const { pulled } = openPack(s, pack.id);
        const satisfied = pulled.some((c) => RARITY_RANK[c.rarity] >= guaranteeRank);
        expect(satisfied).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Cards added to owned
// ---------------------------------------------------------------------------

describe('owned tracking', () => {
  it('opened cards appear in state.owned', () => {
    const s = richState();
    const ownedBefore = Object.keys(s.owned).length;
    const { pulled } = openPack(s, 'bronze');
    for (const card of pulled) {
      expect(s.owned[card.id]).toBeGreaterThanOrEqual(1);
    }
    // At least as many unique owned entries as before
    expect(Object.keys(s.owned).length).toBeGreaterThanOrEqual(ownedBefore);
  });
});
