#!/usr/bin/env node
// Validates commentary addition files against the rules:
// 1. Valid JSON arrays; required fields; context only on goal phrases with allowed values.
// 2. No id collisions (vs catalog and between files); id format phrase.<speaker>.<path>.<NN>.
// 3. No digits / banned words in text; name-fragments must not end with a full stop.
// 4. Categories restricted to the allowed set.
import fs from 'node:fs';

const DIR = '/Users/richardbatt/Projects/Gametest/game/src/data';
const catalog = JSON.parse(fs.readFileSync(`${DIR}/commentaryCatalog.json`, 'utf8'));
const files = {
  commentator: JSON.parse(fs.readFileSync(`${DIR}/commentary-additions-commentator.json`, 'utf8')),
  pundit: JSON.parse(fs.readFileSync(`${DIR}/commentary-additions-pundit.json`, 'utf8')),
};

const ALLOWED_CATEGORIES = new Set(['goal','pass','shot','save','nearMiss','post','attack','possession','corner','throwIn','goalKick','freeKick','penalty','foul','yellowCard','redCard','offside','kickoff','halfTime','fullTime','prematch','analysis','dialogue']);
const ALLOWED_INTENSITY = new Set(['calm','excited','big']);
const ALLOWED_CONTEXT = new Set(['equalizer','lead','extend','late','early','consolation']);
const REQUIRED = ['id','speaker','category','intensity','text','previousText','nextText'];
const ALLOWED_KEYS = new Set([...REQUIRED, 'context']);

const BANNED_PATTERNS = [
  [/[0-9]/, 'digit'],
  [/press conference/i, '"press conference"'],
  // Real names / teams / places / competitions / trademarks commonly seen in football text
  [/\b(United|City FC|Arsenal|Liverpool|Everton|Chelsea|Tottenham|Spurs|Rangers|Celtic|Leeds|Wednesday|Villa|Forest|Albion|Rovers FC)\b/, 'team name'],
  [/\b(London|Manchester|Glasgow|Birmingham|Newcastle upon|Wembley|Anfield|Old Trafford|Highbury|Maine Road|Elland Road|Goodison|Hillsborough|Ibrox|Villa Park)\b/i, 'city/stadium'],
  [/\b(Premier League|First Division|FA Cup|League Cup|UEFA|FIFA|Champions League|European Cup|World Cup|Football League)\b/i, 'competition name'],
  [/\b(Shearer|Gascoigne|Lineker|Cantona|Giggs|Wright|Motson|Davies|Hansen|Brooking)\b/, 'real person'],
  [/\b(Adidas|Nike|Umbro|Mitre|Sky Sports|Match of the Day|BBC|ITV)\b/i, 'trademark'],
];

const catalogIds = new Set(catalog.phrases.map((p) => p.id));
const seenIds = new Map(); // id -> file
const idRe = /^phrase\.(commentator|pundit)\.[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*\.\d{2}$/;

// A fragment is a phrase whose spoken text is completed by a name (nextText begins
// lowercase / text ends mid-clause). Heuristic: text does not end with terminal punctuation
// AND does not start a complete sentence on its own. We flag: text ending in '.' that is
// clearly a lead-in to a name (ends with a preposition/conjunction before the stop).
const FRAGMENT_TAIL = /\b(to|for|by|from|of|with|against|into|toward|towards|but|goes|is|it's|and it's|belongs to|comes|all|here for|stands at|makes it)\s*\.$/i;

let errors = [];
for (const [name, arr] of Object.entries(files)) {
  if (!Array.isArray(arr)) { errors.push(`${name}: not a JSON array`); continue; }
  arr.forEach((p, i) => {
    const where = `${name}[${i}] ${p.id ?? '(no id)'}`;
    for (const k of REQUIRED) {
      if (typeof p[k] !== 'string' || p[k].length === 0) errors.push(`${where}: missing/empty field "${k}"`);
    }
    for (const k of Object.keys(p)) {
      if (!ALLOWED_KEYS.has(k)) errors.push(`${where}: unexpected key "${k}"`);
    }
    if (!ALLOWED_INTENSITY.has(p.intensity)) errors.push(`${where}: bad intensity "${p.intensity}"`);
    if (!ALLOWED_CATEGORIES.has(p.category)) errors.push(`${where}: bad category "${p.category}"`);
    if (p.speaker !== name) errors.push(`${where}: speaker "${p.speaker}" != file speaker "${name}"`);
    if ('context' in p) {
      if (p.category !== 'goal') errors.push(`${where}: context not allowed on category "${p.category}"`);
      else if (!ALLOWED_CONTEXT.has(p.context)) errors.push(`${where}: bad context "${p.context}"`);
    }
    if (typeof p.id === 'string') {
      if (!idRe.test(p.id)) errors.push(`${where}: id format invalid`);
      else if (!p.id.startsWith(`phrase.${p.speaker}.`)) errors.push(`${where}: id speaker segment mismatch`);
      if (catalogIds.has(p.id)) errors.push(`${where}: id collides with existing catalog`);
      if (seenIds.has(p.id)) errors.push(`${where}: id duplicated (also in ${seenIds.get(p.id)})`);
      seenIds.set(p.id, name);
    }
    // Set-piece path/category coherence
    if (typeof p.id === 'string' && p.id.includes('.setpiece.')) {
      const sub = p.id.split('.setpiece.')[1]?.split('.')[0];
      if (sub && sub !== p.category) errors.push(`${where}: setpiece path "${sub}" but category "${p.category}"`);
    }
    for (const field of ['text','previousText','nextText']) {
      const v = p[field];
      if (typeof v !== 'string') continue;
      for (const [re, label] of BANNED_PATTERNS) {
        if (re.test(v)) errors.push(`${where}: ${field} contains ${label}: "${v}"`);
      }
    }
    // Fragment check: if nextText starts lowercase, the text is a name lead-in fragment
    // and must not end with a full stop.
    if (typeof p.text === 'string' && typeof p.nextText === 'string') {
      const isFragment = /^[a-z]/.test(p.nextText) || !/[.!?]$/.test(p.text.trim());
      if (isFragment && /\.$/.test(p.text.trim())) {
        if (FRAGMENT_TAIL.test(p.text.trim())) errors.push(`${where}: name-fragment text ends with full stop: "${p.text}"`);
      }
    }
  });
}

const total = Object.values(files).reduce((n, a) => (Array.isArray(a) ? n + a.length : n), 0);
console.log(`Total addition phrases: ${total}`);
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
} else {
  console.log('All checks passed.');
}
