import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(ASSETS, 'journey');
const RAW_ROOT = path.join(GAME_ROOT, '.tmp/journey-story-raw');
const MODEL = 'openai/gpt-image-2';

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const only = new Set(String(args.only ?? 'all').split(',').map((s) => s.trim()).filter(Boolean));
const limit = args.limit ? Number(args.limit) : Infinity;
const match = args.match ? new RegExp(String(args.match)) : null;
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? process.env.FAL_IMAGE_CONCURRENCY ?? 2) || 2, 4));
const model = args.model ?? process.env.FAL_IMAGE_MODEL ?? MODEL;

const entries = assetEntries()
  .filter((entry) => only.has('all') || only.has(entry.kind) || only.has(`${entry.kind}s`))
  .filter((entry) => !match || match.test(entry.key) || match.test(entry.file))
  .slice(0, limit);

console.log(`Journey story asset generation: ${entries.length} entries using ${model} via Fal (GPT-Image-2.0), concurrency ${concurrency}`);
if (dryRun) {
  for (const entry of entries) {
    console.log(`${entry.key} -> ${entry.outRel}\n${entry.prompt}\n`);
  }
  process.exit(0);
}

let generated = 0;
let skipped = 0;
let failed = 0;
let nextEntry = 0;

await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, runWorker));

console.log(`Journey story asset generation complete: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function runWorker() {
  for (;;) {
    const entry = entries[nextEntry++];
    if (!entry) return;
    await runEntry(entry);
  }
}

async function runEntry(entry) {
  const outAbs = path.join(ASSETS, entry.outAssetRel);
  if (!force && await exists(outAbs)) {
    skipped++;
    console.log(`skipped ${entry.key}`);
    return;
  }

  try {
    const result = await falQueue(entry.endpoint, buildPayload(entry), { pollMs: 3000, timeoutMs: 900000 });
    const rawAbs = path.join(RAW_ROOT, `${entry.key}.png`);
    await saveImageResult(result, rawAbs);
    execFileSync('python3', [
      'scripts/postprocess-journey-asset.py',
      '--kind',
      entry.kind,
      '--input',
      rawAbs,
      '--output',
      outAbs,
    ], { cwd: GAME_ROOT, stdio: 'inherit' });
    generated++;
    console.log(`generated ${entry.key}`);
  } catch (e) {
    failed++;
    console.error(`failed ${entry.key}: ${e.message}`);
  }
}

function buildPayload(entry) {
  return {
    prompt: entry.prompt,
    image_size: entry.kind === 'background' ? 'landscape_16_9' : 'portrait_4_3',
    num_images: 1,
    quality: 'high',
    output_format: 'png',
  };
}

async function saveImageResult(result, dest) {
  const url = findUrl(result, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(result, []);
  if (url) {
    await download(url, dest);
    await assertImageFile(dest);
    return;
  }

  const dataUri = findDataUri(result);
  if (dataUri) {
    const b64 = dataUri.split(',', 2)[1];
    fsSync.mkdirSync(path.dirname(dest), { recursive: true });
    fsSync.writeFileSync(dest, Buffer.from(b64, 'base64'));
    await assertImageFile(dest);
    return;
  }

  throw new Error(`Fal response did not include an image URL: ${JSON.stringify(result).slice(0, 400)}`);
}

async function assertImageFile(file) {
  const fh = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await fh.read(header, 0, header.length, 0);
    const isPng = bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isWebp = bytesRead >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isPng && !isJpeg && !isWebp) {
      throw new Error(`Downloaded file is not an image: ${file}`);
    }
  } finally {
    await fh.close();
  }
}

function findDataUri(obj) {
  const stack = [obj];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === 'string' && value.startsWith('data:image/')) return value;
    if (value && typeof value === 'object') stack.push(...Object.values(value));
  }
  return null;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function assetEntries() {
  return [
    ...backgroundEntries(),
    ...characterEntries(),
  ];
}

function backgroundEntries() {
  const shared = [
    'Use case: historical-scene.',
    'Asset type: prerendered Story Mode background for a football game.',
    'Style/medium: cinematic realistic digital matte painting, 1990s British football drama, slightly gritty, grounded, high-end TV still.',
    'Composition/framing: wide empty environment, no foreground person, leave clean lower third and side space for overlaid character sprites and dialogue UI.',
    'Lighting/mood: dramatic but readable, natural period lighting, rain or floodlights where specified.',
    'Constraints: no readable text, no real club badge, no sponsor, no trademark, no modern phones, no watermarks, no people in the scene.',
    'Output: 16:9 landscape PNG.',
  ].join(' ');
  return [
    bg('tyneside_manager_office_1995', 'Tyneside manager office, spring 1996: dark wood desk, black and white football photos, tactical magnets, rain on window, black and white striped scarf hints, pressure of a title run-in.'),
    bg('tyneside_dressing_room_1995', 'Tyneside dressing room confrontation, spring 1996: black and white striped shirts hanging, benches, boots, tactics board, tunnel glow, tense title-race atmosphere.'),
    bg('tyneside_press_room_1995', 'Tyneside press room, spring 1996: 1990s TV cameras, folding tables, microphones without logos, flashbulbs, a manager interview space under pressure.'),
    bg('tyneside_training_ground_1995', 'Tyneside training ground in North East England, spring 1996: wet grass, low stands, cones, spare balls, grey sky, title-chasing squad energy.'),
    bg('tyneside_stadium_matchday_1995', 'Tyneside home stadium matchday, spring 1996: packed black and white stands, old floodlights, tunnel mouth, tense title-race crowd, no logos.'),
    bg('tyneside_final_day_stadium_1995', 'Tyneside final-day title scene, May 1996: away stadium under floodlights, packed stands, radios and photographers implied, one last match atmosphere, no team crests.'),
    bg('tyneside_team_bus_1995', 'Tyneside team bus interior, spring 1996: 1990s coach seats, rain-streaked windows, newspapers on seats, pressure before an away match.'),
    bg('teesside_town_street_1996', 'Teesside town street, winter 1996: terraced houses, football ground floodlights in distance, chip shop glow, rain on pavement, local-club survival mood.'),
    bg('teesside_home_kitchen_1996', 'Teesside family kitchen, winter 1996: modest working-class home, kettle, radio, newspaper sports pages with unreadable print, warm light against cold night.'),
    bg('teesside_manager_office_1996', 'Teesside manager office, 1996: practical smaller club office, league table board with unreadable marks, red scarf hints, paperwork, stress of a points deduction.'),
    bg('teesside_dressing_room_1996', 'Teesside dressing room, 1996: red shirts, worn tiles, mud, boots, whiteboard, cup-run tension and relegation fight.'),
    bg('teesside_press_room_1996', 'Teesside press room after points deduction, 1996: low ceiling, old microphones, regional TV camera, anxious boardroom energy, no logos.'),
    bg('teesside_training_ground_rain_1996', 'Teesside training ground in heavy rain, 1996: floodlit cones, muddy touchline, empty seats, survival fight grit.'),
    bg('teesside_stadium_matchday_1996', 'Teesside home stadium matchday, 1996: red-and-white crowd hints, old stands, floodlights, cup and survival tension, no crest.'),
    bg('teesside_cup_final_stadium_1996', 'Cup final stadium tunnel and pitch, 1996: neutral big ground, red team shirts implied, bright floodlights, trophy-day pressure, no branded signage.'),
    bg('teesside_final_day_stadium_1996', 'Teesside final-day survival away stadium, 1997: packed old stand, grey sky, high stakes, muddy pitch edge, survival atmosphere.'),
    bg('teesside_team_bus_1996', 'Teesside team bus interior, 1996: quiet players implied by empty seats, rain on windows, local newspapers, cup medal ribbon and relegation table tension.'),
    bg('mc_colliery_street', '1909 County Durham coalfield street after a pit shift: soot-dark terraced houses, colliery wheel silhouette, men leaving work with boots and cloth caps, one football tucked under an arm, historic drama mood, no modern objects.'),
    bg('mc_committee_room', '1909 Northern English amateur football committee room: gas lamps, wooden table, telegram forms, rail timetables, battered leather football, anxious club officials preparing an unexpected European journey, no readable text.'),
    bg('mc_steam_station', '1909 steam railway platform at dawn: coal smoke, luggage trunks, football boots tied together, third-class carriage, worried families on platform, team leaving for Turin, no readable signage.'),
    bg('mc_turin_hotel_wire_desk', '1909 Turin hotel wire desk: brass key rack, telegram counter, oil lamps, travel trunks, Italian city light through window, sense of no easy contact home, no readable text.'),
    bg('mc_turin_stadium', '1909 Turin football ground: rope boundary, wooden stand, early European crowd in hats, muddy pitch, small cup final tension, no real club badge or readable signage.'),
    bg('fe_newspaper_office', '1872 Glasgow newspaper office: hand press, composing desk, ink rollers, broadsheet pages with unreadable blocks, gaslight, public football challenge atmosphere, no modern objects.'),
    bg('fe_committee_room', '1872 Scottish football club committee room: wooden chairs, rule papers, wool football shirts, leather ball, rail timetable, serious amateur organisers, no readable text.'),
    bg('fe_hamilton_crescent', '1872 Hamilton Crescent cricket ground prepared for association football: rope touchlines, winter grass, light fog, Victorian crowd in coats, pavilion in background, first international tension, no logos.'),
    bg('fe_pavilion', '1872 cricket pavilion dressing room: wooden benches, wool football kits, caps and boots, condensation on windows, players preparing for England vs Scotland, no readable text.'),
    bg('challenge_1930_montevideo_final', 'Archive dossier for a 1930 Montevideo final-inspired challenge: sepia stadium photo, leather ball, tactical notes with unreadable marks, river-city crowd energy, no logos or readable text.'),
    bg('challenge_1934_rome_final', 'Archive dossier for a 1934 Rome final-inspired challenge: old Italian stadium photograph, extra-time tactical board, fountain pen, dark red folder, no real badges or readable text.'),
    bg('challenge_1938_paris_final', 'Archive dossier for a 1938 Paris final-inspired challenge: rainy European stadium photo, folded newspaper with unreadable columns, tactics magnets, tense pre-war atmosphere, no logos.'),
    bg('challenge_1950_maracana', 'Archive dossier for a 1950 Maracana decisive match-inspired challenge: vast stadium photo, blue and gold tactical markers, radio microphone without logo, stunned-crowd mood, no readable text.'),
    bg('challenge_1954_bern', 'Archive dossier for a 1954 Bern rain final-inspired challenge: wet tactics sheet, muddy boots, old black-and-white stadium photo, comeback tension, no readable text or real crests.'),
    bg('challenge_1958_stockholm', 'Archive dossier for a 1958 Stockholm final-inspired challenge: Nordic stadium photo, yellow and blue markers, young-star scouting notes with unreadable writing, bright but dramatic.'),
    bg('challenge_1962_santiago', 'Archive dossier for a 1962 Santiago final-inspired challenge: South American stadium photo, early-goal score card with unreadable marks, green and white tactical board, no logos.'),
    bg('challenge_1966_wembley', 'Archive dossier for a 1966 Wembley extra-time final-inspired challenge: old floodlit stadium photo, red and white magnets, stopwatch, disputed goal-line mood, no readable text.'),
    bg('challenge_1970_azteca', 'Archive dossier for a 1970 Azteca extra-time semi-final-inspired challenge: high-altitude stadium photo, heat haze, tired tactical board, orange folder, no logos or readable text.'),
    bg('challenge_1974_munich', 'Archive dossier for a 1974 Munich final-inspired challenge: modernist stadium photo, orange and white magnets, early penalty note unreadable, tactical contrast mood.'),
    bg('challenge_1978_buenos_aires', 'Archive dossier for a 1978 Buenos Aires extra-time final-inspired challenge: confetti, floodlit stadium photo, blue-white and orange markers, pressure-cooker mood, no logos.'),
    bg('challenge_1982_seville', 'Archive dossier for a 1982 Seville semi-final-inspired challenge: night stadium photo, penalty list with unreadable lines, sweat-stained tactics paper, dramatic lights.'),
    bg('challenge_1986_azteca', 'Archive dossier for a 1986 Azteca handball controversy-inspired challenge: sunlit stadium photo, raised-hand silhouette in a blurred archive still, blue and white markers, no real faces.'),
    bg('challenge_1990_turin', 'Archive dossier for a 1990 Turin semi-final-inspired challenge: penalty spot photograph, dark tactical folder, white and red magnets, tense low-scoring mood, no readable text.'),
    bg('challenge_1994_rose_bowl', 'Archive dossier for a 1994 Rose Bowl penalty final-inspired challenge: bright American stadium photo, penalty cards face down, yellow and blue tactical markers, no logos.'),
    bg('challenge_1998_paris', 'Archive dossier for a 1998 Paris final-inspired challenge: blue host-nation folder, set-piece diagram with unreadable marks, stadium lights, clean-sheet pressure.'),
    bg('challenge_2002_yokohama', 'Archive dossier for a 2002 Yokohama final-inspired challenge: modern Asian stadium photo, striker analysis sheet unreadable, yellow and white magnets, late-goal tension.'),
    bg('challenge_2006_berlin', 'Archive dossier for a 2006 Berlin final-inspired challenge: night stadium photo, discipline warning card, blue and white markers, penalty-shootout tension, no real faces.'),
    bg('challenge_2010_soccer_city', 'Archive dossier for a 2010 Soccer City final-inspired challenge: orange and red magnets, extra-time clock, South African stadium photo, one-pass-before-penalties mood.'),
    bg('challenge_2014_belo_horizonte', 'Archive dossier for a 2014 Belo Horizonte shock semi-final-inspired challenge: tactical board tipping over, yellow and white markers, stunned stadium photo, no real crests.'),
    bg('challenge_2018_rostov', 'Archive dossier for a 2018 Rostov comeback-inspired challenge: two-goal deficit scorecard with unreadable marks, red and blue markers, late counterattack arrows, no logos.'),
    bg('challenge_2022_lusail', 'Archive dossier for a 2022 Lusail final-inspired challenge: golden stadium lights, 2-0 score note unreadable, blue and white markers, chaotic final momentum, no real faces.'),
    bg('challenge_2026_spain_cape_verde', 'Modern fax dossier table for a fictional Spain vs Cape Verde final challenge: paper fixture sheet with unreadable marks, red and blue tactical magnets, old fax machine, stadium-light reflections, high-stakes final mood, no logos or readable text.'),
  ].map((entry) => ({
    ...entry,
    kind: 'background',
    endpoint: model,
    outRel: `assets/journey/backgrounds/${entry.file}.png`,
    outAssetRel: `journey/backgrounds/${entry.file}.png`,
    prompt: `${shared} Primary request: ${entry.prompt}`,
  }));
}

function characterEntries() {
  const shared = [
    'Use case: historical-scene.',
    'Asset type: transparent full-body Story Mode character sprite.',
    'Style/medium: realistic painterly 1990s British football drama character cutout, same polish as a premium sports TV still.',
    'Composition/framing: full body, standing upright, centered, facing slightly toward camera, generous padding, no cropping of feet or head.',
    'Lighting/mood: studio cutout lighting with subtle stadium-drama contrast.',
    'Background: perfectly flat solid #00ff00 chroma-key background only, no shadow, no floor, no texture.',
    'Constraints: fictional person, no real likeness, no real club crest, no sponsor, no readable text, no watermark; do not use #00ff00 anywhere on the person.',
    'Output: portrait PNG for background removal.',
  ].join(' ');
  return [
    ch('ty_chairman_douglas', 'Arthur Douglas, Tyneside chairman: late-50s British club executive, tailored dark suit, club tie in subtle black and white, worried smile, boardroom authority.'),
    ch('ty_assistant_roper', 'Frank Roper, Tyneside assistant: 50s, weathered football man, dark tracksuit under long coat, clipboard, stern but loyal.'),
    ch('ty_coach_bell', 'Les Bell, Tyneside coach: 40s, training top, whistle, practical tracksuit, thoughtful expression.'),
    ch('ty_striker_hayle', 'Mark Hayle, Tyneside striker: late-20s athletic forward, black and white retro football kit, arms folded, frustrated confidence.'),
    ch('ty_winger_maddox', 'Eddie Maddox, Tyneside winger signing: mid-20s, quick winger build, black and white retro kit, relaxed swagger, boots visible.'),
    ch('ty_defender_reece', 'Carl Reece, Tyneside defender signing: early-30s centre half, black and white training jacket, commanding posture, hands on hips.'),
    ch('ty_reporter_keane', 'Martin Keane, tabloid football reporter: 30s, beige 1990s jacket, notepad and tape recorder, sharp expression.'),
    ch('ty_captain_benton', 'Neil Benton, Tyneside captain: early-30s midfielder, black and white retro kit, captain presence, intense stare.'),
    ch('te_chairman_ward', 'Gerald Ward, Teesside chairman: 60s local-club chairman, grey suit, red tie, anxious but proud, folded programme in hand.'),
    ch('te_manager_briggs', 'Harry Briggs, Teesside manager: 50s, red training jacket under dark coat, old-school manager stance, tired eyes, determined.'),
    ch('te_captain_hobbs', 'Mick Hobbs, Teesside captain: early-30s defender, red retro kit, strong build, hands on hips, uncompromising.'),
    ch('te_teammate_varga', 'Tomas Varga, Teesside foreign forward: mid-20s, red retro kit, technical forward, thoughtful expression, boots visible.'),
    ch('te_rival_kane', 'Billy Kane, Roker rival: late-20s midfielder, dark red and white rival kit, antagonistic posture, arms crossed.'),
    ch('te_reporter_sloan', 'Janet Sloan, regional TV reporter: 30s, smart 1990s blazer, handheld microphone without logo, focused and empathetic.'),
    ch('te_dad', 'Teesside dad: late-50s working-class father, casual jacket and jumper, warm worried expression, hands in pockets.'),
    ch('te_agent_miles', 'Derek Miles, football agent: 40s, sharp suit, mobile phone from the 1990s, confident half-smile.'),
    ch('ld_daughter_lina', "Lina, a veteran footballer's grown daughter: early-20s Cape Verdean young woman, warm intelligent face, natural dark curly hair, simple modern casual outfit (denim jacket over a plain top, jeans), proud and a little angry, tired protective expression, arms loosely folded, grounded and real, no football kit."),
    ch('tp_grandmother_ana', "Ana, the player's Haitian grandmother: dignified woman in her early-70s, warm weathered face, dark brown skin, silver-grey hair tied back under a simple patterned headscarf, modest present-day clothing (a buttoned cardigan over a floral blouse and a long skirt), gentle but unyielding expression, hands lightly clasped, deep family warmth and quiet strength, clearly an elderly woman, no football kit."),
    ch('mc_captain_eddie', 'Eddie Rowell, fictional 1909 County Durham colliery football captain: early-30s, strong miner build, cloth cap in hand, old dark wool football kit, heavy boots, determined face, coalfield grit, no badge.'),
    ch('mc_secretary_hawthorn', 'Mr Hawthorn, fictional 1909 amateur club secretary: 50s, neat moustache, dark three-piece suit, papers and telegram forms in hand, anxious but principled, Edwardian working football official.'),
    ch('mc_foreman_doyle', 'Foreman Doyle, fictional 1909 pit foreman: late-40s, heavy coat, waistcoat, coal-dusted hands, stern expression, practical working man suspicious of football dreams.'),
    ch('mc_wife_mary', 'Mary Kerr, fictional 1909 coalfield wife: late-20s, plain Edwardian dress and shawl, worried proud expression, hands clasped, resilient working-class presence, no modern styling.'),
    ch('mc_organiser_bell', 'Alistair Bell, fictional 1909 tournament organiser: 40s, polished Edwardian suit, bowler hat, travel papers, charming but evasive expression, no real likeness.'),
    ch('mc_turin_clerk_luca', 'Luca Rinaldi, fictional 1909 Turin hotel clerk and interpreter: 30s, neat waistcoat, ledger and telegram envelope, alert expression, Italian Edwardian hotel staff.'),
    ch('fe_captain_muir', 'Robert Muir, fictional 1872 Scottish football captain: late-20s, wool football shirt, knickerbockers, lace-up boots, side-parted hair and moustache, calm determined amateur sportsman.'),
    ch('fe_secretary_mackay', 'James Mackay, fictional 1872 Scottish club secretary: 40s, dark Victorian suit, papers and rulebook, serious expression, organiser of early association football.'),
    ch('fe_newspaper_bell', 'Mr Bell, fictional 1872 newspaper editor: 50s, Victorian waistcoat, ink-stained fingers, notepad, sharp eyes, gaslit newspaper office personality.'),
    ch('fe_english_captain_hart', 'Arthur Hart, fictional 1872 English football captain: late-20s, white wool football shirt, dark knickerbockers, neat moustache, polite proud expression, no real likeness.'),
    ch('fe_goalkeeper_fergus', 'Fergus Bain, fictional 1872 Scottish goalkeeper: 20s, wool goalkeeper top, small cap, sturdy boots, nervous but brave expression, early football amateur.'),
    ch('fe_fa_messenger_alden', 'Mr Alden, fictional 1872 English association messenger: 40s, formal Victorian suit, travel bag and rule papers, reserved expression, no real likeness.'),
  ].map((entry) => ({
    ...entry,
    kind: 'character',
    endpoint: model,
    outRel: `assets/journey/characters/${entry.file}.png`,
    outAssetRel: `journey/characters/${entry.file}.png`,
    prompt: `${shared} Primary request: ${entry.prompt}`,
  }));
}

function bg(file, prompt) {
  return { key: file, file, prompt };
}

function ch(file, prompt) {
  return { key: file, file, prompt };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
