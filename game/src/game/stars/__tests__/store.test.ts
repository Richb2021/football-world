import { describe, it, expect, beforeEach } from 'vitest';
import {
  newStars,
  loadStars,
  saveStars,
  addCoins,
  addCard,
  removeCard,
  setClub,
  ownedCount,
  starsSlots,
  DEFAULT_STARS_CLUB_NAME,
} from '../store';
import { ensureOwnerModeState } from '../ownerMode';
import { cardById } from '../../../data/cards';
import { FORMATION_NEEDS } from '../../../sim/formations';

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
// 1. newStars basics
// ---------------------------------------------------------------------------
describe('newStars', () => {
  it('produces coins 5000 and version 1', () => {
    const s = newStars();
    expect(s.coins).toBe(5000);
    expect(s.version).toBe(1);
  });

  it('starts with three arcade tokens for Challenge Chronicle entries', () => {
    const s = newStars();
    expect(s.arcadeTokens.balance).toBe(3);
  });

  it('starts with no paid story unlocks', () => {
    const s = newStars();
    expect(s.storyUnlocks).toEqual([]);
  });

  it('starts with a named All Star Team identity', () => {
    const s = newStars();
    expect(s.club.name).toBe(DEFAULT_STARS_CLUB_NAME);
  });

  it('owns exactly 15 distinct card ids each with count 1', () => {
    const s = newStars();
    const entries = Object.entries(s.owned);
    expect(entries.length).toBe(15);
    for (const [, count] of entries) {
      expect(count).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Starter XI positions
// ---------------------------------------------------------------------------
describe('starter XI positions', () => {
  it('has 11 non-null starters', () => {
    const s = newStars();
    expect(s.squad.starters.length).toBe(11);
    for (const id of s.squad.starters) {
      expect(id).not.toBeNull();
    }
  });

  it('slot 0 is a GK', () => {
    const s = newStars();
    const gk = cardById(s.squad.starters[0]!);
    expect(gk).toBeDefined();
    expect(gk!.pos).toBe('GK');
  });

  it('slots 1..10 match FORMATION_NEEDS["4-4-2"] positions', () => {
    const s = newStars();
    const needs = FORMATION_NEEDS['4-4-2'];
    for (let i = 0; i < needs.length; i++) {
      const card = cardById(s.squad.starters[i + 1]!);
      expect(card).toBeDefined();
      expect(card!.pos).toBe(needs[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Save → load round-trip
// ---------------------------------------------------------------------------
describe('persistence', () => {
  it('round-trips save/load to deeply equal state', () => {
    // settle the lazily-filled weekly keys to the current week, exactly as
    // loadStars does on read, so the round-trip compares like for like
    const s = ensureOwnerModeState(newStars());
    saveStars(s);
    const loaded = loadStars();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(s);
  });

  it('loadStars returns null on empty storage', () => {
    expect(loadStars()).toBeNull();
  });

  it('loadStars returns null when version !== 1', () => {
    const s = newStars();
    // Exercise the real path: write a wrong-version slot via starsSlots.create,
    // which the valid guard then rejects on load.
    starsSlots.create({ ...s, version: 99 } as unknown as typeof s);
    expect(loadStars()).toBeNull();
  });

  it('loadStars returns null on malformed JSON', () => {
    // Write bad JSON directly into the slot payload key that loadStars reads.
    localStorage.setItem('sl93.slot.stars.main', 'not-json{{{');
    expect(loadStars()).toBeNull();
  });

  it('revives old Stars saves with a fresh arcade token wallet', () => {
    const legacy = newStars();
    delete (legacy as Partial<typeof legacy>).arcadeTokens;
    starsSlots.create(legacy);

    const loaded = loadStars();

    expect(loaded?.arcadeTokens.balance).toBe(3);
  });

  it('revives old Stars saves with story unlocks initialized', () => {
    const legacy = newStars();
    delete (legacy as Partial<typeof legacy>).storyUnlocks;
    starsSlots.create(legacy);

    const loaded = loadStars();

    expect(loaded?.storyUnlocks).toEqual([]);
  });

  it('revives old Stars saves with owner mode state initialized', () => {
    const legacy = newStars();
    delete (legacy as Partial<typeof legacy>).owner;
    delete (legacy as Partial<typeof legacy>).rivals;
    delete (legacy as Partial<typeof legacy>).worldTour;
    starsSlots.create(legacy);

    const loaded = loadStars();

    expect(loaded?.owner).toBeDefined();
    expect(loaded?.rivals).toBeDefined();
    expect(loaded?.worldTour).toBeDefined();
  });

  it('revives legacy Stars saves with a valid team name', () => {
    const legacy = newStars();
    legacy.club.name = '';
    starsSlots.create(legacy);

    const loaded = loadStars();

    expect(loaded?.club.name).toBe(DEFAULT_STARS_CLUB_NAME);
  });
});

// ---------------------------------------------------------------------------
// 4. Mutators
// ---------------------------------------------------------------------------
describe('setClub', () => {
  it('normalises and persists renamed All Star Team names', () => {
    const s = newStars();

    setClub(s, { ...s.club, name: '  Neon   Royals  ' });

    expect(s.club.name).toBe('Neon Royals');
    expect(loadStars()?.club.name).toBe('Neon Royals');
  });

  it('keeps the existing All Star Team name when a blank rename is submitted', () => {
    const s = newStars();
    setClub(s, { ...s.club, name: 'Neon Royals' });

    setClub(s, { ...s.club, name: '   ' });

    expect(s.club.name).toBe('Neon Royals');
    expect(loadStars()?.club.name).toBe('Neon Royals');
  });
});

describe('addCoins', () => {
  it('clamps to 0 on large negative delta', () => {
    const s = newStars();
    addCoins(s, -99999);
    expect(s.coins).toBe(0);
  });

  it('adds coins normally', () => {
    const s = newStars();
    addCoins(s, 1000);
    expect(s.coins).toBe(6000);
  });

  it('saves after mutation', () => {
    const s = newStars();
    addCoins(s, 500);
    const loaded = loadStars();
    expect(loaded?.coins).toBe(5500);
  });
});

describe('addCard / removeCard / ownedCount', () => {
  it('addCard increments count', () => {
    const s = newStars();
    const testId = 'test:card-abc';
    addCard(s, testId);
    expect(ownedCount(s, testId)).toBe(1);
    addCard(s, testId, 3);
    expect(ownedCount(s, testId)).toBe(4);
  });

  it('removeCard decrements and deletes at zero', () => {
    const s = newStars();
    const testId = 'test:card-xyz';
    addCard(s, testId, 2);
    removeCard(s, testId, 1);
    expect(ownedCount(s, testId)).toBe(1);
    removeCard(s, testId, 1);
    expect(ownedCount(s, testId)).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(s.owned, testId)).toBe(false);
  });

  it('ownedCount returns 0 for unknown id', () => {
    const s = newStars();
    expect(ownedCount(s, 'not:exists')).toBe(0);
  });

  it('saves after addCard and removeCard', () => {
    const s = newStars();
    addCard(s, 'a:b');
    expect(loadStars()?.owned['a:b']).toBe(1);
    removeCard(s, 'a:b');
    expect(loadStars()?.owned['a:b']).toBeUndefined();
  });
});
