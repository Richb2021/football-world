import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { applyConsequences, createNewJourney, loadJourney, storySlots } from '../state';
import type { JourneyState } from '../types';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Journey injury risk state', () => {
  it('starts new journeys with no injury risk', () => {
    const state = createNewJourney('Jordan Reeves', 'FW', 'fictional-united');
    expect(state.injuryRisk).toBe(0);
  });

  it('applies injury risk consequences with 0-10 clamping', () => {
    const base = createNewJourney('Jordan Reeves', 'FW', 'fictional-united');
    const high = applyConsequences(base, [{ type: 'injuryRisk', change: 20 }]);
    const low = applyConsequences(high, [{ type: 'injuryRisk', change: -20 }]);

    expect(high.injuryRisk).toBe(10);
    expect(low.injuryRisk).toBe(0);
  });

  it('applies press and fan pressure consequences with -10 to 10 clamping', () => {
    const base = createNewJourney('Jordan Reeves', 'FW', 'fictional-united');
    const high = applyConsequences(base, [
      { type: 'pressPressure', change: 20 },
      { type: 'fanPressure', change: 20 },
    ]);
    const low = applyConsequences(high, [
      { type: 'pressPressure', change: -40 },
      { type: 'fanPressure', change: -40 },
    ]);

    expect(high.pressPressure).toBe(10);
    expect(high.fanPressure).toBe(10);
    expect(low.pressPressure).toBe(-10);
    expect(low.fanPressure).toBe(-10);
  });

  it('migrates legacy saves without injury risk', () => {
    const saved = createNewJourney('Jordan Reeves', 'FW', 'fictional-united') as Partial<JourneyState>;
    delete saved.injuryRisk;
    delete saved.pressPressure;
    delete saved.fanPressure;
    storySlots.create(saved as JourneyState);

    expect(loadJourney()?.injuryRisk).toBe(0);
    expect(loadJourney()?.pressPressure).toBe(1);
    expect(loadJourney()?.fanPressure).toBe(0);
  });

  it('clamps migrated injury risk from persisted saves', () => {
    const saved = {
      ...createNewJourney('Jordan Reeves', 'FW', 'fictional-united'),
      injuryRisk: 99,
    };
    storySlots.create(saved);

    expect(loadJourney()?.injuryRisk).toBe(10);
  });

  it('uses story-specific baselines for new campaign starts', () => {
    const lastDance = createNewJourney('Tomas Andrade', 'FW', 'cape-verde', 'last-dance-story');
    const twoPassports = createNewJourney('Malik Carter', 'MF', 'haiti', 'two-passports-story');

    expect(lastDance.stats).toMatchObject({
      pace: 48,
      shooting: 74,
      mental: 76,
    });
    expect(lastDance).toMatchObject({
      reputation: 42,
      storyPressure: 2,
      storyMorale: 1,
      pressPressure: 4,
      fanPressure: 5,
      injuryRisk: 4,
    });
    expect(lastDance.relationships.ld_young_striker_elian).toBe(-1);
    expect(lastDance.inbox?.messages.map((message) => message.id)).toContain('ld_m_president');

    expect(twoPassports.stats).toMatchObject({
      passing: 75,
      dribbling: 71,
      mental: 54,
    });
    expect(twoPassports).toMatchObject({
      reputation: 22,
      storyPressure: 1,
      storyMorale: 0,
      pressPressure: 3,
      fanPressure: 2,
      injuryRisk: 0,
    });
    expect(twoPassports.relationships.tp_grandmother_ana).toBe(5);
    expect(twoPassports.inbox?.messages.map((message) => message.id)).toContain('tp_m_reece');
  });
});
