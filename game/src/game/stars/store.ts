import { CARDS, cardById, type PlayerCard } from '../../data/cards';
import { FORMATION_NEEDS } from '../../sim/formations';
import type { Pos } from '../../sim/types';
import type { StarsState, StarsSquad, StarsClub } from './types';
import { makeSaveSlots, type SaveSlots } from '../../net/saveSlots';
import { createArcadeTokensState, normaliseArcadeTokensState } from './arcadeTokens';
import { defaultOwnerProfile, defaultRivalsState, defaultWorldTourState, ensureOwnerModeState } from './ownerMode';

export const DEFAULT_STARS_CLUB_NAME = 'CUP STARS';
const DEFAULT_STARS_KIT = { shirt: '#ffd400', shorts: '#0a1763', socks: '#ffd400' } as const;
const MAX_STARS_CLUB_NAME_LENGTH = 24;

export function sanitizeStarsClubName(name: string | null | undefined, fallback = DEFAULT_STARS_CLUB_NAME): string {
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_STARS_CLUB_NAME_LENGTH);
  return cleaned || fallback;
}

function normaliseStarsClub(club: StarsClub | undefined, fallbackName = DEFAULT_STARS_CLUB_NAME): StarsClub {
  return {
    name: sanitizeStarsClubName(club?.name, fallbackName),
    crestKey: club?.crestKey,
    kit: club?.kit ?? { ...DEFAULT_STARS_KIT },
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Stars keeps a single cloud-synced slot with a fixed id so it shares the
 * multi-slot transport without exposing a picker. */
export const starsSlots: SaveSlots<StarsState> = makeSaveSlots<StarsState>('stars', {
  cap: 1,
  summarise: (s) => ({ name: sanitizeStarsClubName(s.club?.name), summary: `${s.coins} coins · ${s.arcadeTokens?.balance ?? 0} tokens` }),
  revive: (s) => {
    s.club = normaliseStarsClub(s.club);
    s.customCards ??= {};
    s.arcadeTokens = normaliseArcadeTokensState(s.arcadeTokens);
    s.purchaseIds ??= [];
    s.storyUnlocks ??= [];
    ensureOwnerModeState(s);
    return s;
  },
  valid: (s) => s.version === 1,
}, { genId: () => 'main' });

export function loadStars(): StarsState | null {
  return starsSlots.load('main');
}

export function saveStars(s: StarsState): void {
  starsSlots.setActive('main');
  starsSlots.save(s, 'main');
}

// ---------------------------------------------------------------------------
// newStars — deterministic fresh state, no Math.random
// ---------------------------------------------------------------------------

export function newStars(): StarsState {
  // Build position pools: only 'silver' | 'bronze', sorted by id (stable)
  const pools: Record<Pos, typeof CARDS> = { GK: [], DF: [], MF: [], FW: [] };
  for (const card of CARDS) {
    if (card.rarity === 'silver' || card.rarity === 'bronze') {
      pools[card.pos].push(card);
    }
  }
  for (const pos of Object.keys(pools) as Pos[]) {
    pools[pos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // Take: 2 GK, 5 DF, 5 MF, 3 FW = 15 starter cards
  const picks: { pos: Pos; count: number }[] = [
    { pos: 'GK', count: 2 },
    { pos: 'DF', count: 5 },
    { pos: 'MF', count: 5 },
    { pos: 'FW', count: 3 },
  ];

  const owned: Record<string, number> = {};
  const usedByPos: Record<Pos, string[]> = { GK: [], DF: [], MF: [], FW: [] };

  for (const { pos, count } of picks) {
    const pool = pools[pos];
    for (let i = 0; i < count; i++) {
      const card = pool[i];
      owned[card.id] = 1;
      usedByPos[pos].push(card.id);
    }
  }

  // Build squad starters for 4-4-2
  const formation = '4-4-2' as const;
  const needs = FORMATION_NEEDS[formation]; // 10 outfield positions

  const iterators: Record<Pos, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const starters: (string | null)[] = new Array(11).fill(null);

  // Slot 0 = GK
  starters[0] = usedByPos['GK'][iterators['GK']++];

  // Slots 1..10 = outfield per formation needs
  for (let i = 0; i < needs.length; i++) {
    const pos = needs[i];
    starters[i + 1] = usedByPos[pos][iterators[pos]++];
  }

  const squad: StarsSquad = { formation, starters };

  const state: StarsState = {
    version: 1,
    coins: 5000,
    owned,
    customCards: {},
    squad,
    club: {
      name: DEFAULT_STARS_CLUB_NAME,
      kit: { ...DEFAULT_STARS_KIT },
    },
    challenge: {
      weekKey: '',
      points: 0,
      played: 0,
      rewardsClaimed: [],
    },
    cup: {
      weekKey: null,
      qualified: false,
      played: 0,
      wins: 0,
      losses: 0,
      finished: false,
      rewardClaimed: false,
    },
    battles: {
      weekKey: '',
      points: 0,
      played: 0,
    },
    owner: defaultOwnerProfile(),
    rivals: defaultRivalsState(''),
    worldTour: defaultWorldTourState(''),
    weekly: { lastGrantWeek: '' },
    arcadeTokens: createArcadeTokensState(),
    storyUnlocks: [],
    packRngSeed: 0x53544152,
    purchaseIds: [],
  };
  // Leave the weekly keys empty (like challenge/battles above) so a fresh save is
  // fully deterministic — no Date.now() baked in. The current ISO week is filled
  // lazily by ensureOwnerModeState / resetIfNewWeek at first access.
  return state;
}

// ---------------------------------------------------------------------------
// Mutators — each mutates in place, saves, returns s
// ---------------------------------------------------------------------------

export function addCoins(s: StarsState, delta: number): StarsState {
  s.coins = Math.max(0, s.coins + delta);
  saveStars(s);
  return s;
}

export function addCard(s: StarsState, cardId: string, count = 1): StarsState {
  s.owned[cardId] = (s.owned[cardId] ?? 0) + count;
  saveStars(s);
  return s;
}

export function removeCard(s: StarsState, cardId: string, count = 1): StarsState {
  const current = s.owned[cardId] ?? 0;
  const next = current - count;
  if (next <= 0) {
    delete s.owned[cardId];
    // Keep the squad consistent: a card you no longer own can't remain in the XI
    // (defends against corrupt saves / future callers; UI already blocks selling
    // a card whose only copy is fielded).
    s.squad.starters = s.squad.starters.map((id) => (id === cardId ? null : id));
  } else {
    s.owned[cardId] = next;
  }
  saveStars(s);
  return s;
}

export function setSquad(s: StarsState, squad: StarsSquad): StarsState {
  s.squad = squad;
  saveStars(s);
  return s;
}

export function setClub(s: StarsState, club: StarsClub): StarsState {
  s.club = normaliseStarsClub(club, sanitizeStarsClubName(s.club?.name));
  saveStars(s);
  return s;
}

export function ownedCount(s: StarsState, cardId: string): number {
  return s.owned[cardId] ?? 0;
}

export function starsCardById(s: Pick<StarsState, 'customCards'> | null | undefined, cardId: string): PlayerCard | undefined {
  return s?.customCards?.[cardId] ?? cardById(cardId);
}

// Re-export cardById for convenience (tests use it too)
export { cardById };
