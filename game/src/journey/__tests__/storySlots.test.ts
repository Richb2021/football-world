// src/journey/__tests__/storySlots.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { storySlots, saveJourney, loadJourney, storyAutoName } from '../state';
import { createNewJourney } from '../state';

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

describe('story slots', () => {
  it('round-trips a journey and records the campaign in slot.extra', () => {
    const s = createNewJourney('Ada', 'FW', 'club-x', 'two-passports-story');
    const meta = storySlots.create(s);
    saveJourney(s);
    expect(loadJourney()?.playerName).toBe('Ada');
    expect(meta.extra?.campaignId).toBe('two-passports-story');
  });

  it('auto-names from campaign + player', () => {
    const s = createNewJourney('Ada', 'FW', 'club-x', 'two-passports-story');
    expect(storyAutoName(s)).toContain('Ada');
  });
});
