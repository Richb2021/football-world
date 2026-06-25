import { describe, expect, it, beforeEach } from 'vitest';
import { loadStars, saveStars, starsSlots, newStars } from '../store';

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

beforeEach(() => { globalThis.localStorage = makeFakeStorage(); });

describe('stars single slot', () => {
  it('round-trips through the fixed "main" slot', () => {
    const s = newStars();
    s.coins = 999;
    saveStars(s);
    expect(loadStars()?.coins).toBe(999);
    expect(starsSlots.list().map((m) => m.id)).toEqual(['main']);
  });

  it('never creates a second slot', () => {
    saveStars(newStars());
    saveStars(newStars());
    expect(starsSlots.list()).toHaveLength(1);
  });
});
