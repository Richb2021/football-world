import type { Pos } from '../sim/types';
import { overallRating } from '../sim/formations';
import { TEAMS } from './teams';

export type Rarity = 'bronze' | 'silver' | 'gold' | 'special';

export interface PlayerCard {
  id: string;
  name: string;
  teamId: string;
  nation: string;
  pos: Pos;
  overall: number;
  rarity: Rarity;
  attrs: { pace: number; pass: number; shoot: number; tackle: number; keeping: number };
  age: number;
  shirtNumber?: number;
  value?: number;
  source?: 'journey';
}

/** Convert a player display name to a URL/id-safe slug. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function rarityOf(overall: number): Rarity {
  if (overall >= 88) return 'special';
  if (overall >= 80) return 'gold';
  if (overall >= 70) return 'silver';
  return 'bronze';
}

export const CARD_BASE_VALUE: Record<Rarity, number> = {
  bronze: 250,
  silver: 900,
  gold: 3500,
  special: 12000,
};

export function cardValue(c: PlayerCard): number {
  if (typeof c.value === 'number') return Math.max(0, Math.round(c.value));
  return Math.round(CARD_BASE_VALUE[c.rarity] * (0.75 + c.overall / 200));
}

function buildCards(): PlayerCard[] {
  const cards: PlayerCard[] = [];

  for (const team of TEAMS) {
    // Track slugs used within this team to handle collisions
    const usedSlugs = new Map<string, number>();

    for (const player of team.players) {
      const overall = Math.round(overallRating(player));
      const rarity = rarityOf(overall);
      const baseSlug = slug(player.name);

      // Deduplicate within the same team
      const count = usedSlugs.get(baseSlug) ?? 0;
      usedSlugs.set(baseSlug, count + 1);
      const slugSuffix = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

      const id = `${team.id}:${slugSuffix}`;

      const card: PlayerCard = {
        id,
        name: player.name,
        teamId: team.id,
        nation: team.name,
        pos: player.pos,
        overall,
        rarity,
        attrs: {
          pace: player.pace,
          pass: player.pass,
          shoot: player.shoot,
          tackle: player.tackle,
          keeping: player.keeping,
        },
        age: player.age,
        ...(player.shirtNumber !== undefined ? { shirtNumber: player.shirtNumber } : {}),
      };

      cards.push(card);
    }
  }

  return cards;
}

export const CARDS: PlayerCard[] = buildCards();

export const CARD_BY_ID: Map<string, PlayerCard> = new Map(CARDS.map((c) => [c.id, c]));

export function cardById(id: string): PlayerCard | undefined {
  return CARD_BY_ID.get(id);
}
