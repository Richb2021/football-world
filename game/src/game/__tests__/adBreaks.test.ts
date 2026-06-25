import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('match ad opportunities', () => {
  it('passes board creative and break opportunity callbacks into MatchRunner', () => {
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
    const runnerSource = readFileSync(new URL('../matchRunner.ts', import.meta.url), 'utf8');

    expect(appSource).toContain('private adManager = createAdManager()');
    expect(appSource).toContain('adBoardCreatives');
    expect(appSource).toContain('onAdOpportunity: (opportunity) => this.adManager.recordOpportunity(opportunity)');
    expect(runnerSource).toContain("placementId: 'half_time_break'");
    expect(runnerSource).toContain("placementId: 'post_match_break'");
  });

  it('records challenge and menu return break opportunities at result transitions', () => {
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');

    expect(appSource).toContain("placementId: 'challenge_result_break'");
    expect(appSource).toContain("placementId: 'return_to_menu_break'");
  });
});
