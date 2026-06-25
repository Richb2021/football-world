/**
 * Runtime squad + team generator for Customisation Mode (a compact mirror of the
 * build-time scripts/generate-clubs.mjs). Produces fictionalised PlayerAttrs squads
 * from namePool.en.json so created teams are immediately playable.
 */
import type { PlayerAttrs, TeamData, Pos, KitPattern, HairStyle, FacialHair } from '../../sim/types';
import { autoLineup } from '../../sim/formations';
import pool from '../namePool.en.json';

type Pool = { first: string[]; last: string[] };
const NAMES = pool as Pool;

function seedStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIN = ['#f3c9a8', '#e6b187', '#d09a6c', '#bf8154', '#a96a42', '#7a4a2b', '#5c3320', '#3f2417'];
const HAIR = ['#17110d', '#2b1a12', '#3a2a1a', '#5a4632', '#7a5230', '#8a6a3a', '#b58a3a'];
const STYLES: HairStyle[] = ['short', 'short', 'crop', 'curly', 'long', 'bald'];
const FACIAL: FacialHair[] = ['none', 'none', 'none', 'stubble', 'beard'];
const SQUAD = { GK: 3, DF: 8, MF: 7, FW: 5 };

function genAttrs(pos: Pos, strength: number, rnd: () => number) {
  const spread = () => (rnd() * 2 - 1) * 8;
  const around = (m: number) => Math.max(28, Math.min(99, Math.round(strength + m + spread())));
  if (pos === 'GK') return { pace: around(-22), pass: around(-18), shoot: around(-45), tackle: around(-40), keeping: around(6) };
  if (pos === 'DF') return { pace: around(-1), pass: around(-4), shoot: around(-22), tackle: around(6), keeping: 8 };
  if (pos === 'MF') return { pace: around(1), pass: around(6), shoot: around(-6), tackle: around(0), keeping: 7 };
  return { pace: around(4), pass: around(-2), shoot: around(8), tackle: around(-20), keeping: 8 };
}

function genName(rnd: () => number): string {
  return `${NAMES.first[Math.floor(rnd() * NAMES.first.length)]} ${NAMES.last[Math.floor(rnd() * NAMES.last.length)]}`;
}

export function generateSquad(strength: number, seed: string): PlayerAttrs[] {
  const rnd = mulberry32(seedStr('squad:' + seed));
  const players: PlayerAttrs[] = [];
  const taken = new Set<number>();
  let shirt = 1;
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as Pos[]) {
    for (let k = 0; k < SQUAD[pos]; k++) {
      const attrs = genAttrs(pos, strength, rnd);
      let n = pos === 'GK' ? (k === 0 ? 1 : k === 1 ? 13 : 12) : 2 + ((shirt++) % 30);
      while (taken.has(n)) n++;
      taken.add(n);
      players.push({
        name: genName(rnd), pos, age: 17 + Math.floor(rnd() * 20),
        ...attrs, shirtNumber: n,
        appearance: {
          skinTone: SKIN[Math.floor(rnd() * SKIN.length)],
          hairColor: HAIR[Math.floor(rnd() * HAIR.length)],
          hairStyle: STYLES[Math.floor(rnd() * STYLES.length)],
          facialHair: FACIAL[Math.floor(rnd() * FACIAL.length)],
        },
      });
    }
  }
  return players;
}

export interface GenerateTeamOpts {
  id: string;
  name: string;
  short: string;
  stadium: string;
  strength: number;
  primary: string;
  secondary: string;
  pattern: KitPattern;
}

export function generateTeam(opts: GenerateTeamOpts): TeamData {
  const players = generateSquad(opts.strength, opts.id);
  return {
    id: opts.id, name: opts.name, short: opts.short, stadium: opts.stadium, strength: opts.strength,
    colors: {
      home: { shirt: opts.primary, shorts: '#1a1a1a', socks: opts.primary, style: { pattern: opts.pattern, secondary: opts.secondary, trim: opts.secondary } },
      away: { shirt: '#f4f4f4', shorts: '#1a1a1a', socks: '#f4f4f4', style: { pattern: 'solid', secondary: '#888', trim: '#888' } },
    },
    players,
    defaultLineup: { formation: '4-2-3-1', starters: autoLineup(players, '4-2-3-1') },
  };
}

/** Slugify a free-text name into a stable, unique-enough team id (namespaced). */
export function customTeamId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
  return `custom-${base}`;
}
