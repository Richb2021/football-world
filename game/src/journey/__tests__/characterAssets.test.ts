import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJourneyCharacterAsset } from '../characterAssets';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function publicAssetExists(assetPath: string): boolean {
  return existsSync(path.join(GAME_ROOT, 'public', assetPath));
}

describe('Journey character assets', () => {
  it('maps story NPCs to real sprite assets instead of placeholder bodies', () => {
    expect(getJourneyCharacterAsset('manager_clough')).toContain('manager_overcoat.webp');
    expect(getJourneyCharacterAsset('captain_whitlock')).toContain('captain_red_kit.webp');
    expect(getJourneyCharacterAsset('reporter_local')).toContain('reporter_notepad.webp');
    expect(getJourneyCharacterAsset('germany_captain_adler')).toContain('germany_defender.webp');
  });

  it('falls back to a player sprite for unknown teammates', () => {
    expect(getJourneyCharacterAsset('unknown_teammate')).toContain('young_teammate_red_kit.webp');
  });

  it('maps the custom story cast to dedicated transparent portraits', () => {
    const expected = {
      doctor_evans: 'assets/journey/characters/physio_bag.webp',
      manager_clough: 'assets/journey/characters/manager_overcoat.webp',
      agent_coyle: 'assets/journey/characters/agent_phone.webp',
      ty_coach_bell: 'assets/journey/characters/ty_coach_bell.webp',
      captain_whitlock: 'assets/journey/characters/captain_red_kit.webp',
      reporter_local: 'assets/journey/characters/reporter_notepad.webp',
      germany_captain_adler: 'assets/journey/characters/germany_defender.webp',
      // International Cup Story (2026) cast — generated portraits
      england_roommate_fox: 'assets/journey/characters/england_roommate_fox.webp',
      rival_dane: 'assets/journey/characters/rival_dane.webp',
      mentor_okafor: 'assets/journey/characters/mentor_okafor.webp',
      chairman_voss: 'assets/journey/characters/chairman_voss.webp',
      sister_mia: 'assets/journey/characters/sister_mia.webp',
      agent_rival_sharpe: 'assets/journey/characters/agent_rival_sharpe.webp',
      pundit_grady: 'assets/journey/characters/pundit_grady.webp',
      physio_lane: 'assets/journey/characters/physio_lane.webp',
      teammate_reyes: 'assets/journey/characters/teammate_reyes.webp',
      national_manager_strand: 'assets/journey/characters/national_manager_strand.webp',
    };

    for (const [npcId, asset] of Object.entries(expected)) {
      expect(getJourneyCharacterAsset(npcId)).toBe(asset);
      expect(publicAssetExists(asset)).toBe(true);
    }
  });
});
