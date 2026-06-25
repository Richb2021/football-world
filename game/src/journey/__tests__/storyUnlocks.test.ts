import { describe, expect, it } from 'vitest';
import { newStars } from '../../game/stars/store';
import {
  FREE_STORY_CAMPAIGN_IDS,
  STORY_UNLOCK_COST,
  canAffordStoryUnlock,
  isStoryCampaignUnlocked,
  storyUnlockShortfall,
  unlockStoryCampaign,
} from '../storyUnlocks';

describe('story unlock rules', () => {
  it('keeps only the first two campaigns free', () => {
    expect(FREE_STORY_CAMPAIGN_IDS).toEqual([
      'international-cup-story',
      'last-dance-story',
    ]);
  });

  it('treats free campaigns as unlocked without storing ids', () => {
    const state = newStars();
    state.storyUnlocks = [];

    expect(isStoryCampaignUnlocked(state, 'international-cup-story')).toBe(true);
    expect(isStoryCampaignUnlocked(state, 'last-dance-story')).toBe(true);
    expect(isStoryCampaignUnlocked(state, 'two-passports-story')).toBe(false);
  });

  it('unlocks a paid story once for 10000 coins', () => {
    const state = newStars();
    state.coins = STORY_UNLOCK_COST;

    const first = unlockStoryCampaign(state, 'two-passports-story');
    const second = unlockStoryCampaign(state, 'two-passports-story');

    expect(first).toEqual({ unlocked: true });
    expect(second).toEqual({ unlocked: false, reason: 'already-unlocked' });
    expect(state.coins).toBe(0);
    expect(state.storyUnlocks).toEqual(['two-passports-story']);
  });

  it('does not mutate state when coins are insufficient', () => {
    const state = newStars();
    state.coins = STORY_UNLOCK_COST - 1;

    expect(canAffordStoryUnlock(state, 'miners-cup-story')).toBe(false);
    expect(storyUnlockShortfall(state, 'miners-cup-story')).toBe(1);
    expect(unlockStoryCampaign(state, 'miners-cup-story')).toEqual({
      unlocked: false,
      reason: 'insufficient-coins',
    });
    expect(state.coins).toBe(STORY_UNLOCK_COST - 1);
    expect(state.storyUnlocks).toEqual([]);
  });
});
