import { describe, it, expect, beforeEach } from 'vitest';
import { newStars } from '../store';
import type { StarsState } from '../types';
import {
  cardToPlayer,
  resolveStarters,
  squadRating,
  buildStarsTeam,
  starsMatchTeam,
} from '../squad';
import { cardById, type PlayerCard } from '../../../data/cards';

// ---------------------------------------------------------------------------
// Fake localStorage for node env
// ---------------------------------------------------------------------------
function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  globalThis.localStorage = makeFakeStorage();
});

// ---------------------------------------------------------------------------
// cardToPlayer
// ---------------------------------------------------------------------------
describe('cardToPlayer', () => {
  it('maps attrs correctly', () => {
    const state = newStars();
    const id = state.squad.starters[0]!;
    const card = cardById(id)!;
    const player = cardToPlayer(card, 1);
    expect(player.name).toBe(card.name);
    expect(player.pos).toBe(card.pos);
    expect(player.age).toBe(card.age);
    expect(player.pace).toBe(card.attrs.pace);
    expect(player.pass).toBe(card.attrs.pass);
    expect(player.shoot).toBe(card.attrs.shoot);
    expect(player.tackle).toBe(card.attrs.tackle);
    expect(player.keeping).toBe(card.attrs.keeping);
    expect(player.shirtNumber).toBe(1);
  });

  it('omits shirtNumber when not provided', () => {
    const state = newStars();
    const id = state.squad.starters[0]!;
    const card = cardById(id)!;
    const player = cardToPlayer(card);
    expect('shirtNumber' in player).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveStarters
// ---------------------------------------------------------------------------
describe('resolveStarters', () => {
  it('returns 11 non-null cards for a full squad', () => {
    const state = newStars();
    const cards = resolveStarters(state);
    expect(cards.length).toBe(11);
    for (const c of cards) {
      expect(c).not.toBeNull();
    }
  });

  it('returns null in the right slot when a starter is null', () => {
    const state = newStars();
    state.squad.starters[3] = null;
    const cards = resolveStarters(state);
    expect(cards[3]).toBeNull();
  });

  it('resolves custom reward cards from the Stars state', () => {
    const state = newStars();
    const rewardCard: PlayerCard = {
      id: 'journey:two-passports-story:malik-carter',
      name: 'Malik Carter',
      teamId: 'journey:two-passports-story',
      nation: 'Two Passports',
      pos: 'FW',
      overall: 88,
      rarity: 'special',
      value: 0,
      attrs: { pace: 88, pass: 84, shoot: 90, tackle: 58, keeping: 12 },
      age: 29,
    };
    state.customCards = { [rewardCard.id]: rewardCard };
    state.owned[rewardCard.id] = 1;
    state.squad.starters[10] = rewardCard.id;

    const cards = resolveStarters(state);
    expect(cards[10]).toEqual(rewardCard);
    expect(starsMatchTeam(state, 'human').data.players[10].name).toBe('Malik Carter');
  });
});

// ---------------------------------------------------------------------------
// squadRating
// ---------------------------------------------------------------------------
describe('squadRating', () => {
  it('returns a value in (0, 100] for a full squad', () => {
    const state = newStars();
    const rating = squadRating(state);
    expect(rating).toBeGreaterThan(0);
    expect(rating).toBeLessThanOrEqual(100);
  });

  it('returns 0 if any starter is null', () => {
    const state = newStars();
    state.squad.starters[5] = null;
    expect(squadRating(state)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// starsMatchTeam — full squad
// ---------------------------------------------------------------------------
describe('starsMatchTeam', () => {
  let state: StarsState;

  beforeEach(() => {
    state = newStars();
  });

  it('produces 11 players', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.data.players.length).toBe(11);
  });

  it('first player is GK', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.data.players[0].pos).toBe('GK');
  });

  it('lineup.starters deep-equals [0..10]', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.lineup.starters).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('lineup.formation is the squad formation', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.lineup.formation).toBe(state.squad.formation);
  });

  it('controller is human', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.controller).toBe('human');
  });

  it('playerForm has keys 0..10 each >= 50', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.playerForm).toBeDefined();
    for (let i = 0; i <= 10; i++) {
      expect(config.playerForm![i]).toBeGreaterThanOrEqual(50);
    }
  });

  it('kit is defined with shirt/shorts/socks', () => {
    const config = starsMatchTeam(state, 'human');
    expect(config.kit).toBeDefined();
    expect(typeof config.kit.shirt).toBe('string');
    expect(typeof config.kit.shorts).toBe('string');
    expect(typeof config.kit.socks).toBe('string');
  });

  it('throws Error("incomplete squad") when a starter is null', () => {
    state.squad.starters[2] = null;
    expect(() => starsMatchTeam(state, 'human')).toThrow('incomplete squad');
  });
});

// ---------------------------------------------------------------------------
// buildStarsTeam
// ---------------------------------------------------------------------------
describe('buildStarsTeam', () => {
  it('id is stars-club and stadium is Stars Arena', () => {
    const state = newStars();
    const cards = resolveStarters(state) as ReturnType<typeof resolveStarters>;
    // all non-null because newStars() is complete
    const { data } = starsMatchTeam(state, 'human');
    expect(data.id).toBe('stars-club');
    expect(data.stadium).toBe('Stars Arena');
  });

  it('short is at most 3 chars and uppercase', () => {
    const { data } = starsMatchTeam(newStars(), 'human');
    expect(data.short.length).toBeLessThanOrEqual(3);
    expect(data.short).toBe(data.short.toUpperCase());
  });

  it('strength equals round(avg overall of starters)', () => {
    const state = newStars();
    const cards = resolveStarters(state);
    const nonNull = cards.filter((c) => c !== null) as NonNullable<(typeof cards)[number]>[];
    const expected = Math.round(nonNull.reduce((s, c) => s + c.overall, 0) / nonNull.length);
    const { data } = starsMatchTeam(state, 'human');
    expect(data.strength).toBe(expected);
  });

  it('away kit is different from home kit', () => {
    const { data } = starsMatchTeam(newStars(), 'human');
    expect(data.colors.home.shirt).not.toBe(data.colors.away.shirt);
  });
});
