import { describe, expect, it } from 'vitest';
import { createAdManager } from '../adManager';
import type { AdProvider } from '../types';

describe('AdManager', () => {
  it('swallows provider placement failures and falls back to no creative', () => {
    const provider: AdProvider = {
      getPlacements: () => { throw new Error('provider down'); },
      recordOpportunity: () => undefined,
    };

    expect(createAdManager(provider).getPlacements({
      surface: 'world_board',
      placementId: 'pitch_boards',
    })).toEqual([]);
  });

  it('swallows break opportunity failures', () => {
    const provider: AdProvider = {
      getPlacements: () => [],
      recordOpportunity: () => { throw new Error('provider down'); },
    };

    expect(() => createAdManager(provider).recordOpportunity({
      surface: 'break',
      placementId: 'post_match_break',
    })).not.toThrow();
  });

  it('forwards break opportunities to the active provider', () => {
    const seen: string[] = [];
    const provider: AdProvider = {
      getPlacements: () => [],
      recordOpportunity: (opportunity) => { seen.push(opportunity.placementId); },
    };

    const manager = createAdManager(provider);
    manager.recordOpportunity({ surface: 'break', placementId: 'half_time_break' });
    manager.recordOpportunity({ surface: 'break', placementId: 'post_match_break' });

    expect(seen).toEqual(['half_time_break', 'post_match_break']);
  });
});
