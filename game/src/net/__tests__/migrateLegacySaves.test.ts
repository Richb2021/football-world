// src/net/__tests__/migrateLegacySaves.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { migrateLegacySaves } from '../migrateLegacySaves';
import { careerSlots } from '../../game/saves';
import { storySlots } from '../../journey/state';
import { newCareer } from '../../game/career';
import { createNewJourney } from '../../journey/state';

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

describe('legacy migration', () => {
  it('imports a legacy career into a slot once', () => {
    localStorage.setItem('sl93.save.v1', JSON.stringify(newCareer('cup', 0, 1, 'international-cup')));
    migrateLegacySaves();
    expect(careerSlots.list()).toHaveLength(1);
    expect(localStorage.getItem('sl93.slots.migrated')).toBe('1');
    migrateLegacySaves();                                  // idempotent
    expect(careerSlots.list()).toHaveLength(1);
  });

  it('imports a legacy story save and preserves the legacy key', () => {
    const s = createNewJourney('Ada', 'FW', 'club-x', 'last-dance-story');
    localStorage.setItem('journey_save_v1', JSON.stringify(s));
    migrateLegacySaves();
    expect(storySlots.list()).toHaveLength(1);
    expect(localStorage.getItem('journey_save_v1')).not.toBeNull(); // legacy kept as backup
  });
});
