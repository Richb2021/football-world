import { careerSlots } from '../game/saves';
import { storySlots } from '../journey/state';
import { seasonsSlots } from '../game/seasons/ladder';
import { starsSlots } from '../game/stars/store';
import type { Career } from '../game/career';
import type { JourneyState } from '../journey/types';
import type { SeasonsState } from '../game/seasons/ladder';
import type { StarsState } from '../game/stars/types';

const MIGRATED_KEY = 'sl93.slots.migrated';

function readLegacy<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Import any pre-multi-slot saves into the new slot stores exactly once.
 * Legacy keys are left in place as a backup and never read again. */
export function migrateLegacySaves(): void {
  if (localStorage.getItem(MIGRATED_KEY) === '1') return;

  const career = readLegacy<Career>('sl93.save.v1');
  if (career && careerSlots.list().length === 0) careerSlots.importLegacy(career);

  const story = readLegacy<JourneyState>('journey_save_v1');
  if (story && storySlots.list().length === 0) storySlots.importLegacy(story);

  const seasons = readLegacy<SeasonsState>('sl93.seasons.v1');
  if (seasons && seasonsSlots.list().length === 0) seasonsSlots.importLegacy(seasons);

  const stars = readLegacy<StarsState>('sl93.stars.v1');
  if (stars && starsSlots.list().length === 0) starsSlots.save(stars, 'main');

  localStorage.setItem(MIGRATED_KEY, '1');
}
