// Merge authored phrase additions into commentaryCatalog.json (idempotent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data');
const catalogPath = path.join(DIR, 'commentaryCatalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const existing = new Set(catalog.phrases.map((p) => p.id));

const isDirectGoalCall = (p) =>
  p.speaker === 'commentator' && p.category === 'goal'
  && !p.id.includes('.for_team.') && !p.id.includes('.scorer.')
  && !p.id.includes('.scorer_') && !p.id.includes('.score_');

let added = 0, skipped = 0, fixed = 0;
for (const file of ['commentary-additions-commentator.json', 'commentary-additions-pundit.json']) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) continue;
  const additions = JSON.parse(fs.readFileSync(full, 'utf8'));
  for (const phrase of additions) {
    if (existing.has(phrase.id)) { skipped++; continue; }
    if (isDirectGoalCall(phrase) && !phrase.text.trim().endsWith('!')) {
      phrase.text = phrase.text.trim().replace(/[.…]*$/, '') + '!';
      fixed++;
    }
    catalog.phrases.push(phrase);
    existing.add(phrase.id);
    added++;
  }
}
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`added ${added}, skipped ${skipped} duplicates, exclamation-fixed ${fixed}, total ${catalog.phrases.length}`);
