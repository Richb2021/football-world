import type { SceneBackground } from './types';

const ROOT = 'assets/journey/backgrounds/';

// Modern (2026) International Cup Story art. Older 1992-era PNGs remain on disk
// for any retro campaign but the live story uses these contemporary backdrops.
const DEFAULT_BACKGROUNDS: Record<string, string> = {
  'home:bedroom': 'bedroom_intl.webp',
  'home:livingRoom': 'kitchen_intl.webp',
  'home:kitchen': 'kitchen_intl.webp',
  'training:morning': 'training_intl.webp',
  'training:evening': 'training_intl.webp',
  'training:rain': 'training_intl.webp',
  'managerOffice:day': 'manager_office_intl.webp',
  'managerOffice:night': 'manager_office_intl.webp',
  'lockerRoom:before': 'locker_room_intl.webp',
  'lockerRoom:after': 'locker_room_intl.webp',
  'lockerRoom:empty': 'locker_room_intl.webp',
  'town:pub': 'pub_intl.webp',
  'town:street': 'pub_intl.webp',
  'pitch:match': 'pitch_intl.webp',
  'pitch:empty': 'pitch_intl.webp',
  'hospital:room': 'hospital_intl.webp',
  'media:pressRoom': 'press_room_intl.webp',
  'media:interview': 'press_room_intl.webp',
  'car:interior': 'car_interior_night.webp',
  'physio:treatment': 'physio_room_intl.webp',
};

export function getJourneyBackgroundAsset(background: SceneBackground): string | null {
  if (background.asset) return background.asset;
  const variant = (background as { variant?: string }).variant;
  if (!variant) return null;
  const file = DEFAULT_BACKGROUNDS[`${background.type}:${variant}`];
  return file ? `${ROOT}${file}` : null;
}
