import { describe, expect, it } from 'vitest';
import { avatarPalette, portraitSvg, figureSvg } from '../avatar';
import { contactChromeForMode, emptyInbox, pushMessage, unreadCount, markRead, markAllRead } from '../phone';
import { buildPressConference } from '../pressConference';
import { rollEvents, eventCount } from '../randomEvents';
import { eventAvatarFor } from '../eventUI';
import { addDelta, emptyDelta } from '../metaTypes';
import type { MetaContext } from '../metaTypes';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('avatar', () => {
  it('is deterministic per seed and varies across seeds', () => {
    expect(avatarPalette('Bob Smith')).toEqual(avatarPalette('Bob Smith'));
    const a = avatarPalette('Reporter A');
    const b = avatarPalette('Reporter B');
    expect(a.skin !== b.skin || a.hair !== b.hair || a.shirt !== b.shirt || a.style !== b.style).toBe(true);
  });
  it('produces svg containing the palette skin colour', () => {
    const p = avatarPalette('Pep');
    expect(portraitSvg('Pep')).toContain(p.skin);
    expect(figureSvg('Pep')).toContain('<svg');
    expect(figureSvg('Pep')).toContain('</svg>');
  });
  it('honours a shirt hint', () => {
    expect(avatarPalette('x', '#ff0000').shirt).toBe('#ff0000');
  });
});

describe('phone inbox', () => {
  it('provides period contact chrome for story modes', () => {
    expect(contactChromeForMode('phone')).toMatchObject({
      title: 'Messages',
      status: 'SL93',
      buttonLabel: 'Phone',
    });
    expect(contactChromeForMode('telegram')).toMatchObject({
      title: 'Telegrams',
      status: 'WIRE',
      buttonLabel: 'Telegrams',
    });
    expect(contactChromeForMode('cablegram')).toMatchObject({
      title: 'Cablegrams',
      status: 'CABLE',
      buttonLabel: 'Cablegrams',
    });
  });

  it('orders newest first, counts unread, and marks read', () => {
    const inbox = emptyInbox();
    pushMessage(inbox, { from: 'Chairman', senderType: 'chairman', text: 'first', time: 'D1', order: 1 });
    const m2 = pushMessage(inbox, { from: 'Agent', senderType: 'agent', text: 'second', time: 'D2', order: 2 });
    expect(inbox.messages[0].id).toBe(m2.id); // newest first
    expect(unreadCount(inbox)).toBe(2);
    markRead(inbox, m2.id);
    expect(unreadCount(inbox)).toBe(1);
    markAllRead(inbox);
    expect(unreadCount(inbox)).toBe(0);
  });
  it('carries reply options', () => {
    const inbox = emptyInbox();
    const m = pushMessage(inbox, { from: 'Captain', senderType: 'captain', text: 'back us?', time: 'D1', order: 1, replies: [{ id: 'y', text: 'Always', effect: { squad: 5 } }] });
    expect(m.replies?.[0].effect?.squad).toBe(5);
  });
  it('carries required response state', () => {
    const inbox = emptyInbox();
    const m = pushMessage(inbox, {
      from: 'Captain',
      senderType: 'captain',
      text: 'Need you before kickoff.',
      time: 'MD2',
      order: 4,
      requiresResponse: true,
      replies: [{ id: 'yes', text: 'I will speak to them', effect: { squad: 4 } }],
    });
    expect(m.requiresResponse).toBe(true);
    expect(m.replied).toBeUndefined();
  });
});

describe('press conference', () => {
  const ctx: MetaContext = {
    teamName: 'England', managerName: 'Roy Stone', opponent: 'Brazil',
    tone: 'pre-match', stage: 'Quarter-Final', star: 'Jordan Vale', outOfForm: 'Sam Pitt',
  };
  it('builds the requested number of contextual questions with substitutions', () => {
    const conf = buildPressConference(ctx, 'press_room.png', { rng: lcg(7), count: 3 });
    expect(conf.questions).toHaveLength(3);
    expect(conf.speakerName).toBe('Roy Stone');
    expect(conf.subtitle).toContain('Quarter-Final');
    const joined = conf.questions.map((q) => q.text).join(' ');
    // pre-match pool references the opponent
    expect(joined).toContain('Brazil');
    // every question offers more than two answers, each with a morale effect
    for (const q of conf.questions) {
      expect(q.answers.length).toBeGreaterThanOrEqual(3);
      for (const ans of q.answers) expect(ans.effect).toBeTruthy();
    }
  });
  it('substitutes player names into effects', () => {
    const conf = buildPressConference({ ...ctx, tone: 'form' }, 'r.png', { rng: lcg(2), count: 2 });
    const names = conf.questions.flatMap((q) => q.answers.flatMap((an) => (an.effect.players ?? []).map((p) => p.name)));
    // {outOfForm} resolved to the real name, never left as a token
    expect(names.every((n) => !n.includes('{'))).toBe(true);
  });
  it('builds hostile questions when press stance is hostile', () => {
    const conf = buildPressConference({ ...ctx, pressStance: 'hostile' }, 'press_room.png', { rng: lcg(5), count: 4 });
    const copy = conf.questions.map((q) => q.text).join(' ');
    expect(copy.toLowerCase()).toMatch(/pressure|critics|questions|defensive|explain|risk|tense/);
  });
  it('varies answer tones across friendly and hostile contexts', () => {
    const hostile = buildPressConference({ ...ctx, pressStance: 'hostile' }, 'r.png', { rng: lcg(11), count: 4 });
    const friendly = buildPressConference({ ...ctx, pressStance: 'friendly' }, 'r.png', { rng: lcg(12), count: 4 });
    const tones = new Set([...hostile.questions, ...friendly.questions].flatMap((q) => q.answers.map((a) => a.tone)));
    expect(tones.size).toBeGreaterThanOrEqual(6);
  });
  it('asks different questions for favourite crisis and underdog fairytale contexts', () => {
    const favouriteCrisis = buildPressConference({
      ...ctx,
      tone: 'post-draw',
      pressStance: 'hostile',
      expectationTier: 'favourite',
      opponentTier: 'minnow',
      performanceMood: 'collapse',
    }, 'r.png', { rng: lcg(20), count: 8 });
    const underdogDream = buildPressConference({
      ...ctx,
      teamName: 'Cape Verde',
      opponent: 'Brazil',
      tone: 'post-draw',
      pressStance: 'friendly',
      expectationTier: 'minnow',
      opponentTier: 'favourite',
      performanceMood: 'heroic',
      underdog: true,
    }, 'r.png', { rng: lcg(21), count: 8 });

    const crisisCopy = favouriteCrisis.questions.map((q) => q.text).join(' ').toLowerCase();
    const dreamCopy = underdogDream.questions.map((q) => q.text).join(' ').toLowerCase();
    expect(crisisCopy).toMatch(/standards|crisis|alarm|failure|explain/);
    expect(dreamCopy).toMatch(/dream|history|fairytale|believe/);
    expect(crisisCopy).not.toEqual(dreamCopy);
  });
});

describe('random events', () => {
  const ctx: MetaContext = { teamName: 'Spain', managerName: 'Ana Cruz', tone: 'post-win', star: 'Leo Mar', outOfForm: 'Tom Reed', matchNumber: 3 };
  it('has a healthy event pool', () => {
    expect(eventCount()).toBeGreaterThanOrEqual(12);
  });
  it('returns at most `max` contextual events with substitutions', () => {
    const evs = rollEvents(ctx, lcg(99), 2);
    expect(evs.length).toBeLessThanOrEqual(2);
    for (const e of evs) {
      expect(e.title.includes('{')).toBe(false);
      expect(e.body.includes('{')).toBe(false);
      expect(e.message?.text.includes('{')).not.toBe(true);
      expect(e.message?.replies?.some((r) => r.text.includes('{') || r.response?.includes('{'))).not.toBe(true);
    }
  });
  it('filters events by context (bonus row needs 2+ matches played)', () => {
    // with matchNumber 0, the bonus-row event must never appear
    let sawBonus = false;
    for (let s = 1; s < 60; s++) {
      const evs = rollEvents({ ...ctx, tone: 'pre-match', matchNumber: 0 }, lcg(s), 3);
      if (evs.some((e) => e.id === 'bonus-row')) sawBonus = true;
    }
    expect(sawBonus).toBe(false);
  });
  it('has events that react to team expectation and performance mood', () => {
    let sawFavouriteCrisis = false;
    let sawFairytale = false;
    for (let s = 1; s < 120; s++) {
      const crisis = rollEvents({
        ...ctx,
        teamName: 'Brazil',
        tone: 'post-draw',
        expectationTier: 'favourite',
        opponentTier: 'minnow',
        performanceMood: 'collapse',
        pressStance: 'hostile',
      }, lcg(s), 4);
      const dream = rollEvents({
        ...ctx,
        teamName: 'Cape Verde',
        tone: 'post-draw',
        expectationTier: 'minnow',
        opponentTier: 'favourite',
        performanceMood: 'heroic',
        underdog: true,
        pressStance: 'friendly',
      }, lcg(s + 500), 4);
      if (crisis.some((event) => event.id === 'federation-panic')) sawFavouriteCrisis = true;
      if (dream.some((event) => event.id === 'fairytale-wave')) sawFairytale = true;
    }
    expect(sawFavouriteCrisis).toBe(true);
    expect(sawFairytale).toBe(true);
  });

  it('resolves International Cup event contacts to generated bitmap assets instead of procedural SVGs', () => {
    for (const [senderType, avatarSeed] of [
      ['physio', 'physio'],
      ['assistant', 'assistant'],
      ['fan', 'fan_hype'],
      ['unknown', 'unmapped_contact'],
    ] as const) {
      const avatar = eventAvatarFor({ senderType, avatarSeed });

      expect(avatar).toContain('assets/avatars/');
      expect(avatar).toContain('.webp');
      expect(avatar).not.toContain('data:image/svg+xml');
    }
  });
});

describe('morale delta math', () => {
  it('accumulates deltas', () => {
    const acc = emptyDelta();
    addDelta(acc, { squad: 5, fans: 2, players: [{ name: 'A', delta: 3 }] });
    addDelta(acc, { squad: -2, media: 4, players: [{ name: 'B', delta: -1 }] });
    expect(acc.squad).toBe(3);
    expect(acc.fans).toBe(2);
    expect(acc.media).toBe(4);
    expect(acc.players).toHaveLength(2);
  });
});
