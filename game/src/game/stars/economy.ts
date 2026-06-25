import { cardValue } from '../../data/cards';
import type { PlayerCard, Rarity } from '../../data/cards';

// ---------------------------------------------------------------------------
// Match reward constants
// ---------------------------------------------------------------------------

export const COINS = {
  win: 400,
  draw: 150,
  loss: 60,
  perGoal: 25,
  cleanSheet: 75,
} as const;

// ---------------------------------------------------------------------------
// Pack definitions
// ---------------------------------------------------------------------------

export interface PackDef {
  id: string;
  name: string;
  price: number;
  size: number;
  odds: Record<Rarity, number>;
  guarantee?: Rarity;
}

export const PACKS: PackDef[] = [
  {
    id: 'bronze',
    name: 'Bronze Pack',
    price: 800,
    size: 3,
    odds: { bronze: 0.85, silver: 0.14, gold: 0.01, special: 0 },
  },
  {
    id: 'silver',
    name: 'Silver Pack',
    price: 3000,
    size: 5,
    odds: { bronze: 0.45, silver: 0.45, gold: 0.095, special: 0.005 },
    guarantee: 'silver',
  },
  {
    id: 'gold',
    name: 'Gold Pack',
    price: 9000,
    size: 5,
    odds: { bronze: 0.20, silver: 0.50, gold: 0.28, special: 0.02 },
    guarantee: 'gold',
  },
  {
    id: 'premium',
    name: 'Premium Pack',
    price: 18000,
    size: 8,
    odds: { bronze: 0.05, silver: 0.45, gold: 0.45, special: 0.05 },
    guarantee: 'gold',
  },
  {
    id: 'special',
    name: 'Stars Pack',
    price: 35000,
    size: 10,
    odds: { bronze: 0, silver: 0.35, gold: 0.55, special: 0.10 },
    guarantee: 'special',
  },
];

export function packById(id: string): PackDef | undefined {
  return PACKS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Match reward
// ---------------------------------------------------------------------------

export function matchReward(
  result: 'win' | 'draw' | 'loss',
  goalsFor: number,
  goalsAgainst: number,
  mult?: number,
): number {
  let base = COINS[result];
  base += COINS.perGoal * goalsFor;
  if (goalsAgainst === 0 && result !== 'loss') {
    base += COINS.cleanSheet;
  }
  return Math.round(base * (mult ?? 1));
}

// ---------------------------------------------------------------------------
// Quick-sell
// ---------------------------------------------------------------------------

export function quickSell(c: PlayerCard): number {
  return Math.round(cardValue(c) * 0.33);
}

// ---------------------------------------------------------------------------
// Weekly free pack
// ---------------------------------------------------------------------------

export const WEEKLY_FREE_PACK = 'silver';

// ---------------------------------------------------------------------------
// Challenge tiers
// ---------------------------------------------------------------------------

export interface ChallengeTier {
  points: number;
  coins?: number;
  packId?: string;
  tokens?: number;
  qualifiesCup?: boolean;
}

export const CHALLENGE_TIERS: ChallengeTier[] = [
  { points: 300, coins: 1500, tokens: 1 },
  { points: 800, packId: 'gold', tokens: 1 },
  { points: 1500, coins: 6000, tokens: 2 },
  { points: 2500, packId: 'premium', tokens: 2, qualifiesCup: true },
];

// ---------------------------------------------------------------------------
// Cup tiers
// ---------------------------------------------------------------------------

export interface CupTier {
  wins: number;
  coins?: number;
  packId?: string;
  tokens?: number;
}

export const CUP_TIERS: CupTier[] = [
  { wins: 3, packId: 'gold', tokens: 1 },
  { wins: 5, packId: 'premium', tokens: 2 },
  { wins: 7, coins: 15000, tokens: 2 },
  { wins: 10, packId: 'special', tokens: 3 },
];
