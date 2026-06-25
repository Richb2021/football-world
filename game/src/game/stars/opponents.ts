import type { TeamData, KitColors, Lineup } from '../../sim/types';
import { CARDS } from '../../data/cards';
import type { PlayerCard } from '../../data/cards';
import { FORMATION_NEEDS } from '../../sim/formations';
import { Rng } from '../../sim/rng';
import type { StarsState } from './types';
import { squadRating } from './squad';
import { cardToPlayer } from './squad';

// ---------------------------------------------------------------------------
// Opponent type
// ---------------------------------------------------------------------------

export interface Opponent {
  id: string;
  label: string;
  overall: number;
  stars: number;
  team: TeamData;
  lineup: Lineup;
  kit: KitColors;
}

// ---------------------------------------------------------------------------
// hashString — deterministic string → number (djb2)
// ---------------------------------------------------------------------------

export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Precompute position buckets (sorted by overall ascending for nearest search)
// ---------------------------------------------------------------------------

const POS_BUCKETS: Partial<Record<string, PlayerCard[]>> = {};

for (const card of CARDS) {
  if (!POS_BUCKETS[card.pos]) POS_BUCKETS[card.pos] = [];
  POS_BUCKETS[card.pos]!.push(card);
}

// Sort each bucket by overall for efficient nearest-pick
for (const pos of Object.keys(POS_BUCKETS)) {
  POS_BUCKETS[pos]!.sort((a, b) => a.overall - b.overall);
}

/** Pick from a band ±6 around targetOverall; fall back to nearest if band empty. */
function pickCardForPos(rng: Rng, pos: string, targetOverall: number): PlayerCard {
  const bucket = POS_BUCKETS[pos] ?? [];
  const band = bucket.filter((c) => Math.abs(c.overall - targetOverall) <= 6);
  if (band.length > 0) {
    return rng.pick(band);
  }
  // Nearest by overall
  const sorted = [...bucket].sort(
    (a, b) => Math.abs(a.overall - targetOverall) - Math.abs(b.overall - targetOverall),
  );
  return sorted[0] ?? bucket[0]!;
}

/** Generate a deterministic 6-digit hex colour from rng. */
function rngHex(rng: Rng): string {
  const r = rng.int(256).toString(16).padStart(2, '0');
  const g = rng.int(256).toString(16).padStart(2, '0');
  const b = rng.int(256).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// ---------------------------------------------------------------------------
// genOpponent
// ---------------------------------------------------------------------------

export function genOpponent(
  rng: Rng,
  targetOverall: number,
  label: string,
  idSeed: string,
): Opponent {
  const formation = '4-4-2' as const;
  const slotPositions: string[] = ['GK', ...FORMATION_NEEDS[formation]];

  const pickedCards: PlayerCard[] = slotPositions.map((pos) =>
    pickCardForPos(rng, pos, targetOverall),
  );

  const avgOverall = pickedCards.reduce((sum, c) => sum + c.overall, 0) / pickedCards.length;
  const strength = Math.round(avgOverall);

  const homeShirt = rngHex(rng);
  const homeShorts = rngHex(rng);
  const homeSocks = rngHex(rng);
  const awayShirt = rngHex(rng);
  const awayShorts = rngHex(rng);
  const awaySocks = rngHex(rng);

  const homeKit: KitColors = { shirt: homeShirt, shorts: homeShorts, socks: homeSocks };
  const awayKit: KitColors = { shirt: awayShirt, shorts: awayShorts, socks: awaySocks };

  const team: TeamData = {
    id: 'opp-' + idSeed,
    name: label,
    short: label.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'OPP',
    stadium: 'Stadium',
    strength,
    colors: { home: homeKit, away: awayKit },
    players: pickedCards.map((c, i) => cardToPlayer(c, i + 1)),
  };

  const lineup: Lineup = {
    formation,
    starters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  };

  const overall = strength;
  // stars: clamp(round(((overall - 50) / 45) * 5), 1, 5)
  const stars = Math.max(1, Math.min(5, Math.round(((overall - 50) / 45) * 5)));

  return { id: 'opp-' + idSeed, label, overall, stars, team, lineup, kit: homeKit };
}

// ---------------------------------------------------------------------------
// battleOpponents
// ---------------------------------------------------------------------------

const BATTLE_LABELS = ['Group Stage', 'Last 16', 'Quarter Final', 'Semi Final'];

export function battleOpponents(state: StarsState, weekKey: string): Opponent[] {
  const base = Math.max(squadRating(state), 62);
  const offsets = [-6, -2, +2, +6];

  return offsets.map((offset, i) => {
    const targetOverall = Math.max(50, Math.min(92, base + offset));
    const idSeed = `${weekKey}-${i}`;
    const rng = new Rng(hashString(weekKey) + i);
    return genOpponent(rng, targetOverall, BATTLE_LABELS[i], idSeed);
  });
}

// ---------------------------------------------------------------------------
// challengeOpponent
// ---------------------------------------------------------------------------

export function challengeOpponent(state: StarsState, index: number): Opponent {
  const base = Math.max(squadRating(state), 62);
  const target = Math.max(50, Math.min(92, base + (index % 4) - 1));
  const rng = new Rng(hashString('challenge') + index);
  return genOpponent(rng, target, `Challenge ${index + 1}`, `chal-${index}`);
}

// ---------------------------------------------------------------------------
// cupOpponent
// ---------------------------------------------------------------------------

export function cupOpponent(state: StarsState, gameIndex: number): Opponent {
  const base = Math.max(squadRating(state), 62);
  const target = Math.max(50, Math.min(94, base + 2 + gameIndex));
  const rng = new Rng(hashString('cup') + gameIndex);
  return genOpponent(rng, target, `Cup Round ${gameIndex + 1}`, `cup-${gameIndex}`);
}
