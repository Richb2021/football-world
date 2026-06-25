/** Fictional name generation for managers, NPCs and event characters. Seeded
 * so a given seed always yields the same name (stable contacts). */
import pool from './namePool.json';

function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function fakeName(seed: string): string {
  const h = hash(seed);
  const f = pool.first[h % pool.first.length];
  const l = pool.last[(h >>> 8) % pool.last.length];
  return `${f} ${l}`;
}

const MANAGER_TITLES = ['', '', '', 'Sir '];
/** A plausible manager name for a nation (stable per team id). */
export function fakeManagerName(teamId: string): string {
  const h = hash(`mgr:${teamId}`);
  const title = MANAGER_TITLES[h % MANAGER_TITLES.length];
  return `${title}${fakeName(`mgr:${teamId}`)}`;
}
