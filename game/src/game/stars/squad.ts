import type { PlayerAttrs, TeamData, KitColors, FormationId, Lineup } from '../../sim/types';
import type { MatchTeamConfig, ControllerKind } from '../../sim/types';
import type { PlayerCard } from '../../data/cards';
import { starsCardById } from './store';
import type { StarsState, StarsClub } from './types';
import { squadChemistry, formBoost } from './chemistry';

// ---------------------------------------------------------------------------
// cardToPlayer
// ---------------------------------------------------------------------------

export function cardToPlayer(c: PlayerCard, shirtNumber?: number): PlayerAttrs {
  return {
    name: c.name,
    pos: c.pos,
    age: c.age,
    pace: c.attrs.pace,
    pass: c.attrs.pass,
    shoot: c.attrs.shoot,
    tackle: c.attrs.tackle,
    keeping: c.attrs.keeping,
    ...(shirtNumber !== undefined ? { shirtNumber } : {}),
  };
}

// ---------------------------------------------------------------------------
// resolveStarters
// ---------------------------------------------------------------------------

export function resolveStarters(state: StarsState): (PlayerCard | null)[] {
  return state.squad.starters.map((id) => (id == null ? null : (starsCardById(state, id) ?? null)));
}

// ---------------------------------------------------------------------------
// squadRating
// ---------------------------------------------------------------------------

export function squadRating(state: StarsState): number {
  const cards = resolveStarters(state);
  if (cards.some((c) => c === null)) return 0;
  const total = (cards as PlayerCard[]).reduce((sum, c) => sum + c.overall, 0);
  return Math.round(total / cards.length);
}

// ---------------------------------------------------------------------------
// contrastKit — simple but valid hex
// ---------------------------------------------------------------------------

function hexChannel(h: string, offset: number): string {
  const v = parseInt(h, 16);
  const inverted = Math.max(0, Math.min(255, 255 - v + offset));
  return inverted.toString(16).padStart(2, '0');
}

/** Produce an away kit by inverting the shirt colour and swapping shirt/socks. */
export function contrastKit(kit: KitColors): KitColors {
  const shirt = kit.shirt.replace(/^#/, '');
  const r = hexChannel(shirt.slice(0, 2), 0);
  const g = hexChannel(shirt.slice(2, 4), 0);
  const b = hexChannel(shirt.slice(4, 6), 0);
  const awayShirt = `#${r}${g}${b}`;
  // Use white shorts for contrast
  return { shirt: awayShirt, shorts: '#ffffff', socks: kit.shirt };
}

// ---------------------------------------------------------------------------
// buildStarsTeam
// ---------------------------------------------------------------------------

export function buildStarsTeam(
  starterCards: PlayerCard[],
  club: StarsClub,
  formation: FormationId,
): TeamData {
  const avgOverall = starterCards.reduce((sum, c) => sum + c.overall, 0) / starterCards.length;
  const strength = Math.round(avgOverall);

  // 3-letter short: strip non-alpha, first 3 uppercase
  const short = club.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'STR';

  const homeKit = club.kit;
  const awayKit = contrastKit(homeKit);

  return {
    id: 'stars-club',
    name: club.name,
    short,
    stadium: 'Stars Arena',
    strength,
    colors: { home: homeKit, away: awayKit },
    players: starterCards.map((c, i) => cardToPlayer(c, i + 1)),
  };
}

// ---------------------------------------------------------------------------
// starsMatchTeam
// ---------------------------------------------------------------------------

export function starsMatchTeam(state: StarsState, controller: ControllerKind): MatchTeamConfig {
  const cards = resolveStarters(state);
  if (cards.some((c) => c === null)) {
    throw new Error('incomplete squad');
  }
  const starterCards = cards as PlayerCard[];

  const formation = state.squad.formation;
  const data = buildStarsTeam(starterCards, state.club, formation);

  const lineup: Lineup = {
    formation,
    starters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  };

  const kit = state.club.kit;

  // Chemistry-based form boost applied uniformly to all 11 slots
  const chem = squadChemistry(starterCards, formation);
  const boost = formBoost(chem.total);
  const playerForm: Record<number, number> = {};
  for (let i = 0; i < 11; i++) {
    playerForm[i] = boost;
  }

  return { data, lineup, kit, controller, playerForm };
}
