import { CARDS } from '../../data/cards';
import type { PlayerCard, Rarity } from '../../data/cards';
import { Rng } from '../../sim/rng';
import { addCard, addCoins, saveStars } from './store';
import { packById } from './economy';
import type { StarsState } from './types';

// ---------------------------------------------------------------------------
// Precompute card pools by rarity at module load
// ---------------------------------------------------------------------------

const RARITY_ORDER: Rarity[] = ['bronze', 'silver', 'gold', 'special'];

const POOLS: Record<Rarity, PlayerCard[]> = {
  bronze: [],
  silver: [],
  gold: [],
  special: [],
};

for (const card of CARDS) {
  POOLS[card.rarity].push(card);
}

// ---------------------------------------------------------------------------
// Pack result type
// ---------------------------------------------------------------------------

export interface PackResult {
  state: StarsState;
  pulled: PlayerCard[];
}

// ---------------------------------------------------------------------------
// Rarity rolling helpers
// ---------------------------------------------------------------------------

/** Roll a rarity from cumulative probability thresholds. */
function rollRarity(rng: Rng, odds: Record<Rarity, number>): Rarity {
  const r = rng.next();
  let cumulative = 0;
  for (const rarity of RARITY_ORDER) {
    cumulative += odds[rarity];
    if (r < cumulative) return rarity;
  }
  // Fallback in case of floating-point imprecision — return the last rarity with nonzero odds
  for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
    if (odds[RARITY_ORDER[i]] > 0) return RARITY_ORDER[i];
  }
  return 'bronze';
}

/** Numeric rank so we can compare rarities: bronze=0, silver=1, gold=2, special=3 */
function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

// ---------------------------------------------------------------------------
// openPack
// ---------------------------------------------------------------------------

export function openPack(state: StarsState, packId: string): PackResult {
  const pack = packById(packId);
  if (!pack) throw new Error('unknown pack');
  if (state.coins < pack.price) throw new Error('insufficient coins');

  // Deduct price
  addCoins(state, -pack.price);

  // Use current seed for this open
  const rng = new Rng(state.packRngSeed);

  // Roll all cards
  const pulled: PlayerCard[] = [];

  for (let i = 0; i < pack.size; i++) {
    const rarity = rollRarity(rng, pack.odds);
    const pool = POOLS[rarity];
    const card = pool.length > 0 ? rng.pick(pool) : rng.pick(CARDS);
    pulled.push(card);
  }

  // Apply guarantee: if no card meets the guarantee rarity, replace the last card
  if (pack.guarantee !== undefined) {
    const guaranteeRank = rarityRank(pack.guarantee);
    const hasSatisfied = pulled.some((c) => rarityRank(c.rarity) >= guaranteeRank);
    if (!hasSatisfied) {
      const replacementPool = POOLS[pack.guarantee];
      const replacement =
        replacementPool.length > 0 ? rng.pick(replacementPool) : rng.pick(CARDS);
      pulled[pulled.length - 1] = replacement;
    }
  }

  // Add all pulled cards to owned
  for (const card of pulled) {
    addCard(state, card.id);
  }

  // Advance the seed with an LCG step so the next open differs
  state.packRngSeed = ((state.packRngSeed * 1664525 + 1013904223) >>> 0);

  // Persist
  saveStars(state);

  return { state, pulled };
}
