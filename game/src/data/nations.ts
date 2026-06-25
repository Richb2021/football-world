/**
 * Football World — NATIONS.
 *
 * A Nation is a playable footballing world: an ordered set of league TIERS with
 * promotion/relegation rules between them (a "pyramid"), or a single flat pool
 * (the World / International Cup). Nations are the unit the Manager and Player
 * Career modes operate on, and the unit Customisation Mode creates, edits,
 * exports and imports.
 *
 * Built-in nations:
 *   - `world`    the International Cup field (48 qualifying nations, single tier)
 *   - `england`  the English pyramid: Top Division / Championship / League One /
 *                League Two, 3-up-3-down with playoffs (src/data/english-pyramid.json)
 *
 * Custom nations are stored in localStorage (`fw.nations`) so they survive reloads
 * and can be shared via export/import (a JSON string). Pure data — no DOM.
 */
import type { TeamData } from '../sim/types';
import { anyTeamById } from './teams';
import { WC_TEAM_IDS } from './worldCup';
import pyramidJson from './english-pyramid.json';

type PyramidTier = { tier: number; leagueId: string; name: string; teamIds: string[] };
type PyramidShape = {
  nation: string;
  name: string;
  tiers: PyramidTier[];
  promotion: number;
  relegation: number;
  playoffs: boolean;
};

export interface NationTier {
  tier: number;
  leagueId: string;
  name: string;
  teamIds: string[];
}

export type CupFormat = 'knockout' | 'groups-then-knockout';

export interface CupDef {
  id: string;
  name: string;
  format: CupFormat;
  /** how entrants are drawn from the nation */
  entries: 'top-two-tiers' | 'top-tier' | 'whole-nation' | 'top-n';
  /** when entries === 'top-n', how many teams */
  topN?: number;
}

export type NationType = 'pyramid' | 'single';

export interface NationDef {
  id: string;
  name: string;
  type: NationType;
  /** pyramid nations only: tiers ordered top (1) → bottom */
  tiers?: NationTier[];
  promotion?: number;
  relegation?: number;
  playoffs?: boolean;
  /** single-tier nations only: the flat pool of team ids */
  teamPool?: string[];
  cups?: CupDef[];
  /** user-created in Customisation Mode */
  custom?: boolean;
  builtIn?: boolean;
}

const STORAGE_KEY = 'fw.nations';

const PYRAMID = pyramidJson as PyramidShape;

/** Built-in England nation — the generated 4-tier English pyramid. */
export const ENGLAND_NATION: NationDef = {
  id: 'england',
  name: 'England',
  type: 'pyramid',
  tiers: PYRAMID.tiers.map((t) => ({ tier: t.tier, leagueId: t.leagueId, name: t.name, teamIds: [...t.teamIds] })),
  promotion: PYRAMID.promotion,
  relegation: PYRAMID.relegation,
  playoffs: PYRAMID.playoffs,
  cups: [
    { id: 'eng-fa-cup', name: 'National Cup', format: 'knockout', entries: 'whole-nation' },
    { id: 'eng-league-cup', name: 'League Cup', format: 'knockout', entries: 'top-two-tiers' },
  ],
  builtIn: true,
};

/** Built-in World nation — the International Cup field (single tier of 48). */
export const WORLD_NATION: NationDef = {
  id: 'world',
  name: 'World',
  type: 'single',
  teamPool: WC_TEAM_IDS.slice(),
  cups: [{ id: 'world-cup', name: 'International Cup', format: 'groups-then-knockout', entries: 'whole-nation' }],
  builtIn: true,
};

export const BUILTIN_NATIONS: NationDef[] = [ENGLAND_NATION, WORLD_NATION];

// ---- custom nation persistence ----
function readCustom(): NationDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeCustom(list: NationDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage may be unavailable (private mode) — custom nations just won't persist */
  }
}

/** Every nation available to play: built-ins first, then user customs. */
export function allNations(): NationDef[] {
  return [...BUILTIN_NATIONS, ...readCustom()];
}

export function nationById(id: string): NationDef | undefined {
  return allNations().find((n) => n.id === id);
}

export function isBuiltInNation(id: string): boolean {
  return BUILTIN_NATIONS.some((n) => n.id === id);
}

/** Add or replace a custom nation. Returns the stored nation. */
export function saveCustomNation(nation: NationDef): NationDef {
  const stored: NationDef = { ...nation, custom: true, builtIn: false };
  const list = readCustom().filter((n) => n.id !== stored.id);
  list.push(stored);
  writeCustom(list);
  return stored;
}

export function deleteCustomNation(id: string): void {
  writeCustom(readCustom().filter((n) => n.id !== id));
}

/** Serialise a nation to a shareable JSON string (for export / share). */
export function exportNationJSON(id: string): string {
  const n = nationById(id);
  if (!n) throw new Error(`unknown nation ${id}`);
  return JSON.stringify(n, null, 2);
}

/** Import a nation from an exported JSON string. Validates shape minimally. */
export function importNationJSON(json: string): NationDef {
  const parsed = JSON.parse(json) as Partial<NationDef>;
  if (!parsed || typeof parsed.id !== 'string' || typeof parsed.name !== 'string' || (parsed.type !== 'pyramid' && parsed.type !== 'single')) {
    throw new Error('Not a valid Football World nation file.');
  }
  return saveCustomNation(parsed as NationDef);
}

// ---- resolution helpers ----

/** Resolve a nation's tiers (pyramid) as a single-element list for single-tier. */
export function tiersOf(nation: NationDef): NationTier[] {
  if (nation.type === 'pyramid') return nation.tiers ?? [];
  return [{ tier: 1, leagueId: `${nation.id}-league`, name: nation.name, teamIds: nation.teamPool ?? [] }];
}

/** Every team id referenced by a nation (all tiers / the pool). */
export function teamIdsOf(nation: NationDef): string[] {
  return tiersOf(nation).flatMap((t) => t.teamIds);
}

/** Every resolved TeamData a nation references (skips any missing ids). */
export function teamsOf(nation: NationDef): TeamData[] {
  return teamIdsOf(nation)
    .map((id) => anyTeamById(id))
    .filter((t): t is TeamData => !!t);
}

/** The top tier of a nation (where a new player/manager typically starts high or low). */
export function topTierOf(nation: NationDef): NationTier | undefined {
  const tiers = tiersOf(nation);
  return tiers.length ? tiers.reduce((top, t) => (t.tier < top.tier ? t : top)) : undefined;
}

export function bottomTierOf(nation: NationDef): NationTier | undefined {
  const tiers = tiersOf(nation);
  return tiers.length ? tiers.reduce((bot, t) => (t.tier > bot.tier ? t : bot)) : undefined;
}
