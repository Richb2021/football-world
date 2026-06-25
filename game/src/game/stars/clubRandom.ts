// Random club name + kit-colour generators for the All Star Club customisation
// screen, plus the coin costs for changing them. Kept tiny and dependency-free so
// the UI can roll a fresh club identity locally.
import type { KitColors } from '../../sim/types';

/** Coins charged when the player changes the club name / kit. */
export const CLUB_RENAME_COST = 1000;
export const CLUB_KIT_COST = 1000;

const PREFIXES = ['', '', '', '', 'Real ', 'Inter ', 'Royal ', 'AC ', 'FC '];
const PLACES = [
  'Ashford', 'Brightwood', 'Carrow', 'Dunmore', 'Eastgate', 'Fenwick', 'Greyport',
  'Hartley', 'Ironbridge', 'Kingsmere', 'Larkfield', 'Marsden', 'Northcliff',
  'Oakvale', 'Pemberton', 'Redhill', 'Stonebridge', 'Thornbury', 'Westmoor',
  'Ravenhill', 'Blackmoor', 'Crossfield', 'Sefton', 'Marlow', 'Hawkridge',
];
const SUFFIXES = [
  'FC', 'United', 'City', 'Athletic', 'Rovers', 'Wanderers', 'Town', 'Albion',
  'County', 'Hotspur', 'Dynamo', 'Sporting', 'Forest', 'Stars',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A fictional club name, e.g. "Real Oakvale", "Stonebridge Rovers". Capped at 24 chars. */
export function randomClubName(): string {
  const prefix = pick(PREFIXES);
  // A bare prefix like "FC " reads best as a leading tag with just the place.
  const body = prefix && /[A-Z]{2}/.test(prefix.trim())
    ? `${prefix}${pick(PLACES)}`
    : `${prefix}${pick(PLACES)} ${pick(SUFFIXES)}`;
  return body.trim().slice(0, 24);
}

// Curated vivid shirt colours + neutral shorts so a random strip always reads like
// a real kit rather than three clashing values.
const SHIRTS = [
  '#e6231f', '#1f4fe0', '#0a8f3c', '#ffd400', '#ff6a00', '#7b1fa2', '#00897b',
  '#c2185b', '#1565c0', '#2e7d32', '#d32f2f', '#37474f', '#f50057', '#00bcd4',
  '#3949ab', '#43a047',
];
const SHORTS = ['#ffffff', '#0b1430', '#111111', '#1a1a2e', '#f5f5f5'];

/** A random but tidy home kit (shirt / shorts / socks). */
export function randomKit(): KitColors {
  const shirt = pick(SHIRTS);
  const shorts = pick(SHORTS);
  const socks = Math.random() < 0.5 ? shirt : pick(SHORTS);
  return { shirt, shorts, socks };
}
