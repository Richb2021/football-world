// Fal audio: ElevenLabs sound effects + MiniMax menu music.
// Usage: node fal-audio.mjs [key ...]  (default: all)
import path from 'node:path';
import { ASSETS, falQueue, findUrl, download, updateManifest, log } from './common.mjs';

const SFX = {
  crowdLoop: {
    file: 'crowd_loop.mp3', duration: 20,
    text: 'large football stadium crowd ambience, constant murmur and distant chanting, steady loop, no commentary',
  },
  goalRoar: {
    file: 'goal_roar.mp3', duration: 6,
    text: 'huge football stadium crowd erupting in a massive goal celebration roar, explosive cheering',
  },
  crowdChant: {
    file: 'crowd_chant.mp3', duration: 10,
    text: 'football crowd rhythmic chanting and clapping in unison, terrace chant, stadium echo',
  },
  whistle: {
    file: 'whistle.mp3', duration: 2,
    text: 'single sharp referee pea whistle blast, close, dry',
  },
  whistleFull: {
    file: 'whistle_full.mp3', duration: 3,
    text: 'referee whistle three short blasts signalling full time of a football match',
  },
  kickSoft: {
    file: 'kick_soft.mp3', duration: 1,
    text: 'soft short thud of a football being passed along grass, single kick, close mic',
  },
  kickHard: {
    file: 'kick_hard.mp3', duration: 1,
    text: 'powerful punchy thump of a leather football being struck hard, single shot kick',
  },
  crowdOoh: {
    file: 'crowd_ooh.mp3', duration: 3,
    text: 'football stadium crowd collective disappointed ooooh after a near miss shot',
  },
  netRipple: {
    file: 'net.mp3', duration: 1,
    text: 'football hitting the back of a goal net, soft swish ripple',
  },
  uiClick: {
    file: 'ui_click.mp3', duration: 1,
    text: 'clean short digital menu click blip, satisfying, video game UI',
  },
  // ---- variety pack: chants ----
  chant2: {
    file: 'chant2.mp3', duration: 12,
    text: 'football terrace crowd singing a melodic wordless anthem together, swaying, stadium reverb, no music instruments',
  },
  chant3: {
    file: 'chant3.mp3', duration: 10,
    text: 'large distant football stadium crowd chanting rhythmically in unison, reverberant terrace atmosphere, no close voices, no music, steady chant swelling slightly',
  },
  chant4: {
    file: 'chant4.mp3', duration: 10,
    text: 'football crowd chanting driven by a bass drum beat, stomping feet on terraces, energetic stadium chant',
  },
  chant5: {
    file: 'chant5.mp3', duration: 9,
    text: 'huge distant football stadium crowd singing a slow swelling terrace melody together, washed in stadium reverb, no close vocals, no instruments',
  },
  chant6: {
    file: 'chant6.mp3', duration: 8,
    text: 'rhythmic stadium clapping chant, thousands of fans clapping a da-da da-da-da pattern then cheering',
  },
  // ---- boos and jeers ----
  boo1: {
    file: 'boo1.mp3', duration: 4,
    text: 'football stadium crowd booing loudly in disapproval, deep sustained boos',
  },
  boo2: {
    file: 'boo2.mp3', duration: 6,
    text: 'large angry football crowd booing and jeering heavily, prolonged disapproval, stadium echo',
  },
  boo3: {
    file: 'boo3.mp3', duration: 3,
    text: 'football crowd whistling and jeering sharply in protest at a refereeing decision',
  },
  // ---- crowd reactions ----
  gasp: {
    file: 'gasp.mp3', duration: 2,
    text: 'huge football crowd sharp collective gasp of shock, sudden intake of breath',
  },
  aah: {
    file: 'aah.mp3', duration: 3,
    text: 'football crowd long deflated aahhh of disappointment after a chance goes wide',
  },
  applause1: {
    file: 'applause1.mp3', duration: 4,
    text: 'polite stadium applause from a football crowd, appreciative clapping',
  },
  applause2: {
    file: 'applause2.mp3', duration: 5,
    text: 'big enthusiastic stadium applause with scattered cheers and whistles, football crowd showing appreciation',
  },
  surge: {
    file: 'surge.mp3', duration: 4,
    text: 'football crowd anticipation roar rising quickly as an attack builds, swelling excitement',
  },
  groanConcede: {
    file: 'groan_concede.mp3', duration: 4,
    text: 'football home crowd deflated groan falling into stunned quiet murmur after conceding a goal',
  },
  cheerBig: {
    file: 'cheer_big.mp3', duration: 7,
    text: 'sustained massive football crowd celebration, roaring and singing after a dramatic goal',
  },
  // ---- ball / play sounds ----
  kickMid1: {
    file: 'kick_mid1.mp3', duration: 1,
    text: 'firm mid-strength football pass kick on grass, single thud, close',
  },
  kickMid2: {
    file: 'kick_mid2.mp3', duration: 1,
    text: 'crisp side-foot football pass, leather ball strike, single kick close mic',
  },
  header: {
    file: 'header.mp3', duration: 1,
    text: 'football headed by a player, dull leather thump off a forehead, single header',
  },
  postClang: {
    file: 'post_clang.mp3', duration: 2,
    text: 'football smacking a metal goalpost, sharp aluminium clang with short ring',
  },
  gloveCatch: {
    file: 'glove_catch.mp3', duration: 1,
    text: 'goalkeeper catching a football cleanly in padded gloves, leather smack thump',
  },
  slideSwish: {
    file: 'slide_swish.mp3', duration: 1,
    text: 'football player sliding tackle through wet grass, quick swishing slide',
  },
};

async function makeSfx(key) {
  const job = SFX[key];
  log('--- sfx:', key, '---');
  const res = await falQueue('fal-ai/elevenlabs/sound-effects/v2', {
    text: job.text,
    duration_seconds: job.duration,
  });
  const url = findUrl(res, ['mp3', 'wav', 'ogg']) || findUrl(res, []);
  if (!url) throw new Error(`no audio url: ${JSON.stringify(res).slice(0, 300)}`);
  await download(url, path.join(ASSETS, 'audio', job.file));
  updateManifest({ [`sfx_${key}`]: `assets/audio/${job.file}` });
}

async function makeMusic() {
  log('--- music: menu theme ---');
  const res = await falQueue('fal-ai/minimax-music/v2', {
    prompt:
      'Energetic instrumental 1990s British football anthem for a video game menu: driving baggy ' +
      'madchester drum groove, funky bassline, bright piano stabs, anthemic synth brass, terrace ' +
      'crowd claps, euphoric and nostalgic, instrumental only, no vocals',
    // minimax v2 requires lyrics; structure tags with no words keeps it instrumental
    lyrics_prompt: '[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Bridge]\n\n[Outro]',
  }, { timeoutMs: 900000, pollMs: 8000 });
  const url = findUrl(res, ['mp3', 'wav', 'ogg']) || findUrl(res, []);
  if (!url) throw new Error(`no music url: ${JSON.stringify(res).slice(0, 300)}`);
  await download(url, path.join(ASSETS, 'music', 'menu_theme.mp3'));
  updateManifest({ music_menu: 'assets/music/menu_theme.mp3' });
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(SFX), 'music'];
let failed = 0;
for (const key of keys) {
  try {
    if (key === 'music') await makeMusic();
    else await makeSfx(key);
  } catch (e) { failed++; console.error(`AUDIO ${key} FAILED:`, e.message); }
}
log(`FAL AUDIO DONE (${keys.length - failed}/${keys.length} ok)`);
process.exitCode = failed === keys.length ? 1 : 0;
