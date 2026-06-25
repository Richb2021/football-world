import type { TeamData } from '../sim/types';

/**
 * Teams are auto-discovered: drop a JSON file in src/data/teams/ and it is in
 * the game — no imports to edit. See docs/ADDING_TEAMS.md for the format
 * (including per-player appearance: skinTone, hairColor, hairStyle, facialHair).
 */
const files = import.meta.glob('./teams/*.json', { eager: true }) as Record<string, { default?: TeamData } & TeamData>;

export const TEAMS: TeamData[] = Object.values(files)
  .map((mod) => (mod.default ?? mod) as TeamData)
  .filter((team) => team && team.id && Array.isArray(team.players))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Swap the active league's teams. TEAMS is mutated in place so every module
 * that imported it sees the change (career, renderer, commentary, UI).
 */
export function setActiveLeagueTeams(teams: TeamData[]) {
  TEAMS.splice(0, TEAMS.length, ...teams);
}

export const teamById = (id: string): TeamData => {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown team ${id}`);
  return t;
};

/**
 * CLUB teams — the English pyramid (Top Division / Championship / League One /
 * League Two) plus any custom-nation clubs created in Customisation Mode. These
 * live in ./teams/clubs/ and are loaded SEPARATELY from the nation TEAMS pool so
 * the International Cup and Exhibition modes are completely unaffected by the
 * addition of club football.
 *
 * Like nations, clubs are auto-discovered: drop a TeamData JSON in
 * src/data/teams/clubs/ and it appears (see scripts/generate-clubs.mjs).
 */
const clubFiles = import.meta.glob('./teams/clubs/*.json', { eager: true }) as Record<string, { default?: TeamData } & TeamData>;

export const CLUBS: TeamData[] = Object.values(clubFiles)
  .map((mod) => (mod.default ?? mod) as TeamData)
  .filter((t) => t && t.id && Array.isArray(t.players))
  .sort((a, b) => a.name.localeCompare(b.name));

export const clubById = (id: string): TeamData => {
  const t = CLUBS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown club ${id}`);
  return t;
};

/**
 * CUSTOM teams — created at runtime in Customisation Mode and persisted to
 * localStorage so custom nations that reference them resolve at play time.
 * Looked up by anyTeamById (below) alongside nations and built-in clubs.
 */
const CUSTOM_KEY = 'fw.teams';
function loadCustomTeams(): TeamData[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
let CUSTOM_TEAMS: TeamData[] = loadCustomTeams();
function persistCustomTeams(): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(CUSTOM_TEAMS)); } catch { /* quota / private mode */ }
}

export const customTeams = (): TeamData[] => CUSTOM_TEAMS.slice();
export const customTeamById = (id: string): TeamData | undefined => CUSTOM_TEAMS.find((t) => t.id === id);

export function saveCustomTeam(team: TeamData): void {
  CUSTOM_TEAMS = CUSTOM_TEAMS.filter((t) => t.id !== team.id);
  CUSTOM_TEAMS.push(team);
  persistCustomTeams();
}
export function deleteCustomTeam(id: string): void {
  CUSTOM_TEAMS = CUSTOM_TEAMS.filter((t) => t.id !== id);
  persistCustomTeams();
}

/** Look a team up across the nation, club AND custom pools (used by custom nations). */
export const anyTeamById = (id: string): TeamData | undefined =>
  TEAMS.find((x) => x.id === id) ?? CLUBS.find((x) => x.id === id) ?? CUSTOM_TEAMS.find((x) => x.id === id);
