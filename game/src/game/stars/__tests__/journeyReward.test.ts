import { beforeEach, describe, expect, it } from 'vitest';
import { cardValue } from '../../../data/cards';
import { createNewJourney } from '../../../journey/state';
import type { JourneyState, MatchHistoryEntry, StoryCampaignId } from '../../../journey/types';
import { quickSell } from '../economy';
import { buildJourneyRewardCard, grantJourneyRewardCard } from '../journeyReward';
import { loadStars, newStars, starsCardById } from '../store';

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

function match(
  matchId: string,
  result: MatchHistoryEntry['result'],
  rating: number,
  goals = result === 'win' ? 1 : 0,
): MatchHistoryEntry {
  return {
    matchId,
    date: '2026-06-16',
    opponent: 'Test Nation',
    result,
    score: result === 'win' ? [2, 0] : result === 'draw' ? [1, 1] : [0, 2],
    goalMargin: result === 'win' ? 2 : result === 'draw' ? 0 : -2,
    minutesPlayed: 90,
    rating,
    goals,
    assists: result === 'loss' ? 0 : 1,
    keyPasses: result === 'loss' ? 1 : 4,
    tackles: 2,
  };
}

function completedJourney(
  name: string,
  campaignId: StoryCampaignId,
  quality: 'weak' | 'strong',
): JourneyState {
  const state = createNewJourney(name, campaignId === 'two-passports-story' ? 'MF' : 'FW', 'haiti', campaignId);
  if (quality === 'strong') {
    return {
      ...state,
      isComplete: true,
      stats: {
        pace: 86,
        shooting: 88,
        passing: 84,
        dribbling: 87,
        defending: 66,
        physical: 82,
        mental: 92,
      },
      reputation: 91,
      storyMorale: 8,
      storyPressure: 2,
      injuryRisk: 1,
      matchPerformance: [
        match('story-semi', 'win', 8.8, 1),
        match('story-final', 'win', 9.4, 2),
      ],
    };
  }
  return {
    ...state,
    isComplete: true,
    stats: {
      pace: 58,
      shooting: 60,
      passing: 62,
      dribbling: 59,
      defending: 52,
      physical: 57,
      mental: 55,
    },
    reputation: 28,
    storyMorale: -5,
    storyPressure: 8,
    injuryRisk: 6,
    matchPerformance: [
      match('story-semi', 'loss', 5.4, 0),
      match('story-final', 'draw', 6.1, 0),
    ],
  };
}

describe('Journey Stars reward cards', () => {
  it('creates a zero-value card whose OVR rises with story performance', () => {
    const weak = buildJourneyRewardCard(completedJourney('Malik Carter', 'two-passports-story', 'weak'));
    const strong = buildJourneyRewardCard(completedJourney('Malik Carter', 'two-passports-story', 'strong'));

    expect(strong.id).toBe('journey:two-passports-story:malik-carter');
    expect(strong.name).toBe('Malik Carter');
    expect(strong.teamId).toBe('journey:two-passports-story');
    expect(strong.nation).toBe('Two Passports');
    expect(strong.overall).toBeGreaterThan(weak.overall);
    expect(cardValue(strong)).toBe(0);
    expect(quickSell(strong)).toBe(0);
  });

  it('stores the completed character once and resolves it from Stars state', () => {
    const stars = newStars();
    const journey = completedJourney('Tomas Andrade', 'last-dance-story', 'strong');
    const reward = grantJourneyRewardCard(stars, journey);

    expect(reward.status).toBe('added');
    expect(stars.customCards?.[reward.card.id]).toEqual(reward.card);
    expect(stars.owned[reward.card.id]).toBe(1);
    expect(starsCardById(stars, reward.card.id)).toEqual(reward.card);
    expect(loadStars()?.customCards?.[reward.card.id]).toEqual(reward.card);
  });

  it('keeps one copy but upgrades OVR if the same story is replayed better', () => {
    const stars = newStars();
    const first = grantJourneyRewardCard(stars, completedJourney('Malik Carter', 'two-passports-story', 'weak'));
    const second = grantJourneyRewardCard(stars, completedJourney('Malik Carter', 'two-passports-story', 'strong'));

    expect(second.card.id).toBe(first.card.id);
    expect(second.status).toBe('improved');
    expect(stars.owned[first.card.id]).toBe(1);
    expect(stars.customCards?.[first.card.id]?.overall).toBeGreaterThan(first.card.overall);
  });
});
