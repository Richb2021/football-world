import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../data/teams';

const publicRoot = decodeURIComponent(new URL('../../../public/', import.meta.url).pathname);
const manifestPath = `${publicRoot}assets/manifest.json`;

function manifest(): Record<string, string> {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
}

describe('asset manifest', () => {
  it('does not preload generated badge art for teams outside the active roster', () => {
    const teamIds = new Set(TEAMS.map((team) => team.id));
    const staleBadges = Object.keys(manifest())
      .filter((key) => key.startsWith('badge_'))
      .filter((key) => !teamIds.has(key.slice('badge_'.length)));

    expect(staleBadges).toEqual([]);
  });

  it('does not keep retired public assets that Vite would still copy to dist', () => {
    const retiredAssets = [
      'assets/generated/badge_arsenal.png',
      'assets/generated/badge_arsenal.webp',
      'assets/generated/badge_aston-villa.png',
      'assets/generated/badge_aston-villa.webp',
      'assets/generated/badge_blackburn.png',
      'assets/generated/badge_blackburn.webp',
      'assets/generated/badge_chelsea.png',
      'assets/generated/badge_chelsea.webp',
      'assets/models/player.refine.json',
      'assets/models/player.rig.json',
      'assets/models/player_candidate.preview.json',
      'assets/models/player_candidate.refine.json',
      'assets/models/player_candidate.rig.json',
      'assets/models/player_candidate_anim_gk_sprawl_armature.glb',
      'assets/models/player_candidate_preview.glb',
      'assets/models/player_candidate_static.glb',
    ];
    const stillPresent = retiredAssets.filter((file) => existsSync(`${publicRoot}${file}`));

    expect(stillPresent).toEqual([]);
  });

  it('only references files that exist on disk', () => {
    const missing = Object.entries(manifest())
      .filter(([, file]) => !existsSync(`${publicRoot}${decodeURIComponent(file)}`))
      .map(([key, file]) => `${key}:${file}`);

    expect(missing).toEqual([]);
  });
});
