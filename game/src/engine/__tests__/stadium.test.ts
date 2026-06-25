import { describe, expect, it } from 'vitest';
import {
  resolvePitchBoardCreatives,
  resolveBowlRenderProfile,
  resolveCrowdDensityProfile,
  resolveStadiumRenderProfile,
} from '../stadium';

describe('stadium render profiles', () => {
  it('makes training-ground fixtures small and visibly empty', () => {
    const profile = resolveStadiumRenderProfile({
      timeOfDay: 'day',
      weather: 'normal',
      venueProfile: 'training',
      crowdDensity: 'empty',
    });

    expect(profile.standHeight).toBeLessThan(8);
    expect(profile.includeEndStands).toBe(false);
    expect(profile.crowdFill).toBe(0);
    expect(profile.emptySeatAlpha).toBeGreaterThan(0.6);
  });

  it('keeps main stadium fixtures fuller and larger by default', () => {
    const profile = resolveStadiumRenderProfile({
      timeOfDay: 'day',
      weather: 'normal',
    });

    expect(profile.standHeight).toBeGreaterThan(9);
    expect(profile.includeEndStands).toBe(true);
    expect(profile.crowdFill).toBeGreaterThan(0.75);
  });

  it('supports stepped crowd density textures from empty to full', () => {
    expect(resolveCrowdDensityProfile('empty').crowdFill).toBe(0);
    expect(resolveCrowdDensityProfile('20').crowdFill).toBeCloseTo(0.2);
    expect(resolveCrowdDensityProfile('40').crowdFill).toBeCloseTo(0.4);
    expect(resolveCrowdDensityProfile('60').crowdFill).toBeCloseTo(0.6);
    expect(resolveCrowdDensityProfile('80').crowdFill).toBeCloseTo(0.8);
    expect(resolveCrowdDensityProfile('full').crowdFill).toBe(1);
  });

  it('overlaps the upper bowl seam so the skybox cannot show through', () => {
    const profile = resolveBowlRenderProfile(117, 80);

    expect(profile.thetaLength).toBeGreaterThan(Math.PI * 2);
    expect(profile.height).toBeGreaterThan(36);
    expect(profile.y).toBeLessThan(profile.height / 2 + 8.5);
  });
});

describe('stadium advertising boards', () => {
  it('uses supplied ad creative when provided', () => {
    const creatives = resolvePitchBoardCreatives('England', [
      { text: 'DIRECT SPONSOR', background: '#111111', foreground: '#ffffff' },
    ]);

    expect(creatives).toEqual([
      { text: 'DIRECT SPONSOR', background: '#111111', foreground: '#ffffff' },
    ]);
  });

  it('falls back to dummy fake-brand boards with the home team inserted', () => {
    const creatives = resolvePitchBoardCreatives('England');

    expect(creatives.map((creative) => creative.text)).toContain('ENGLAND');
    expect(creatives.length).toBeGreaterThan(4);
  });
});
