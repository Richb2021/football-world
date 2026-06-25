#!/usr/bin/env node
/**
 * Grow every nation's squad from 18 to a full 23-man tournament party (3 GK,
 * 8 DF, 7 MF, 5 FW) by adding fictional reserve players. Deterministic per team
 * (seeded by team id) so re-runs are stable. Idempotent: only tops up to target,
 * never duplicates. Run: `node scripts/expand-squads.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const teamsDir = path.join(__dirname, '..', 'src', 'data', 'teams');
const pool = JSON.parse(fs.readFileSync(path.join(__dirname, 'name-pool.json'), 'utf8'));

const TARGET = { GK: 3, DF: 8, MF: 7, FW: 5 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function avg(players, pos, key) {
  const ps = players.filter((p) => p.pos === pos);
  if (!ps.length) return 60;
  return ps.reduce((s, p) => s + (p[key] ?? 0), 0) / ps.length;
}

function makeReserve(pos, team, rnd, existingNames) {
  // reserves sit a notch below the position's current average
  const base = (key, floor, ceil) => {
    const a = avg(team.players, pos, key);
    const v = Math.round(a - 4 - rnd() * 8 + rnd() * 4);
    return Math.max(floor, Math.min(ceil, v));
  };
  let name;
  for (let tries = 0; tries < 60; tries++) {
    const f = pool.first[Math.floor(rnd() * pool.first.length)];
    const l = pool.last[Math.floor(rnd() * pool.last.length)];
    name = `${f} ${l}`;
    if (!existingNames.has(name)) break;
  }
  existingNames.add(name);
  const player = {
    name,
    pos,
    age: 19 + Math.floor(rnd() * 16),
    pace: pos === 'GK' ? base('pace', 38, 62) : base('pace', 45, 92),
    pass: base('pass', 40, 88),
    shoot: pos === 'GK' ? 30 : base('shoot', 30, 86),
    tackle: pos === 'GK' ? 30 : base('tackle', 35, 86),
    keeping: pos === 'GK' ? base('keeping', 60, 82) : 8,
  };
  return player;
}

let changed = 0;
for (const file of fs.readdirSync(teamsDir).filter((f) => f.endsWith('.json'))) {
  const full = path.join(teamsDir, file);
  const team = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(team.players)) continue;
  const rnd = mulberry32(seedFromString(team.id || file));
  const existingNames = new Set(team.players.map((p) => p.name));
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of team.players) if (counts[p.pos] !== undefined) counts[p.pos]++;
  let added = 0;
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    while (counts[pos] < TARGET[pos]) {
      team.players.push(makeReserve(pos, team, rnd, existingNames));
      counts[pos]++;
      added++;
    }
  }
  if (added > 0) {
    fs.writeFileSync(full, JSON.stringify(team, null, 2) + '\n');
    changed++;
    console.log(`${team.name}: +${added} → ${team.players.length} players`);
  }
}
console.log(`Done. Updated ${changed} squads.`);
