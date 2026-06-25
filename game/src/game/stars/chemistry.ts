import type { PlayerCard } from '../../data/cards';
import type { FormationId } from '../../sim/types';
import { FORMATION_NEEDS } from '../../sim/formations';

export interface SquadChemistry {
  /** Length 11, each 0..10. Slot 0 = GK. */
  perSlot: number[];
  /** 0..100 */
  total: number;
}

/**
 * Compute chemistry for an 11-slot starter array (index 0 = GK).
 * Null slots score 0.
 */
export function squadChemistry(
  starters: (PlayerCard | null)[],
  formation: FormationId,
): SquadChemistry {
  const slotPos = (['GK', ...FORMATION_NEEDS[formation]] as string[]);

  const perSlot: number[] = slotPos.map((slotP, i) => {
    const card = starters[i];
    if (!card) return 0;

    const inPosition = card.pos === slotP;
    if (!inPosition) return 0;

    // Count OTHER non-null starters with same teamId
    let sameNation = 0;
    for (let j = 0; j < starters.length; j++) {
      if (j === i) continue;
      const other = starters[j];
      if (other && other.teamId === card.teamId) sameNation++;
    }

    let score = 6; // in position
    if (sameNation >= 1) score += 2;
    if (sameNation >= 2) score += 2;
    return score; // max 10
  });

  const sum = perSlot.reduce((acc, v) => acc + v, 0);
  const total = Math.min(100, Math.max(0, Math.round((sum / 110) * 100)));

  return { perSlot, total };
}

/**
 * Maps chemistry total (0..100) to a player form modifier.
 * Returns 50 at 0 chem, ~62 at 100 chem.
 */
export function formBoost(chemTotal: number): number {
  const clamped = Math.min(100, Math.max(0, chemTotal));
  return Math.round((50 + (clamped / 100) * 12) * 10) / 10;
}
