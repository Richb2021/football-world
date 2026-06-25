import { describe, expect, it } from 'vitest';
import { createNewJourney } from '../state';
import {
  applyRouteConsequences,
  canUseStoryEntry,
  evaluateStoryGate,
  evaluateStoryGates,
  getAvailableStoryEntries,
  getLatestMatchEntry,
  resolveStoryRoute,
} from '../storyLogic';
import type { JourneyState, StoryRoute } from '../types';

function state(overrides: Partial<JourneyState> = {}): JourneyState {
  return {
    ...createNewJourney('Jordan Reeves', 'FW', 'fictional-united'),
    ...overrides,
  };
}

describe('story gates', () => {
  it('evaluates flag, stat, relationship, reputation, pressure, morale, injury, press, and fan gates', () => {
    const s = state({
      reputation: 42,
      storyPressure: 4,
      storyMorale: -2,
      injuryRisk: 6,
      pressPressure: 5,
      fanPressure: 7,
      storyFlags: { brave: true, withheld: false },
      relationships: { doctor_evans: 3 },
      stats: {
        pace: 55,
        shooting: 60,
        passing: 58,
        dribbling: 54,
        defending: 45,
        physical: 52,
        mental: 66,
      },
    });

    expect(evaluateStoryGate(s, { type: 'flag', flag: 'brave' })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'flag', flag: 'withheld', value: false })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'stat', stat: 'mental', min: 65 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'relationship', npcId: 'doctor_evans', min: 2 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'reputation', min: 40 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'storyPressure', min: 3 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'storyMorale', max: -1 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'injuryRisk', min: 5 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'pressPressure', min: 4 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'fanPressure', min: 6 })).toBe(true);
  });

  it('uses the latest matching match entry for result and margin gates', () => {
    const s = state({
      matchPerformance: [
        {
          matchId: 'rtg_trial',
          date: '2026-06-01',
          opponent: 'Harbour First XI',
          result: 'loss',
          score: [0, 2],
          goalMargin: -2,
          minutesPlayed: 90,
          rating: 5.4,
          goals: 0,
          assists: 0,
          keyPasses: 1,
          tackles: 1,
        },
        {
          matchId: 'rtg_trial',
          date: '2026-06-08',
          opponent: 'Harbour First XI',
          result: 'win',
          score: [3, 1],
          goalMargin: 2,
          minutesPlayed: 90,
          rating: 8.1,
          goals: 1,
          assists: 1,
          keyPasses: 4,
          tackles: 2,
        },
      ],
    });

    expect(getLatestMatchEntry(s, 'rtg_trial')?.result).toBe('win');
    expect(evaluateStoryGate(s, { type: 'matchResult', matchId: 'rtg_trial', result: 'win' })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'matchResult', matchId: 'rtg_trial', result: 'loss' })).toBe(false);
    expect(evaluateStoryGate(s, { type: 'matchMargin', matchId: 'rtg_trial', min: 2 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'matchMargin', matchId: 'rtg_trial', max: -2 })).toBe(false);
  });

  it('falls back to player-perspective score margin when an entry has no stored goal margin', () => {
    const s = state({
      matchPerformance: [
        {
          matchId: 'rtg_trial',
          date: '2026-06-10',
          opponent: 'Harbour First XI',
          result: 'win',
          score: [1, 3],
          minutesPlayed: 90,
          rating: 7,
          goals: 1,
          assists: 0,
          keyPasses: 2,
          tackles: 1,
        },
      ],
    });

    expect(evaluateStoryGate(s, { type: 'matchMargin', matchId: 'rtg_trial', min: 2 })).toBe(true);
    expect(evaluateStoryGate(s, { type: 'matchMargin', matchId: 'rtg_trial', max: -2 })).toBe(false);
  });

  it('resolves the first route whose gates pass', () => {
    const routes: StoryRoute[] = [
      { gates: [{ type: 'injuryRisk', min: 8 }], nextSceneId: 'danger' },
      { gates: [{ type: 'storyMorale', min: 1 }], nextSceneId: 'lifted' },
      { nextSceneId: 'fallback-route' },
    ];

    expect(resolveStoryRoute(state({ injuryRisk: 3, storyMorale: 2 }), routes, 'fallback')).toMatchObject({
      nextSceneId: 'lifted',
    });
  });

  it('returns an explicit fallback route when no supplied route passes', () => {
    const route = resolveStoryRoute(
      state({ injuryRisk: 2 }),
      [{ gates: [{ type: 'injuryRisk', min: 8 }], nextSceneId: 'danger' }],
      'fallback',
    );

    expect(route).toEqual({ nextSceneId: 'fallback' });
  });

  it('requires every gate to pass', () => {
    expect(evaluateStoryGates(state({ injuryRisk: 9, storyPressure: 1 }), [
      { type: 'injuryRisk', min: 8 },
      { type: 'storyPressure', min: 5 },
    ])).toBe(false);
  });

  it('requires both function conditions and gates to pass for entries', () => {
    const s = state({ injuryRisk: 4, storyFlags: { allowed: true } });
    const entry = {
      speakerId: 'coach',
      text: 'available',
      condition: (candidate: JourneyState) => !!candidate.storyFlags.allowed,
      gates: [{ type: 'injuryRisk' as const, max: 5 }],
    };

    expect(canUseStoryEntry(s, entry)).toBe(true);
    expect(canUseStoryEntry(state({ injuryRisk: 8, storyFlags: { allowed: true } }), entry)).toBe(false);
    expect(getAvailableStoryEntries(s, [
      entry,
      { speakerId: 'coach', text: 'blocked', gates: [{ type: 'injuryRisk' as const, min: 8 }] },
    ])).toEqual([entry]);
  });
});

describe('story routes', () => {
  it('applies route consequences through the existing Journey consequence handler', () => {
    const updated = applyRouteConsequences(
      state(),
      [
        { type: 'storyPressure', change: 3 },
        { type: 'pressPressure', change: 2 },
        { type: 'fanPressure', change: 1 },
        { type: 'flag', flag: 'took_the_hit', value: true },
      ],
    );

    expect(updated.storyPressure).toBe(3);
    expect(updated.pressPressure).toBe(3);
    expect(updated.fanPressure).toBe(1);
    expect(updated.storyFlags.took_the_hit).toBe(true);
  });

  it('returns the same state when no route consequences are supplied', () => {
    const base = state({ storyPressure: 2 });

    expect(applyRouteConsequences(base, undefined)).toBe(base);
  });
});
