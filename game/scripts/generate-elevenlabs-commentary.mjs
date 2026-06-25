import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'src/data/commentaryCatalog.json');
const TEAMS_DIR = path.join(ROOT, 'src/data/teams');
const OUT_DIR = path.join(ROOT, 'public/assets/commentary');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

const args = parseArgs(process.argv.slice(2));
const only = new Set((args.only ?? 'all').split(',').map((s) => s.trim()).filter(Boolean));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const limit = args.limit ? Number(args.limit) : Infinity;
const match = args.match ? new RegExp(args.match) : null;
const concurrency = Math.max(1, Math.min(4, Number(args.concurrency ?? 2)));
const modelId = args.model ?? 'eleven_multilingual_v2';
const outputFormat = args.format ?? 'mp3_44100_128';
const apiKey = process.env.ELEVENLABS_API_KEY;

const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'));
const teams = await loadTeams();
const allEntries = buildEntries(catalog, teams);
const selected = uniqueEntriesById(allEntries
  .filter((entry) => matchesOnly(entry, only))
  .filter((entry) => !match || match.test(entry.id)))
  .slice(0, limit);

console.log(`Commentary catalogue: ${catalog.phrases.length} phrases, ${teams.length} teams, ${teams.reduce((sum, t) => sum + t.players.length, 0)} players`);
console.log(`Selected ${selected.length} clips (${[...only].join(', ')})`);

if (dryRun) {
  for (const entry of selected.slice(0, 20)) console.log(`${entry.id}: ${entry.text}`);
  if (selected.length > 20) console.log(`...and ${selected.length - 20} more`);
  process.exit(0);
}

if (!apiKey) {
  throw new Error('ELEVENLABS_API_KEY is not set. Export it in your shell or use an ignored .env loader before running this script.');
}

await fs.mkdir(OUT_DIR, { recursive: true });
const manifest = await loadExistingManifest();
manifest.version = catalog.version;
manifest.generatedAt = new Date().toISOString();
manifest.people = catalog.people;
manifest.voices = catalog.voices;
manifest.clips ??= {};

let generated = 0;
let skipped = 0;
let failed = 0;

await runLimited(selected, concurrency, async (entry) => {
  const absPath = path.join(ROOT, 'public', entry.src);
  await fs.mkdir(path.dirname(absPath), { recursive: true });

  if (!force && await exists(absPath)) {
    skipped++;
    manifest.clips[entry.id] = manifestEntry(entry);
    return;
  }

  try {
    const audio = await requestSpeech(entry, apiKey, modelId, outputFormat);
    await fs.writeFile(absPath, audio);
    manifest.clips[entry.id] = manifestEntry(entry);
    generated++;
    console.log(`generated ${entry.id}`);
  } catch (e) {
    failed++;
    console.error(`failed ${entry.id}: ${e.message}`);
  }
});

await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Commentary generation complete: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

function buildEntries(catalogData, teamData) {
  const entries = [];
  for (const phrase of catalogData.phrases) {
    entries.push({
      id: phrase.id,
      kind: 'phrase',
      speaker: phrase.speaker,
      intensity: phrase.intensity,
      text: phrase.text,
      previousText: phrase.previousText,
      nextText: phrase.nextText,
      src: `assets/commentary/${phrase.speaker}/phrases/${safeFileName(phrase.id)}.mp3`,
      voiceId: catalogData.voices[phrase.speaker],
    });
  }

  for (const team of teamData) {
    for (const style of catalogData.nameStyles) {
      entries.push({
        id: teamNameClipId(team.id, style.intensity),
        kind: 'team',
        speaker: 'commentator',
        intensity: style.intensity,
        text: styledTeamNameText(team.name, style.intensity),
        previousText: style.previousText,
        nextText: style.nextText,
        src: `assets/commentary/commentator/teams/${safeFileName(teamNameClipId(team.id, style.intensity))}.mp3`,
        voiceId: catalogData.voices.commentator,
      });
    }
    entries.push({
      id: stadiumNameClipId(team.id),
      kind: 'stadium',
      speaker: 'commentator',
      intensity: 'calm',
      text: team.stadium,
      previousText: 'We are live from',
      nextText: 'for a league match.',
      src: `assets/commentary/commentator/stadiums/${safeFileName(stadiumNameClipId(team.id))}.mp3`,
      voiceId: catalogData.voices.commentator,
    });
    for (const player of team.players) {
      for (const style of catalogData.nameStyles) {
        entries.push({
          id: playerNameClipId(team.id, player.name, style.intensity),
          kind: 'player',
          speaker: 'commentator',
          intensity: style.intensity,
          text: styledPlayerNameText(player.name, style.intensity),
          previousText: style.previousText,
          nextText: style.nextText,
          src: `assets/commentary/commentator/players/${team.id}/${safeFileName(playerNameClipId(team.id, player.name, style.intensity))}.mp3`,
          voiceId: catalogData.voices.commentator,
        });
        entries.push({
          id: playerFullNameClipId(team.id, player.name, style.intensity),
          kind: 'playerFull',
          speaker: 'commentator',
          intensity: style.intensity,
          text: styledFullPlayerNameText(player.name, style.intensity),
          previousText: style.previousText,
          nextText: style.nextText,
          src: `assets/commentary/commentator/player-full/${team.id}/${safeFileName(playerFullNameClipId(team.id, player.name, style.intensity))}.mp3`,
          voiceId: catalogData.voices.commentator,
        });
      }
    }
  }
  for (const intensity of ['calm', 'excited', 'big']) {
    for (let n = 0; n <= 9; n++) {
      entries.push({
        id: scoreNumberClipId(n, intensity),
        kind: 'number',
        speaker: 'commentator',
        intensity,
        text: styledScoreNumberText(n, intensity),
        previousText: 'The score is',
        nextText: 'in the match.',
        src: `assets/commentary/commentator/numbers/${safeFileName(scoreNumberClipId(n, intensity))}.mp3`,
        voiceId: catalogData.voices.commentator,
      });
    }
  }
  return entries;
}

async function requestSpeech(entry, key, model, format) {
  const url = new URL(`${API_URL}/${entry.voiceId}`);
  url.searchParams.set('output_format', format);
  const body = {
    text: entry.text,
    model_id: model,
    voice_settings: voiceSettings(entry),
    previous_text: entry.previousText ?? defaultPreviousText(entry),
    next_text: entry.nextText ?? defaultNextText(entry),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 240)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

function voiceSettings(entry) {
  if (entry.speaker === 'pundit') {
    return {
      stability: entry.intensity === 'big' ? 0.48 : 0.62,
      similarity_boost: 0.82,
      use_speaker_boost: true,
    };
  }
  if (entry.intensity === 'big') {
    return { stability: 0.24, similarity_boost: 0.74, use_speaker_boost: true };
  }
  if (entry.intensity === 'excited') {
    return { stability: 0.36, similarity_boost: 0.78, use_speaker_boost: true };
  }
  return { stability: 0.5, similarity_boost: 0.82, use_speaker_boost: true };
}

function defaultPreviousText(entry) {
  if (entry.intensity === 'big') return 'The ball hits the net and the commentator shouts over the crowd.';
  if (entry.intensity === 'excited') return 'The tempo lifts as the attack develops.';
  return 'Play continues in the match.';
}

function defaultNextText(entry) {
  if (entry.intensity === 'big') return 'The stadium erupts in celebration.';
  if (entry.intensity === 'excited') return 'There is pressure around the penalty area.';
  return 'The game settles back into shape.';
}

async function loadTeams() {
  const files = (await fs.readdir(TEAMS_DIR)).filter((file) => file.endsWith('.json')).sort();
  const teamData = await Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(TEAMS_DIR, file), 'utf8'))));

  // Also discover teams in extra leagues, e.g., src/data/leagues/world-cup/*.json
  const leaguesDir = path.join(ROOT, 'src/data/leagues');
  try {
    const entries = await fs.readdir(leaguesDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(leaguesDir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = (await fs.readdir(entryPath)).filter((file) => file.endsWith('.json'));
        const subTeams = await Promise.all(
          subFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(entryPath, file), 'utf8')))
        );
        teamData.push(...subTeams);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const pack = JSON.parse(await fs.readFile(entryPath, 'utf8'));
        if (Array.isArray(pack.teams)) {
          teamData.push(...pack.teams);
        } else if (pack.id && Array.isArray(pack.players)) {
          teamData.push(pack);
        }
      }
    }
  } catch (e) {
    // If leagues folder doesn't exist, ignore
  }

  // De-duplicate by ID just in case
  const seen = new Set();
  const uniqueTeams = [];
  for (const t of teamData) {
    if (t && t.id && !seen.has(t.id)) {
      seen.add(t.id);
      uniqueTeams.push(t);
    }
  }

  return uniqueTeams.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadExistingManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return {
      version: catalog.version,
      generatedAt: new Date().toISOString(),
      people: catalog.people,
      voices: catalog.voices,
      clips: {},
    };
  }
}

function manifestEntry(entry) {
  return {
    id: entry.id,
    src: entry.src,
    speaker: entry.speaker,
    kind: entry.kind,
    intensity: entry.intensity,
    text: entry.text,
  };
}

async function runLimited(items, width, worker) {
  let index = 0;
  const workers = Array.from({ length: width }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      parsed[arg.slice(2)] = argv[++i];
    } else {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}

function matchesOnly(entry, selectedKinds) {
  if (selectedKinds.has('all')) return true;
  if (selectedKinds.has(entry.kind) || selectedKinds.has(`${entry.kind}s`)) return true;
  if (entry.kind === 'playerFull') {
    return selectedKinds.has('playerFullNames') || selectedKinds.has('fullPlayers') || selectedKinds.has('fullPlayerNames');
  }
  if (entry.kind === 'stadium') return selectedKinds.has('stadiums');
  if (entry.kind === 'number') return selectedKinds.has('numbers') || selectedKinds.has('scoreNumbers');
  return false;
}

function uniqueEntriesById(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function slugifyName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function teamNameClipId(teamId, intensity) {
  return `team.${spokenTeamId(teamId)}.${intensity}`;
}

function stadiumNameClipId(teamId) {
  return `stadium.${spokenTeamId(teamId)}.calm`;
}

function scoreNumberClipId(score, intensity) {
  return `number.${Math.max(0, Math.min(9, Math.floor(score)))}.${intensity}`;
}

function playerNameClipId(teamId, playerName, intensity) {
  return `player.${spokenTeamId(teamId)}.${slugifyName(playerName)}.${intensity}`;
}

function playerFullNameClipId(teamId, playerName, intensity) {
  return `player-full.${spokenTeamId(teamId)}.${slugifyName(playerName)}.${intensity}`;
}

function spokenTeamId(teamId) {
  return slugifyName(teamId).replace(/-(95|96|97)$/u, '');
}

function styledTeamNameText(name, intensity) {
  return intensity === 'calm' ? name : `${name}!`;
}

function styledScoreNumberText(score, intensity) {
  const words = ['nil', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = words[score] ?? String(score);
  return intensity === 'big' ? `${word}!` : word;
}

function styledPlayerNameText(name, intensity) {
  const callName = playerCallName(name);
  return intensity === 'calm' ? callName : `${callName}!`;
}

function styledFullPlayerNameText(name, intensity) {
  return intensity === 'calm' ? name : `${name}!`;
}

function playerCallName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? name.trim();
  const surnameParticles = new Set(['da', 'de', 'del', 'den', 'der', 'la', 'le', 'van', 'von']);
  let start = parts.length - 1;
  while (start > 0 && surnameParticles.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(' ');
}

function safeFileName(id) {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-');
}
