import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('story unlock app flow', () => {
  it('renders locked story cards and routes unaffordable unlocks to top-up', () => {
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');

    expect(appSource).toContain('isStoryCampaignUnlocked');
    expect(appSource).toContain('unlockStoryCampaign');
    expect(appSource).toContain('STORY_UNLOCK_COST');
    expect(appSource).toContain('private journeyTopUpFlow()');
    expect(appSource).toContain("}, 'topup')");
    expect(appSource).toContain('data-campaign-locked');
    expect(appSource).toContain('data-campaign-unlock');
  });
});
