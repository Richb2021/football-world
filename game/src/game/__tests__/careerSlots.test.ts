// src/game/__tests__/careerSlots.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { careerSlots, saveCareer, loadCareer, careerAutoName } from '../saves';
import { newCareer } from '../career';

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

describe('career slots', () => {
  it('round-trips a career through the active slot', () => {
    const c = newCareer('cup', 0, 123, 'international-cup');
    const meta = careerSlots.create(c);
    expect(careerSlots.active()).toBe(meta.id);
    saveCareer(c);
    const loaded = loadCareer();
    expect(loaded?.userTeam).toBe(0);
    expect(loaded?.leagueId).toBe('international-cup');
  });

  it('auto-names from team + competition', () => {
    const c = newCareer('cup', 0, 123, 'international-cup');
    expect(careerAutoName(c)).toContain('World Cup');
  });
});
