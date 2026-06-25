import { TEAMS } from '../../data/teams';
import { Rng } from '../../sim/rng';
import { makeSaveSlots, type SaveSlots } from '../../net/saveSlots';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeasonsState {
  version: 1;
  teamIdx: number;        // index into TEAMS — the player's club
  division: number;       // 1 = top .. 5 = bottom
  seasonNo: number;       // lifetime season counter (starts 1)
  step: number;           // 0..GAMES_PER_SEASON, fixtures completed
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  titles: number;         // times won the top division
  lastOutcome?: 'promoted' | 'relegated' | 'stayed' | 'champion';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GAMES_PER_SEASON = 10;
export const TOP_DIVISION = 1;
export const BOTTOM_DIVISION = 5;
export const SEASONS_KEY = 'sl93.seasons.v1';

// Strength bands per division (inclusive min..max)
const DIV_BANDS: Record<number, [number, number]> = {
  5: [52, 64],
  4: [60, 70],
  3: [66, 76],
  2: [72, 84],
  1: [80, 93],
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function seasonsAutoName(s: SeasonsState): string {
  return `${TEAMS[s.teamIdx].name} — Div ${s.division}`;
}

export const seasonsSlots: SaveSlots<SeasonsState> = makeSaveSlots<SeasonsState>('seasons', {
  cap: 6,
  summarise: (s) => ({
    name: seasonsAutoName(s),
    summary: `Season ${s.seasonNo} · ${s.points} pts`,
  }),
  valid: (s) => s.version === 1,
});

export function loadSeasons(): SeasonsState | null {
  return seasonsSlots.load();
}

export function saveSeasons(s: SeasonsState): void {
  seasonsSlots.save(s);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function newSeasons(teamIdx: number): SeasonsState {
  return {
    version: 1,
    teamIdx,
    division: BOTTOM_DIVISION,
    seasonNo: 1,
    step: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    titles: 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function divisionName(division: number): string {
  return division === TOP_DIVISION ? 'Premier Division' : `Division ${division}`;
}

export function promotionThreshold(): number {
  return 20;
}

export function relegationThreshold(): number {
  return 9;
}

export function seasonComplete(s: SeasonsState): boolean {
  return s.step >= GAMES_PER_SEASON;
}

// ---------------------------------------------------------------------------
// Opponent selection
// ---------------------------------------------------------------------------

export function opponentFor(s: SeasonsState, step: number): number {
  const [min, max] = DIV_BANDS[s.division] ?? [52, 64];

  // Prefer teams whose strength falls in the band
  let pool = TEAMS
    .map((t, i) => ({ i, strength: t.strength }))
    .filter(({ i, strength }) => i !== s.teamIdx && strength >= min && strength <= max);

  // Fallback: pick nearest teams by strength distance (excluding player's team)
  if (pool.length === 0) {
    const midpoint = (min + max) / 2;
    pool = TEAMS
      .map((t, i) => ({ i, strength: t.strength }))
      .filter(({ i }) => i !== s.teamIdx)
      .sort((a, b) => Math.abs(a.strength - midpoint) - Math.abs(b.strength - midpoint))
      .slice(0, 8);
  }

  const rng = new Rng(s.seasonNo * 1000 + step);
  return pool[rng.int(pool.length)].i;
}

// ---------------------------------------------------------------------------
// Result recording + season rollover
// ---------------------------------------------------------------------------

export function recordResult(
  s: SeasonsState,
  outcome: { score: [number, number]; winner: -1 | 0 | 1 },
): void {
  // Sim convention (matchSim winner): 0 = home win (the user is HOME), 1 = away
  // win (cpu), -1 = draw.
  const result: 'win' | 'draw' | 'loss' =
    outcome.winner === 0 ? 'win' : outcome.winner === 1 ? 'loss' : 'draw';

  if (result === 'win') {
    s.wins += 1;
    s.points += 3;
  } else if (result === 'draw') {
    s.draws += 1;
    s.points += 1;
  } else {
    s.losses += 1;
  }

  s.goalsFor += outcome.score[0];
  s.goalsAgainst += outcome.score[1];
  s.step += 1;

  if (seasonComplete(s)) {
    // Determine end-of-season outcome
    if (s.division === TOP_DIVISION && s.points >= promotionThreshold()) {
      s.titles += 1;
      s.lastOutcome = 'champion';
      // division stays TOP_DIVISION
    } else if (s.points >= promotionThreshold()) {
      s.division = Math.max(TOP_DIVISION, s.division - 1);
      s.lastOutcome = 'promoted';
    } else if (s.points <= relegationThreshold()) {
      s.division = Math.min(BOTTOM_DIVISION, s.division + 1);
      s.lastOutcome = 'relegated';
    } else {
      s.lastOutcome = 'stayed';
    }

    // Start the new season (keep teamIdx, division, titles, lastOutcome)
    s.seasonNo += 1;
    s.step = 0;
    s.points = 0;
    s.wins = 0;
    s.draws = 0;
    s.losses = 0;
    s.goalsFor = 0;
    s.goalsAgainst = 0;
  }
}
