import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioAssetKeys } from '../assets';
import {
  AudioEngine,
  audioCuesForEvents,
  menuMusicTracks,
  musicTitleFromPath,
} from '../audio';
import type { SimEvent } from '../../sim/types';

describe('audio cue planning', () => {
  it('uses the half-time whistle cue for full-time without stacking duplicate whistles', () => {
    const half = audioCuesForEvents([{ type: 'halfTime' }, { type: 'whistle' }]);
    const full = audioCuesForEvents([{ type: 'fullWhistle' }, { type: 'fullTime' }]);

    expect(half).toEqual([{ key: 'sfx_whistleFull', vol: 0.45 }]);
    expect(full).toEqual(half);
  });

  it('keeps ordinary restart whistles short', () => {
    const restart: SimEvent[] = [{ type: 'whistle' }];

    expect(audioCuesForEvents(restart)).toEqual([{ key: 'sfx_whistle', vol: 0.55, duration: 0.34 }]);
  });

  it('boos a wrong decision against the home side loudly and the away side quietly', () => {
    const home = audioCuesForEvents([{ type: 'crowdBoo', team: 0 }], { crowdTeam: 0 });
    const away = audioCuesForEvents([{ type: 'crowdBoo', team: 1 }], { crowdTeam: 0 });

    expect(home).toEqual([{ key: 'pool_boo', vol: 0.95 }]);
    expect(away[0].key).toBe('sfx_boo3');
    expect(away[0].vol).toBeLessThan(home[0].vol);
  });

  it('plays ironic applause, louder when the home crowd gets its decision', () => {
    const home = audioCuesForEvents([{ type: 'crowdIronic', team: 0 }], { crowdTeam: 0 });
    const away = audioCuesForEvents([{ type: 'crowdIronic', team: 1 }], { crowdTeam: 0 });

    expect(home).toEqual([{ key: 'pool_ironic', vol: 0.95 }]);
    expect(away[0].key).toBe('pool_ironic');
    expect(away[0].vol).toBeLessThan(home[0].vol);
  });

  it('mock-cheers a wild miss, loudest when the away side skies it', () => {
    const away = audioCuesForEvents([{ type: 'crowdMock', team: 1 }], { crowdTeam: 0 });
    const home = audioCuesForEvents([{ type: 'crowdMock', team: 0 }], { crowdTeam: 0 });

    expect(away).toEqual([{ key: 'pool_mock', vol: 0.95 }]);
    expect(home[0].key).toBe('pool_mock');
    expect(home[0].vol).toBeLessThan(away[0].vol);
  });
});

describe('menu music playback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads every manifest music track while keeping music_menu as the title theme', () => {
    expect(audioAssetKeys({
      sfx_whistle: 'assets/audio/whistle.mp3',
      music_menu: 'assets/music/menu_theme.mp3',
      music_lowSun: 'assets/music/Low Sun.mp3',
      music_glassRadio: 'assets/music/Glass Radio.mp3',
      badge_arsenal: 'assets/generated/badge_arsenal.webp',
    })).toEqual(['sfx_whistle', 'music_menu', 'music_lowSun', 'music_glassRadio']);
  });

  it('derives menu playlist names from music files without including the title theme', () => {
    const tracks = menuMusicTracks({
      music_menu: fakeBuffer('music_menu'),
      music_lowSun: fakeBuffer('music_lowSun'),
      music_glassRadio: fakeBuffer('music_glassRadio'),
    }, {
      music_menu: 'assets/music/menu_theme.mp3',
      music_lowSun: 'assets/music/Low%20Sun.mp3',
      music_glassRadio: 'assets/music/Glass Radio.mp3',
    });

    expect(tracks).toEqual([
      { key: 'music_lowSun', title: 'Low Sun' },
      { key: 'music_glassRadio', title: 'Glass Radio' },
    ]);
    expect(musicTitleFromPath('assets/music/Out%20Of%20Season.mp3')).toBe('Out Of Season');
  });

  it('uses the title theme only on the start screen and chains random playlist tracks in menus', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn() });

    const { ctx, sources } = fakeAudioContext();
    const playing: Array<string | null> = [];
    const engine = new AudioEngine({
      manifest: {
        music_menu: 'assets/music/menu_theme.mp3',
        music_lowSun: 'assets/music/Low Sun.mp3',
        music_glassRadio: 'assets/music/Glass Radio.mp3',
      },
      audioCtx: ctx,
      audio: {
        music_menu: fakeBuffer('music_menu'),
        music_lowSun: fakeBuffer('music_lowSun'),
        music_glassRadio: fakeBuffer('music_glassRadio'),
      },
    } as any, () => 0);
    engine.onMusicTrack = (title) => playing.push(title);

    engine.playTitleMusic();
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer.id).toBe('music_menu');
    expect(sources[0].loop).toBe(true);
    expect(playing).toEqual([null]);

    engine.playMenuMusic();
    expect(sources[0].stopped).toBe(true);
    expect(sources).toHaveLength(2);
    expect(sources[1].buffer.id).toBe('music_lowSun');
    expect(sources[1].loop).toBe(false);
    expect(playing.at(-1)).toBe('Low Sun');

    sources[1].onended?.(new Event('ended') as Event);
    expect(sources).toHaveLength(3);
    expect(sources[2].buffer.id).toBe('music_glassRadio');
    expect(playing.at(-1)).toBe('Glass Radio');

    engine.stopMenuMusic();
    expect(sources[2].stopped).toBe(true);
    expect(playing.at(-1)).toBeNull();
    sources[2].onended?.(new Event('ended') as Event);
    expect(sources).toHaveLength(3);
  });

  it('does not fall back to the title theme when no menu playlist tracks are available', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn() });

    const { ctx, sources } = fakeAudioContext();
    const playing: Array<string | null> = [];
    const engine = new AudioEngine({
      manifest: { music_menu: 'assets/music/menu_theme.mp3' },
      audioCtx: ctx,
      audio: { music_menu: fakeBuffer('music_menu') },
    } as any, () => 0);
    engine.onMusicTrack = (title) => playing.push(title);

    engine.playMenuMusic();

    expect(sources).toHaveLength(0);
    expect(playing).toEqual([null]);
  });
});

function fakeBuffer(id: string) {
  return { id, duration: 90 } as any;
}

function fakeAudioContext() {
  const sources: any[] = [];
  const gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createGain: vi.fn(() => ({ gain, connect: vi.fn() })),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as any,
        loop: false,
        onended: null as ((event: Event) => void) | null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(() => { source.stopped = true; }),
        stopped: false,
      };
      sources.push(source);
      return source;
    }),
  };
  return { ctx: ctx as any, sources };
}
