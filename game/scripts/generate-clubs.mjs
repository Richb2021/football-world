#!/usr/bin/env node
/**
 * Football World — English club + squad generator.
 *
 * Generates 92 fictionalised club TeamData JSON files under src/data/teams/clubs/
 * (4 tiers × 20/24/24/24), each with a fully-fictionalised 23-man squad, plus a
 * src/data/english-pyramid.json describing the tier structure for leagues.ts /
 * nations.ts. Deterministic per club id (seeded RNG) so re-runs are stable.
 * Idempotent: overwrites cleanly each run.
 *
 * Run: node scripts/generate-clubs.mjs
 *
 * Naming rule: place names kept; distinctive suffixes replaced with fictional
 * colour / local-flavour words; real nicknames never used. Players are random
 * combinations from namePool.en.json — never specific real players.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clubsDir = path.join(__dirname, '..', 'src', 'data', 'teams', 'clubs');
const pool = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'namePool.en.json'), 'utf8'));
fs.mkdirSync(clubsDir, { recursive: true });

// ---- deterministic RNG (mulberry32) seeded from a string ----
function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- appearance palettes (render-only) ----
const SKIN = ['#f3c9a8', '#e6b187', '#d09a6c', '#bf8154', '#a96a42', '#7a4a2b', '#5c3320', '#3f2417'];
const HAIR_DARK = ['#17110d', '#2b1a12', '#3a2a1a'];
const HAIR_MID = ['#5a4632', '#6b4a2a', '#7a5230'];
const HAIR_LIGHT = ['#8a6a3a', '#a07a3a', '#b58a3a', '#caa83a'];
const HAIR_RED = ['#8a3a1a', '#a04020', '#b5502a'];
const STYLES = ['short', 'short', 'short', 'crop', 'crop', 'curly', 'curly', 'long', 'bald'];
const FACIAL = ['none', 'none', 'none', 'none', 'stubble', 'stubble', 'beard', 'moustache'];

const SQUAD = { GK: 3, DF: 8, MF: 7, FW: 5 }; // 23, matches nation squads

/**
 * Roster: [id, name, short, tier, strength, primaryHex, secondaryHex, pattern]
 * tier 1=Top Division, 2=Championship, 3=League One, 4=League Two
 */
const ROSTER = [
  // ---- Top Division ----
  ['highbury-reds', 'Highbury Reds', 'HBR', 1, 88, '#EF0107', '#FFFFFF', 'solid'],
  ['aston-claret', 'Aston Claret', 'AST', 1, 84, '#7A0E2A', '#95BFE5', 'sleeves'],
  ['bournemouth', 'Bournemouth', 'BMC', 1, 76, '#DA291C', '#111111', 'stripes'],
  ['brentford', 'Brentford', 'BRE', 1, 76, '#E30613', '#FFFFFF', 'stripes'],
  ['brighton', 'Brighton', 'BGT', 1, 76, '#0057B8', '#FFFFFF', 'solid'],
  ['burnley', 'Burnley', 'BUR', 1, 74, '#6C1D45', '#80B0E0', 'halves'],
  ['chelsea', 'Chelsea', 'CHE', 1, 86, '#034694', '#FFFFFF', 'solid'],
  ['selhurst', 'Selhurst', 'SEL', 1, 77, '#C4122E', '#1B458F', 'sash'],
  ['everton', 'Everton', 'EVE', 1, 80, '#003399', '#FFFFFF', 'solid'],
  ['fulham', 'Fulham', 'FUL', 1, 78, '#FFFFFF', '#111111', 'solid'],
  ['leeds-whites', 'Leeds Whites', 'LDS', 1, 80, '#FFFFFF', '#1D428A', 'solid'],
  ['liverpool-reds', 'Liverpool Reds', 'LIV', 1, 88, '#C8102E', '#FFFFFF', 'solid'],
  ['manchester-sky', 'Manchester Sky', 'MSK', 1, 87, '#6CABDD', '#FFFFFF', 'solid'],
  ['manchester-reds', 'Manchester Reds', 'MRE', 1, 87, '#DA291C', '#FFFFFF', 'solid'],
  ['newcastle', 'Newcastle', 'NEW', 1, 84, '#111111', '#FFFFFF', 'stripes'],
  ['nottingham-reds', 'Nottingham Reds', 'NFR', 1, 80, '#DD0000', '#FFFFFF', 'solid'],
  ['sunderland', 'Sunderland', 'SUN', 1, 76, '#EB172B', '#FFFFFF', 'stripes'],
  ['tottenham', 'Tottenham', 'TOT', 1, 84, '#FFFFFF', '#132257', 'solid'],
  ['west-ham', 'West Ham', 'WHM', 1, 80, '#7A263A', '#1BB1E7', 'sleeves'],
  ['wolverhampton', 'Wolverhampton', 'WLV', 1, 80, '#FDB913', '#111111', 'solid'],
  // ---- Championship ----
  ['birmingham-blues', 'Birmingham Blues', 'BIR', 2, 76, '#0000C0', '#FFFFFF', 'solid'],
  ['blackburn-blues', 'Blackburn Blues', 'BLB', 2, 73, '#009EE0', '#FFFFFF', 'halves'],
  ['bristol-reds', 'Bristol Reds', 'BRC', 2, 72, '#E21C38', '#FFFFFF', 'solid'],
  ['charlton-reds', 'Charlton Reds', 'CHL', 2, 70, '#E4002B', '#FFFFFF', 'solid'],
  ['coventry-sky', 'Coventry Sky', 'COV', 2, 73, '#87B1E0', '#111111', 'solid'],
  ['derby-whites', 'Derby Whites', 'DER', 2, 71, '#FFFFFF', '#111111', 'solid'],
  ['hull-amber', 'Hull Amber', 'HUL', 2, 71, '#F18A01', '#111111', 'solid'],
  ['ipswich-blues', 'Ipswich Blues', 'IPS', 2, 74, '#3870C0', '#FFFFFF', 'solid'],
  ['leicester-blues', 'Leicester Blues', 'LEI', 2, 77, '#003090', '#FDB913', 'solid'],
  ['middlesbrough', 'Middlesbrough', 'MID', 2, 73, '#E11B22', '#FFFFFF', 'solid'],
  ['millwall', 'Millwall', 'MIL', 2, 70, '#001E62', '#FFFFFF', 'solid'],
  ['norwich-yellows', 'Norwich Yellows', 'NOR', 2, 72, '#FFF200', '#00A650', 'halves'],
  ['oxford-yellows', 'Oxford Yellows', 'OXF', 2, 69, '#FFD700', '#0033A0', 'solid'],
  ['portsmouth', 'Portsmouth', 'POR', 2, 72, '#002F6C', '#FFFFFF', 'solid'],
  ['preston-whites', 'Preston Whites', 'PRE', 2, 70, '#FFFFFF', '#1B2A4A', 'solid'],
  ['white-city-blues', 'White City Blues', 'WCB', 2, 70, '#0057B8', '#FFFFFF', 'hoops'],
  ['sheffield-reds', 'Sheffield Reds', 'SHU', 2, 74, '#EE2737', '#FFFFFF', 'stripes'],
  ['sheffield-blues', 'Sheffield Blues', 'SHW', 2, 73, '#0066B3', '#FFFFFF', 'stripes'],
  ['southampton', 'Southampton', 'SOU', 2, 73, '#D71920', '#FFFFFF', 'stripes'],
  ['stoke-reds', 'Stoke Reds', 'STO', 2, 71, '#E03A3E', '#FFFFFF', 'stripes'],
  ['swansea-whites', 'Swansea Whites', 'SWA', 2, 70, '#FFFFFF', '#111111', 'solid'],
  ['watford', 'Watford', 'WAT', 2, 71, '#FBEE23', '#ED2127', 'halves'],
  ['west-brom-stripes', 'West Brom Stripes', 'WBA', 2, 72, '#122F67', '#FFFFFF', 'stripes'],
  ['wrexham', 'Wrexham', 'WRX', 2, 72, '#DA291C', '#FFFFFF', 'solid'],
  // ---- League One ----
  ['wimbledon', 'Wimbledon', 'WIM', 3, 65, '#0000A0', '#FFD700', 'solid'],
  ['barnsley', 'Barnsley', 'BAR', 3, 64, '#D40000', '#FFFFFF', 'solid'],
  ['blackpool', 'Blackpool', 'BLA', 3, 65, '#FF5F00', '#FFFFFF', 'solid'],
  ['bolton-whites', 'Bolton Whites', 'BOL', 3, 66, '#FFFFFF', '#002060', 'solid'],
  ['bradford-amber', 'Bradford Amber', 'BRD', 3, 62, '#F18A00', '#6C1D45', 'stripes'],
  ['burton-yellows', 'Burton Yellows', 'BTN', 3, 60, '#FFD200', '#111111', 'solid'],
  ['cardiff-blues', 'Cardiff Blues', 'CAR', 3, 67, '#0070B5', '#FFFFFF', 'solid'],
  ['doncaster-reds', 'Doncaster Reds', 'DON', 3, 61, '#E2001A', '#FFFFFF', 'solid'],
  ['exeter-reds', 'Exeter Reds', 'EXE', 3, 61, '#E4002B', '#FFFFFF', 'stripes'],
  ['huddersfield-blues', 'Huddersfield Blues', 'HUD', 3, 63, '#1B67B3', '#FFFFFF', 'stripes'],
  ['leyton', 'Leyton', 'LEY', 3, 60, '#E4002B', '#FFFFFF', 'solid'],
  ['lincoln-reds', 'Lincoln Reds', 'LIN', 3, 62, '#E4002B', '#FFFFFF', 'stripes'],
  ['luton-amber', 'Luton Amber', 'LUT', 3, 64, '#F78F1E', '#0033A0', 'solid'],
  ['mansfield-amber', 'Mansfield Amber', 'MFD', 3, 61, '#FFC20E', '#0033A0', 'halves'],
  ['northampton-claret', 'Northampton Claret', 'NPT', 3, 60, '#6C1D45', '#FFFFFF', 'solid'],
  ['peterborough-blues', 'Peterborough Blues', 'PET', 3, 63, '#00A1DE', '#FFFFFF', 'solid'],
  ['plymouth-greens', 'Plymouth Greens', 'PLY', 3, 64, '#005C2E', '#FFFFFF', 'solid'],
  ['burslem', 'Burslem', 'BSL', 3, 62, '#FFFFFF', '#E4002B', 'halves'],
  ['reading', 'Reading', 'REA', 3, 64, '#004B98', '#FFFFFF', 'hoops'],
  ['rotherham-reds', 'Rotherham Reds', 'ROT', 3, 60, '#E4002B', '#FFFFFF', 'solid'],
  ['stevenage', 'Stevenage', 'STV', 3, 62, '#E4002B', '#FFFFFF', 'solid'],
  ['stockport-blues', 'Stockport Blues', 'STK', 3, 65, '#0033A0', '#FFFFFF', 'solid'],
  ['wigan-blues', 'Wigan Blues', 'WIG', 3, 63, '#0033A0', '#FFFFFF', 'solid'],
  ['wycombe-blues', 'Wycombe Blues', 'WYC', 3, 63, '#2020A0', '#FFFFFF', 'hoops'],
  // ---- League Two ----
  ['accrington-reds', 'Accrington Reds', 'ACC', 4, 56, '#E4002B', '#111111', 'solid'],
  ['barnet', 'Barnet', 'BNT', 4, 55, '#6C1D45', '#FFD700', 'halves'],
  ['barrow', 'Barrow', 'BRW', 4, 56, '#0033A0', '#FFFFFF', 'solid'],
  ['bristol-blues', 'Bristol Blues', 'BRB', 4, 58, '#0033A0', '#FFFFFF', 'solid'],
  ['bromley', 'Bromley', 'BRO', 4, 55, '#E4002B', '#FFFFFF', 'solid'],
  ['cambridge-amber', 'Cambridge Amber', 'CAM', 4, 57, '#FFCC00', '#111111', 'solid'],
  ['cheltenham-reds', 'Cheltenham Reds', 'CHM', 4, 56, '#E4002B', '#FFFFFF', 'stripes'],
  ['chesterfield', 'Chesterfield', 'CFD', 4, 58, '#0033A0', '#FFFFFF', 'solid'],
  ['colchester-blues', 'Colchester Blues', 'COL', 4, 55, '#0033A0', '#E4002B', 'stripes'],
  ['crawley-reds', 'Crawley Reds', 'CRA', 4, 56, '#E4002B', '#111111', 'solid'],
  ['crewe-reds', 'Crewe Reds', 'CRW', 4, 56, '#E4002B', '#FFFFFF', 'solid'],
  ['fleetwood-reds', 'Fleetwood Reds', 'FLW', 4, 57, '#E4002B', '#FFFFFF', 'solid'],
  ['gillingham', 'Gillingham', 'GIL', 4, 55, '#0033A0', '#FFFFFF', 'solid'],
  ['grimsby', 'Grimsby', 'GRI', 4, 56, '#111111', '#FFFFFF', 'stripes'],
  ['harrogate-amber', 'Harrogate Amber', 'HAR', 4, 54, '#FFD200', '#111111', 'solid'],
  ['milton-keynes', 'Milton Keynes', 'MKY', 4, 57, '#E4002B', '#FFFFFF', 'solid'],
  ['newport-amber', 'Newport Amber', 'NWP', 4, 55, '#FFA500', '#111111', 'solid'],
  ['nottingham-blacks', 'Nottingham Blacks', 'NCB', 4, 58, '#111111', '#FFFFFF', 'stripes'],
  ['oldham-blues', 'Oldham Blues', 'OLD', 4, 55, '#0033A0', '#FFFFFF', 'solid'],
  ['salford', 'Salford', 'SAL', 4, 57, '#E4002B', '#FFFFFF', 'solid'],
  ['shrewsbury-amber', 'Shrewsbury Amber', 'SHR', 4, 56, '#FFB300', '#0033A0', 'stripes'],
  ['swindon-reds', 'Swindon Reds', 'SWI', 4, 57, '#E4002B', '#FFFFFF', 'solid'],
  ['tranmere', 'Tranmere', 'TRA', 4, 56, '#FFFFFF', '#0033A0', 'hoops'],
  ['walsall', 'Walsall', 'WAL', 4, 56, '#E4002B', '#FFFFFF', 'solid'],
];

const TIER_LEAGUE = { 1: 'eng-top-division', 2: 'eng-championship', 3: 'eng-league-one', 4: 'eng-league-two' };
const TIER_NAME = { 1: 'Top Division', 2: 'Championship', 3: 'League One', 4: 'League Two' };

const POS_LIST = ['GK', 'DF', 'MF', 'FW'];
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

/** position-weighted attribute generation centred on club strength */
function genAttrs(pos, strength, rnd) {
  const spread = () => (rnd() * 2 - 1) * 8; // -8..+8
  const around = (m) => clamp(strength + m + spread(), 28, 99);
  if (pos === 'GK') {
    return { pace: around(-22), pass: around(-18), shoot: around(-45), tackle: around(-40), keeping: around(6) };
  }
  if (pos === 'DF') {
    return { pace: around(-1), pass: around(-4), shoot: around(-22), tackle: around(6), keeping: 8 };
  }
  if (pos === 'MF') {
    return { pace: around(1), pass: around(6), shoot: around(-6), tackle: around(0), keeping: 7 };
  }
  // FW
  return { pace: around(4), pass: around(-2), shoot: around(8), tackle: around(-20), keeping: 8 };
}

function genAppearance(rnd) {
  const skin = SKIN[Math.floor(rnd() * SKIN.length)];
  // hair colour loosely correlated to skin tone for plausibility
  const roll = rnd();
  let hairPool;
  if (roll < 0.1) hairPool = HAIR_RED;
  else if (roll < 0.35) hairPool = HAIR_LIGHT;
  else if (roll < 0.55) hairPool = HAIR_MID;
  else hairPool = HAIR_DARK;
  const hair = hairPool[Math.floor(rnd() * hairPool.length)];
  return {
    skinTone: skin,
    hairColor: hair,
    hairStyle: STYLES[Math.floor(rnd() * STYLES.length)],
    facialHair: FACIAL[Math.floor(rnd() * FACIAL.length)],
    bootColor: rnd() < 0.5 ? '#111111' : (rnd() < 0.5 ? '#ff5a3c' : '#3aa0ff'),
  };
}

function genName(rnd, used) {
  let name;
  for (let i = 0; i < 80; i++) {
    name = `${pool.first[Math.floor(rnd() * pool.first.length)]} ${pool.last[Math.floor(rnd() * pool.last.length)]}`;
    if (!used.has(name)) break;
  }
  used.add(name);
  return name;
}

/** build a 4-2-3-1 default lineup from the best player at each needed slot */
function buildLineup(players) {
  const idxByPos = (pos) => players
    .map((p, i) => ({ i, ovr: ovr(p) }))
    .filter((x) => players[x.i].pos === pos)
    .sort((a, b) => b.ovr - a.ovr);
  const take = (list, n) => list.splice(0, n).map((x) => x.i);
  const gk = idxByPos('GK');
  const df = idxByPos('DF');
  const mf = idxByPos('MF');
  const fw = idxByPos('FW');
  const starters = [
    ...take(gk, 1),
    ...take(df, 4),
    ...take(mf, 5), // 4-2-3-1 = 5 midfield
    ...take(fw, 1),
  ];
  return { formation: '4-2-3-1', starters };
}

function ovr(p) {
  // lightweight overall for lineup selection only
  if (p.pos === 'GK') return p.keeping;
  const w = p.pos === 'DF' ? [0.2, 0.2, 0.1, 0.4, 0]
    : p.pos === 'MF' ? [0.2, 0.35, 0.2, 0.2, 0]
      : [0.3, 0.15, 0.45, 0.1, 0];
  return w[0] * p.pace + w[1] * p.pass + w[2] * p.shoot + w[3] * p.tackle + w[4] * p.keeping;
}

function isLight(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}
function darken(hex, amt = 0.55) {
  const c = hex.replace('#', '');
  const r = Math.round(parseInt(c.slice(0, 2), 16) * amt);
  const g = Math.round(parseInt(c.slice(2, 4), 16) * amt);
  const b = Math.round(parseInt(c.slice(4, 6), 16) * amt);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const STADIUM_SUF = ['Park', 'Stadium', 'Ground', 'Arena'];
function genStadium(name, rnd) {
  const root = name.split(' ')[0];
  return `${root} ${STADIUM_SUF[Math.floor(rnd() * STADIUM_SUF.length)]}`;
}

// ---- generate ----
const pyramid = { nation: 'england', name: 'England', tiers: [], promotion: 3, relegation: 3, playoffs: true };
const byTier = { 1: [], 2: [], 3: [], 4: [] };

let written = 0;
for (const [id, name, short, tier, strength, primary, secondary, pattern] of ROSTER) {
  const rnd = mulberry32(seedFromString('club:' + id));
  const used = new Set();
  const players = [];
  let shirt = 1;
  const shirtTaken = new Set();
  const assignShirt = (preferred) => {
    let n = preferred;
    while (shirtTaken.has(n)) n++;
    shirtTaken.add(n);
    return n;
  };
  for (const pos of POS_LIST) {
    const count = SQUAD[pos];
    for (let k = 0; k < count; k++) {
      const attrs = genAttrs(pos, strength, rnd);
      const age = 17 + Math.floor(rnd() * 20); // 17-36
      // starting GK gets 1, then sensible numbers
      let preferred;
      if (pos === 'GK') preferred = k === 0 ? 1 : (k === 1 ? 13 : 12);
      else preferred = 2 + ((shirt++) % 30);
      players.push({
        name: genName(rnd, used),
        pos,
        age,
        ...attrs,
        shirtNumber: assignShirt(preferred),
        appearance: genAppearance(rnd),
      });
    }
  }
  // ensure unique-ish shirt numbers 1..30
  const team = {
    id,
    name,
    short,
    stadium: genStadium(name, rnd),
    strength,
    colors: {
      home: { shirt: primary, shorts: isLight(primary) ? darken(secondary, 0.8) : darken(primary, 0.5), socks: primary, style: { pattern, secondary, trim: secondary } },
      away: { shirt: isLight(primary) ? '#14213d' : '#f4f4f4', shorts: '#1a1a1a', socks: isLight(primary) ? '#14213d' : '#f4f4f4', style: { pattern: 'solid', secondary: '#888', trim: '#888' } },
    },
    players,
    defaultLineup: buildLineup(players),
  };
  fs.writeFileSync(path.join(clubsDir, `${id}.json`), JSON.stringify(team, null, 2) + '\n');
  byTier[tier].push(id);
  written++;
}

for (const t of [1, 2, 3, 4]) {
  pyramid.tiers.push({ tier: t, leagueId: TIER_LEAGUE[t], name: TIER_NAME[t], teamIds: byTier[t] });
}
fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'english-pyramid.json'), JSON.stringify(pyramid, null, 2) + '\n');

console.log(`Football World: generated ${written} clubs across 4 tiers.`);
console.log(`  Tier 1 (Top Division): ${byTier[1].length}`);
console.log(`  Tier 2 (Championship): ${byTier[2].length}`);
console.log(`  Tier 3 (League One): ${byTier[3].length}`);
console.log(`  Tier 4 (League Two): ${byTier[4].length}`);
console.log(`Wrote src/data/english-pyramid.json`);
