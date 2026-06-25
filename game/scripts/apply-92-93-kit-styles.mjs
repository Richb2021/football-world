// Stamp authentic 1992/93 kit patterns into the team data files.
// Home kits get their era pattern; away kits default to solid unless noted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/teams');

const HOME_STYLES = {
  arsenal: { pattern: 'sleeves', secondary: '#FFFFFF' }, // red body, white sleeves
  'aston-villa': { pattern: 'sleeves', secondary: '#8BB8E8' }, // claret, sky sleeves
  blackburn: { pattern: 'halves', secondary: '#FFFFFF' }, // blue/white halves
  chelsea: { pattern: 'solid' },
  coventry: { pattern: 'solid' },
  'crystal-palace': { pattern: 'stripes', secondary: '#1B458F' }, // red/blue stripes
  everton: { pattern: 'solid' },
  ipswich: { pattern: 'solid' },
  leeds: { pattern: 'solid' },
  liverpool: { pattern: 'solid' },
  'man-city': { pattern: 'solid' },
  'man-united': { pattern: 'solid' },
  middlesbrough: { pattern: 'solid' },
  norwich: { pattern: 'sleeves', secondary: '#00843D' }, // yellow, green sleeves
  forest: { pattern: 'solid' },
  oldham: { pattern: 'solid' },
  qpr: { pattern: 'hoops', secondary: '#FFFFFF' }, // blue & white hoops
  'sheff-united': { pattern: 'stripes', secondary: '#FFFFFF' }, // red/white stripes
  'sheff-wednesday': { pattern: 'stripes', secondary: '#FFFFFF' }, // blue/white stripes
  southampton: { pattern: 'stripes', secondary: '#FFFFFF' }, // red/white stripes
  tottenham: { pattern: 'solid' },
  wimbledon: { pattern: 'solid' },
};

// notable away kits of the season; everything else stays solid
const AWAY_STYLES = {
  'man-united': { pattern: 'halves', secondary: '#F9C909' }, // green & gold Newton Heath
  arsenal: { pattern: 'solid' },
};

let changed = 0;
for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith('.json')) continue;
  const p = path.join(DIR, file);
  const team = JSON.parse(fs.readFileSync(p, 'utf8'));
  const home = HOME_STYLES[team.id] ?? { pattern: 'solid' };
  const away = AWAY_STYLES[team.id] ?? { pattern: 'solid' };
  team.colors.home.style = { ...(team.colors.home.style ?? {}), ...home };
  team.colors.away.style = { ...(team.colors.away.style ?? {}), ...away };
  // green & gold halves need a green base shirt to read correctly
  if (team.id === 'man-united') {
    const awayShirt = String(team.colors.away.shirt).toLowerCase();
    const looksGreen = /^#[0-3][0-9a-f][6-9a-f]/.test(awayShirt) === false;
    if (looksGreen && !/^#0/.test(awayShirt)) {
      team.colors.away.shirt = '#0E7A3C';
      team.colors.away.shorts = '#FFFFFF';
      team.colors.away.socks = '#0E7A3C';
    }
  }
  fs.writeFileSync(p, JSON.stringify(team, null, 2) + '\n');
  changed++;
  console.log(`${team.id}: home=${team.colors.home.style.pattern} away=${team.colors.away.style.pattern}`);
}
console.log(`updated ${changed} teams`);
