/** Pure injury policy: whether an injury happens, its tier, and how many matches it costs.
 * Stateless — MatchSim owns the state and feeds a seeded rng. Starting values are
 * harness-tuned. See docs/superpowers/specs/2026-06-27-injuries-design.md */

export type InjuryTier = 'none' | 'knock' | 'forcedOff' | 'serious';

/** non-pace effective-attribute multiplier while a knocked player plays on */
export const INJURY_KNOCK_DIP = 0.9;
/** how long (sim-seconds) the play-on dip from a knock lasts */
export const INJURY_KNOCK_SECONDS = 12;
/** per affected-player, per-match-minute chance of a non-contact knock (tired, late) */
export const INJURY_NONCONTACT_CHANCE = 0.0015;

export interface InjuryRollInput {
  /** foul severity 0..~1 for a contact injury; ignored when nonContact */
  contactSeverity: number;
  fromBehind: boolean;
  nonContact: boolean;
  /** seeded rng returning 0..1 */
  rng: () => number;
}

/** Does an injury occur, and at what tier? Consumes 1 rng() for the chance, then (if it
 * fires) 1 more for the tier. */
export function rollInjury(input: InjuryRollInput): InjuryTier {
  const chance = input.nonContact
    ? INJURY_NONCONTACT_CHANCE
    : Math.max(0, Math.min(0.14, 0.02 + input.contactSeverity * 0.07 + (input.fromBehind ? 0.04 : 0)));
  if (input.rng() >= chance) return 'none';
  const r = input.rng();
  if (r < 0.70) return 'knock';
  if (r < 0.94) return 'forcedOff';
  return 'serious';
}

/** Career layoff in matches for a forced-off/serious injury (0 for knock/none). */
export function injuryMatchesOut(tier: InjuryTier, rng: () => number): number {
  if (tier === 'forcedOff') return 1;
  if (tier === 'serious') return 2 + Math.floor(rng() * 2); // 2..3
  return 0;
}
