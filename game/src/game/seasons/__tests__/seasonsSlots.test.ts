// src/game/seasons/__tests__/seasonsSlots.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { seasonsSlots, saveSeasons, loadSeasons, seasonsAutoName, newSeasons } from '../ladder';

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

describe('seasons slots', () => {
  it('round-trips a seasons run through the active slot', () => {
    const s = newSeasons(0);
    seasonsSlots.create(s);
    s.points = 9;
    saveSeasons(s);
    expect(loadSeasons()?.points).toBe(9);
  });

  it('auto-names from team + division', () => {
    expect(seasonsAutoName(newSeasons(0))).toContain('Div');
  });
});
