// Generates crowd-reaction SFX via the ElevenLabs sound-generation API.
// Run: ELEVENLABS_API_KEY=... node scripts/generate-crowd-sfx.mjs
// The key is read from the environment and never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/audio');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

// NOTE: only list clips you actually want to (re)generate — the API charges per
// call and overwrites by filename. The chant/applause/away_cheer clips above were
// generated in earlier runs and live in public/assets/audio already.
const JOBS = [
  { file: 'mock_cheer1.mp3', seconds: 4.5, influence: 0.5,
    text: 'A large football crowd letting out a big sarcastic mock cheer and ironic "oooooh" after an opposition player blasts a shot high over the bar into the stands, a teasing jeering roar with scattered laughter, big-match atmosphere, no music' },
  { file: 'mock_cheer2.mp3', seconds: 4.5, influence: 0.5,
    text: 'A packed stadium crowd giving a derisive sarcastic ironic cheer and mocking "wheyyy" as a striker drags a shot miles wide of the goal, a swelling teasing roar that mocks the wayward effort, no music' },
];

async function gen({ file, text, seconds, influence }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, duration_seconds: seconds, prompt_influence: influence, output_format: 'mp3_44100_128' }),
  });
  if (!res.ok) throw new Error(`${file}: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(`  wrote ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
}

for (const job of JOBS) {
  console.log(`generating ${job.file} ...`);
  try { await gen(job); } catch (e) { console.error('  FAILED', String(e).slice(0, 300)); }
}
console.log('done');
