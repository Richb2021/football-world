import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJourneyBackgroundAsset } from '../backgroundAssets';
import { allEpisodes } from '../episodes';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function publicAssetExists(assetPath: string): boolean {
  return existsSync(path.join(GAME_ROOT, 'public', assetPath));
}

describe('Journey background assets', () => {
  it('maps common scene backgrounds to prerendered cinematic stills', () => {
    expect(getJourneyBackgroundAsset({ type: 'home', variant: 'bedroom' })).toContain('bedroom_intl.webp');
    expect(getJourneyBackgroundAsset({ type: 'training', variant: 'morning' })).toContain('training_intl.webp');
    expect(getJourneyBackgroundAsset({ type: 'managerOffice', variant: 'day' })).toContain('manager_office_intl.webp');
  });

  it('honours explicit scene background assets over default mappings', () => {
    expect(getJourneyBackgroundAsset({
      type: 'pitch',
      variant: 'match',
      asset: 'assets/journey/backgrounds/season_opener_stadium_1992.webp',
    })).toContain('season_opener_stadium_1992.webp');
  });

  it('uses cinematic stills for the international cup story campaign', () => {
    const storyBackgrounds = allEpisodes
      .flatMap((episode) => episode.scenes.map((scene) => getJourneyBackgroundAsset(scene.background)))
      .filter((asset): asset is string => !!asset);
    const uniqueBackgrounds = [...new Set(storyBackgrounds)];

    expect(uniqueBackgrounds.length).toBeGreaterThanOrEqual(4);
    expect(uniqueBackgrounds.every((asset) => publicAssetExists(asset))).toBe(true);
  });
});
