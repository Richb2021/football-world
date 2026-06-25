/**
 * Photo-realistic portrait avatars used by the phone inbox and the press
 * conference, replacing the procedural SVG portraits.
 *
 * Two sources:
 *  - STORY (journey) contacts -> head-and-shoulders crops of the actual story
 *    character art (avatars/journey/<seed>.png), so each phone message shows the
 *    right face (Mia, the agent, the physio, etc.).
 *  - CUP / generic contacts -> purpose-generated photographic headshots
 *    (avatars/<key>.png) for the federation CEO, agent, family, reporters, ...
 *
 * Resolution for a phone message: explicit avatarAsset, then a journey-cast
 * match on avatarSeed, then a generic match on avatarSeed, then a default for
 * the senderType, then a generated reporter portrait as the final fallback.
 */
import type { SenderType } from './metaTypes';

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const A = (key: string): string => `${BASE}assets/avatars/${key}.webp`;
const J = (key: string): string => `${BASE}assets/avatars/journey/${key}.webp`;
const DEFAULT_AVATAR = A('reporter_1');

/** Story cast — cropped from the full-body character sprites, keyed by NPC id / avatarSeed. */
const JOURNEY_PORTRAITS: Record<string, string> = {
  sister_mia: J('sister_mia'),
  dad: J('dad'),
  mentor_okafor: J('mentor_okafor'),
  pundit_grady: J('pundit_grady'),
  physio_lane: J('physio_lane'),
  rival_dane: J('rival_dane'),
  national_manager_strand: J('national_manager_strand'),
  germany_captain_adler: J('germany_captain_adler'),
  agent_rival_sharpe: J('agent_rival_sharpe'),
  manager_clough: J('manager_clough'),
  doctor_evans: J('doctor_evans'),
  reporter_local: J('reporter_local'),
  captain_whitlock: J('captain_whitlock'),
  england_roommate_fox: J('england_roommate_fox'),
  teammate_reyes: J('teammate_reyes'),
  ty_coach_bell: J('ty_coach_bell'),
  chairman_voss: J('chairman_voss'),
  ld_daughter_lina: J('ld_daughter_lina'),
  tp_grandmother_ana: J('tp_grandmother_ana'),
};

/** Generic / cup contacts — purpose-built photographic headshots, keyed by avatarSeed. */
const BY_SEED: Record<string, string> = {
  exec_ceo: A('exec_ceo'),
  agent_coyle: A('agent_coyle'),
  assistant_coach: A('assistant_coach'),
  physio: J('physio_lane'),
  illness: J('physio_lane'),
  fan_hype: A('home_family'),
  fanvoice: A('home_family'),
  fairytale_wave: A('home_family'),
  home_family: A('home_family'),
  old_teammate: A('old_teammate'),
  pundit_tv: A('pundit_tv'),
  reporter_1: A('reporter_1'),
  reporter_2: A('reporter_2'),
  reporter_3: A('reporter_3'),
  reporter_4: A('reporter_4'),
  reporter_5: A('reporter_5'),
  reporter_6: A('reporter_6'),
};

/** Default portrait per sender category, so every meta contact reads as a real person. */
const BY_TYPE: Partial<Record<SenderType, string>> = {
  chairman: A('exec_ceo'),
  agent: A('agent_coyle'),
  assistant: A('assistant_coach'),
  physio: J('physio_lane'),
  family: A('home_family'),
  fan: A('home_family'),
  teammate: A('old_teammate'),
  captain: A('old_teammate'),
  pundit: A('pundit_tv'),
  media: A('reporter_1'),
  unknown: DEFAULT_AVATAR,
};

/** A photographic portrait for a phone/meta contact. */
export function realAvatar(seed: string | undefined, senderType?: SenderType): string {
  if (seed && JOURNEY_PORTRAITS[seed]) return JOURNEY_PORTRAITS[seed];
  if (seed && BY_SEED[seed]) return BY_SEED[seed];
  if (senderType && BY_TYPE[senderType]) return BY_TYPE[senderType];
  return DEFAULT_AVATAR;
}

const REPORTER_POOL = [
  A('reporter_1'), A('reporter_2'), A('reporter_3'),
  A('reporter_4'), A('reporter_5'), A('reporter_6'),
];

/** Stable photographic headshot for the press-conference reporter at panel position `index`. */
export function reporterAvatar(index: number): string {
  return REPORTER_POOL[((index % REPORTER_POOL.length) + REPORTER_POOL.length) % REPORTER_POOL.length];
}
