import type { TeamData } from '../sim/types';
import { TEAMS, setActiveLeagueTeams, clubById } from './teams';
import { WC_TEAM_IDS } from './worldCup';
import pyramid from './english-pyramid.json';

export interface LeagueDef {
  id: string;
  name: string;
  teams: TeamData[];
}

/**
 * League registry.
 *  - `international-cup`: exactly the 48 nations that qualified for the World Cup
 *    (the cup-mode field).
 *  - `all-nations`: every nation in the game, including sides that did not
 *    qualify — used by Exhibition so any team can play any team.
 */
function buildLeagues(): LeagueDef[] {
  const byName = (a: TeamData, b: TeamData) => a.name.localeCompare(b.name);
  const all = TEAMS.slice().sort(byName);
  const qualified = all.filter((t) => WC_TEAM_IDS.includes(t.id));
  const englishTiers = (pyramid as { tiers: { tier: number; leagueId: string; name: string; teamIds: string[] }[] }).tiers;
  return [
    { id: 'international-cup', name: 'International Cup', teams: qualified },
    { id: 'all-nations', name: 'All Nations', teams: all },
    // English pyramid (club football) — resolved from src/data/teams/clubs/*.json
    ...englishTiers.map((t) => ({
      id: t.leagueId,
      name: t.name,
      teams: t.teamIds.map((id) => clubById(id)).sort(byName),
    })),
  ];
}

export const LEAGUES: LeagueDef[] = buildLeagues();

export function leagueById(id: string): LeagueDef {
  return LEAGUES.find((l) => l.id === id) ?? LEAGUES[0];
}

/** Swap the active team list everywhere (TEAMS is mutated in place). */
export function setActiveLeague(id: string): LeagueDef {
  const league = leagueById(id);
  setActiveLeagueTeams(league.teams);
  return league;
}

/** Master list of every nation in the game (the All Nations pool). */
export function allNations(): TeamData[] {
  return leagueById('all-nations').teams;
}

/**
 * Make the cup run with a custom set of team ids (the tournament editor's
 * result). Resolves the ids against the full nation pool and activates them as
 * the cup field, sorted by name so the team indices are stable across saves.
 */
export function setCupTeams(ids: string[]): void {
  const master = allNations();
  const teams = ids
    .map((id) => master.find((t) => t.id === id))
    .filter((t): t is TeamData => !!t)
    .sort((a, b) => a.name.localeCompare(b.name));
  setActiveLeagueTeams(teams);
}
