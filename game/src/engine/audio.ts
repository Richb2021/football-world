import type { SimEvent } from '../sim/types';
import type { GameAssets } from './assets';

export interface AudioCue {
  key: string;
  vol: number;
  duration?: number;
}

export interface MusicTrack {
  key: string;
  title: string;
}

export interface CrowdContext {
  /** which side the stadium crowd supports (the home team in team 0) */
  crowdTeam: 0 | 1;
}

export function audioCuesForEvents(events: SimEvent[], crowd?: CrowdContext): AudioCue[] {
  const cues: AudioCue[] = [];
  const hasTimeWhistle = events.some((e) => e.type === 'halfTime' || e.type === 'fullWhistle' || e.type === 'fullTime');
  let playedTimeWhistle = false;

  const addTimeWhistle = () => {
    if (playedTimeWhistle) return;
    playedTimeWhistle = true;
    cues.push({ key: 'sfx_whistleFull', vol: 0.45 });
  };
  const ours = (team: number | undefined) => crowd !== undefined && team === crowd.crowdTeam;
  const theirs = (team: number | undefined) => crowd !== undefined && team !== undefined && team !== crowd.crowdTeam;

  for (const e of events) {
    switch (e.type) {
      case 'kick': {
        const power = e.power ?? 0;
        cues.push({ key: power > 0.6 ? 'sfx_kickHard' : power > 0.35 ? 'pool_kickMid' : 'sfx_kickSoft', vol: 0.8 });
        break;
      }
      case 'shot': cues.push({ key: 'sfx_kickHard', vol: 1 }); break;
      case 'header': cues.push({ key: 'sfx_header', vol: 0.85 }); break;
      case 'goal':
        cues.push({ key: 'sfx_netRipple', vol: 0.7 });
        if (theirs(e.team)) {
          // the home crowd groans/boos while a pocket of away fans erupts behind it
          cues.push(
            { key: 'sfx_groanConcede', vol: 0.95 },
            { key: 'sfx_boo1', vol: 0.4 },
            { key: 'sfx_awayCheer', vol: 0.6 },
          );
        } else {
          cues.push({ key: 'sfx_goalRoar', vol: 1 });
          if (crowd) cues.push({ key: 'sfx_cheerBig', vol: 0.75 });
        }
        break;
      case 'save':
        cues.push(ours(e.team) ? { key: 'pool_applause', vol: 0.85 } : { key: 'pool_ooh', vol: 0.8 });
        break;
      case 'post': cues.push({ key: 'sfx_postClang', vol: 0.9 }, { key: 'pool_gasp', vol: 0.9 }); break;
      case 'nearMiss': cues.push({ key: 'pool_gasp', vol: 0.55 }, { key: 'pool_ooh', vol: 0.7 }); break;
      case 'whistle':
        if (!hasTimeWhistle) cues.push({ key: 'sfx_whistle', vol: 0.55, duration: 0.34 });
        break;
      case 'fullWhistle':
      case 'fullTime':
      case 'halfTime':
        addTimeWhistle();
        break;
      case 'foul':
        // the crowd always lets the referee know what it thinks
        cues.push(theirs(e.team) ? { key: 'pool_boo', vol: 0.75 } : { key: 'sfx_boo3', vol: 0.4 });
        break;
      case 'yellowCard':
        cues.push(theirs(e.team) ? { key: 'pool_applause', vol: 0.5 } : { key: 'pool_boo', vol: 0.8 });
        break;
      case 'redCard':
        cues.push(theirs(e.team) ? { key: 'sfx_cheerBig', vol: 0.6 } : { key: 'sfx_boo2', vol: 1 });
        break;
      case 'penalty':
        cues.push({ key: 'pool_gasp', vol: 0.9 }, ours(e.team) ? { key: 'sfx_surge', vol: 0.8 } : { key: 'pool_boo', vol: 0.6 });
        break;
      case 'offside': cues.push({ key: 'sfx_boo3', vol: 0.3 }); break;
      case 'crowdBoo':
        // a clearly wrong decision: the home end erupts when its own side is robbed,
        // a smaller away pocket grumbles when the call goes the home side's way
        cues.push(ours(e.team) ? { key: 'pool_boo', vol: 0.95 } : { key: 'sfx_boo3', vol: 0.45 });
        break;
      case 'crowdIronic':
        // an aggrieved side finally gets one: sarcastic, drawn-out applause, loud
        // from the home end, a thinner ripple from the away corner
        cues.push({ key: 'pool_ironic', vol: ours(e.team) ? 0.95 : 0.5 });
        break;
      case 'crowdMock':
        // a shot skied or dragged miles wide: the home crowd gives the away side a
        // big sarcastic mock cheer; a thinner, sheepish version when it's their own
        cues.push({ key: 'pool_mock', vol: theirs(e.team) ? 0.95 : 0.55 });
        break;
      case 'tackle':
        // swish proved grating at tackle frequency; a last-ditch challenge that snuffs
        // out a chance near goal earns a burst of applause (louder for the home side)
        cues.push({ key: 'sfx_kickSoft', vol: 0.45 });
        if (e.danger) cues.push({ key: 'sfx_applauseBig', vol: ours(e.team) ? 0.85 : 0.5 });
        break;
      case 'bounce': cues.push({ key: 'sfx_kickSoft', vol: 0.25 }); break;
      case 'penScored':
        if (theirs(e.team)) cues.push({ key: 'sfx_groanConcede', vol: 0.95 });
        else cues.push({ key: 'sfx_goalRoar', vol: 1 });
        break;
      case 'penMissed':
        cues.push(ours(e.team) ? { key: 'sfx_aah', vol: 1 } : { key: 'sfx_cheerBig', vol: 0.8 });
        break;
      case 'kickoff': cues.push({ key: 'sfx_whistle', vol: 0.55, duration: 0.34 }); break;
      default: break;
    }
  }

  return cues;
}

/** Variant pools: a pool key fans out to whichever member clips actually loaded. */
export const SFX_POOLS: Record<string, string[]> = {
  pool_kickMid: ['sfx_kickMid1', 'sfx_kickMid2', 'sfx_kickSoft'],
  pool_ooh: ['sfx_crowdOoh', 'sfx_aah'],
  pool_gasp: ['sfx_gasp', 'sfx_crowdOoh'],
  pool_applause: ['sfx_applause1', 'sfx_applause2'],
  pool_boo: ['sfx_boo1', 'sfx_boo2', 'sfx_boo3'],
  pool_ironic: ['sfx_ironicClap1', 'sfx_ironicClap2'],
  pool_mock: ['sfx_mockCheer1', 'sfx_mockCheer2'],
  // chant2 (weird), chant6 (a goal-cheer) and chant7 (didn't land) are dropped from
  // the terrace rotation and the manifest; chant8/9 are the big-crowd chants kept
  pool_chant: ['sfx_crowdChant', 'sfx_chant3', 'sfx_chant4', 'sfx_chant5', 'sfx_chant8', 'sfx_chant9'],
};

/** pick a loaded clip from a pool, avoiding the immediately previous choice */
export function resolvePoolKey(
  key: string,
  loaded: (k: string) => boolean,
  random: () => number,
  lastPick: Map<string, string>,
): string {
  const pool = SFX_POOLS[key];
  if (!pool) return key;
  const avail = pool.filter(loaded);
  if (!avail.length) return pool[0];
  const last = lastPick.get(key);
  const candidates = avail.length > 1 && last ? avail.filter((k) => k !== last) : avail;
  const pick = candidates[Math.floor(random() * candidates.length) % candidates.length];
  lastPick.set(key, pick);
  return pick;
}

export function musicTitleFromPath(assetPath: string): string {
  const filename = decodeURIComponent(assetPath.split('/').pop() ?? assetPath);
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt
    .replace(/^music_/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function menuMusicTracks(buffers: Record<string, AudioBuffer>, manifest: Record<string, string> = {}): MusicTrack[] {
  return Object.keys(buffers)
    .filter((key) => key.startsWith('music_') && key !== 'music_menu')
    .map((key) => ({ key, title: musicTitleFromPath(manifest[key] ?? key) }));
}

export function pickMenuMusicTrack(tracks: MusicTrack[], random = Math.random, previousKey: string | null = null): MusicTrack | null {
  if (!tracks.length) return null;
  if (tracks.length === 1) return tracks[0];
  const candidates = previousKey ? tracks.filter((track) => track.key !== previousKey) : tracks;
  return candidates[Math.floor(random() * candidates.length) % candidates.length];
}

/** WebAudio mixer: menu music, looping crowd bed that swells with excitement, event SFX. */
export class AudioEngine {
  private ctx: AudioContext;
  private buffers: Record<string, AudioBuffer>;
  private master: GainNode;
  private musicGain: GainNode;
  private sfxGain: GainNode;
  private crowdGain: GainNode;
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicMode: 'title' | 'menu' | null = null;
  private currentMusicKey: string | null = null;
  private menuTracks: MusicTrack[];
  private manifest: Record<string, string>;
  /** the menu wants music playing — set even if no track is loaded yet, so a
   *  late-arriving deferred track can kick playback off */
  private wantMenuMusic = false;
  private crowdSrc: AudioBufferSourceNode | null = null;
  private chantTimer = 0;
  onMusicTrack: ((title: string | null) => void) | null = null;

  musicVol = 0.7;
  sfxVol = 0.9;

  constructor(assets: GameAssets, private random = Math.random) {
    this.ctx = assets.audioCtx;
    this.buffers = assets.audio;
    this.manifest = assets.manifest;
    this.menuTracks = menuMusicTracks(this.buffers, assets.manifest);
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.crowdGain.connect(this.master);
    // resume on first interaction (autoplay policy)
    const resume = () => { this.ctx.resume(); };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.musicGain.gain.value = music;
    this.sfxGain.gain.value = sfx;
  }

  /** App backgrounded (tab hidden): halt ALL audio so music/crowd don't keep
   *  playing behind the home screen. resumeFromBackground() restores it. */
  suspendForBackground() {
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }
  resumeFromBackground() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  playTitleMusic() {
    this.wantMenuMusic = false;
    if (this.musicSrc && this.musicMode === 'title') return;
    this.stopCurrentMusic(false);
    this.startMusic('music_menu', true, 'title', null);
  }

  playMenuMusic() {
    this.wantMenuMusic = true;
    if (this.musicSrc && this.musicMode === 'menu') return;
    this.stopCurrentMusic(false);
    this.playNextMenuTrack();
  }

  /** Re-read the menu playlist after deferred "radio" tracks finish loading in
   *  the background; if the menu is waiting with no music, start it now. */
  refreshMenuTracks() {
    this.menuTracks = menuMusicTracks(this.buffers, this.manifest);
    if (this.wantMenuMusic && !this.musicSrc && this.menuTracks.length) {
      this.playNextMenuTrack();
    }
  }

  private playNextMenuTrack() {
    const track = pickMenuMusicTrack(this.menuTracks, this.random, this.currentMusicKey);
    if (!track) {
      this.onMusicTrack?.(null);
      return;
    }
    this.startMusic(track.key, false, 'menu', track.title);
  }

  private startMusic(key: string, loop: boolean, mode: 'title' | 'menu', title: string | null) {
    const buffer = this.buffers[key];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.onended = loop ? null : () => {
      if (this.musicSrc !== src || this.musicMode !== 'menu') return;
      this.musicSrc = null;
      this.playNextMenuTrack();
    };
    src.connect(this.musicGain);
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.value = this.musicVol;
    src.start();
    this.musicSrc = src;
    this.musicMode = mode;
    this.currentMusicKey = key;
    this.onMusicTrack?.(mode === 'menu' ? title : null);
  }

  stopMenuMusic() {
    this.stopCurrentMusic(true);
  }

  private stopCurrentMusic(fade: boolean) {
    if (!this.musicSrc) return;
    const src = this.musicSrc;
    this.musicSrc = null;
    this.musicMode = null;
    src.onended = null;
    this.onMusicTrack?.(null);
    if (!fade) {
      try { src.stop(); } catch {}
      return;
    }
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(0, now + 0.8);
    try { src.stop(now + 0.9); } catch {}
  }

  startCrowd() {
    if (this.crowdSrc || !this.buffers.sfx_crowdLoop) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.sfx_crowdLoop;
    src.loop = true;
    src.connect(this.crowdGain);
    src.start();
    this.crowdSrc = src;
  }

  stopCrowd() {
    if (this.crowdSrc) { try { this.crowdSrc.stop(); } catch {} this.crowdSrc = null; }
    this.crowdGain.gain.value = 0;
  }

  /**
   * call each frame during a match.
   * crowdMood: score difference from the crowd's point of view (+ winning, - losing)
   */
  updateCrowd(excitement: number, dt: number, crowdMood = 0) {
    // self-heal: if the loop never started (buffer wasn't ready at kickoff, or a
    // stop/restart left it silent) bring it back as soon as we're ticking a match,
    // so the crowd bed always plays through the game
    if (!this.crowdSrc) this.startCrowd();
    const target = (0.25 + excitement * 0.75) * this.sfxVol * 0.8;
    const g = this.crowdGain.gain;
    g.value += (target - g.value) * Math.min(1, dt * 3);
    // terrace behaviour between the action: chants when content, boos when embarrassed
    this.chantTimer -= dt;
    if (this.chantTimer <= 0) {
      const winning = crowdMood > 0;
      this.chantTimer = (winning ? 12 : 18) + this.random() * (winning ? 18 : 25);
      if (excitement < 0.55) {
        if (crowdMood <= -2 && this.random() < 0.4) this.play('pool_boo', 0.3);
        else this.play('pool_chant', winning ? 0.5 : 0.4);
      }
    }
  }

  handleEvents(events: SimEvent[], crowd?: CrowdContext) {
    for (const cue of audioCuesForEvents(events, crowd)) this.play(cue.key, cue.vol, cue.duration);
  }

  uiClick() {
    this.play('sfx_uiClick', 0.6);
  }

  private lastPoolPick = new Map<string, string>();

  private play(key: string, vol: number, duration?: number) {
    const resolved = resolvePoolKey(key, (k) => !!this.buffers[k], this.random, this.lastPoolPick);
    const buf = this.buffers[resolved];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // small pitch jitter keeps repeated ball sounds from feeling stamped out
    if (/kick|bounce|header|slide|net/i.test(resolved)) {
      src.playbackRate.value = 0.93 + this.random() * 0.14;
    }
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.sfxGain);
    if (duration) {
      const now = this.ctx.currentTime;
      g.gain.setValueAtTime(vol, now);
      g.gain.linearRampToValueAtTime(0.0001, now + duration);
      src.start(now, 0, Math.min(duration + 0.03, buf.duration));
    } else {
      src.start();
    }
  }
}
