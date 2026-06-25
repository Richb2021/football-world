import type { StarsState } from '../game/stars/types';
import type { StoryCampaignId } from './types';

export const STORY_UNLOCK_COST = 10_000;

export const FREE_STORY_CAMPAIGN_IDS: StoryCampaignId[] = [
  'international-cup-story',
  'last-dance-story',
];

export type StoryUnlockResult =
  | { unlocked: true }
  | { unlocked: false; reason: 'free' | 'already-unlocked' | 'insufficient-coins' };

export function freeStoryCampaignIds(): StoryCampaignId[] {
  return [...FREE_STORY_CAMPAIGN_IDS];
}

export function storyUnlockCost(campaignId: StoryCampaignId): number {
  return FREE_STORY_CAMPAIGN_IDS.includes(campaignId) ? 0 : STORY_UNLOCK_COST;
}

export function isStoryCampaignUnlocked(state: Pick<StarsState, 'storyUnlocks'>, campaignId: StoryCampaignId): boolean {
  return FREE_STORY_CAMPAIGN_IDS.includes(campaignId) || (state.storyUnlocks ?? []).includes(campaignId);
}

export function canAffordStoryUnlock(state: Pick<StarsState, 'coins' | 'storyUnlocks'>, campaignId: StoryCampaignId): boolean {
  return isStoryCampaignUnlocked(state, campaignId) || state.coins >= storyUnlockCost(campaignId);
}

export function storyUnlockShortfall(state: Pick<StarsState, 'coins' | 'storyUnlocks'>, campaignId: StoryCampaignId): number {
  return Math.max(0, storyUnlockCost(campaignId) - state.coins);
}

export function unlockStoryCampaign(state: StarsState, campaignId: StoryCampaignId): StoryUnlockResult {
  state.storyUnlocks ??= [];
  if (FREE_STORY_CAMPAIGN_IDS.includes(campaignId)) return { unlocked: false, reason: 'free' };
  if (state.storyUnlocks.includes(campaignId)) return { unlocked: false, reason: 'already-unlocked' };
  const cost = storyUnlockCost(campaignId);
  if (state.coins < cost) return { unlocked: false, reason: 'insufficient-coins' };
  state.coins -= cost;
  state.storyUnlocks.push(campaignId);
  return { unlocked: true };
}
