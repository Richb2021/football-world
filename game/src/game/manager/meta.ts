/**
 * Football World — MANAGER MODE meta layer: builds the shared MetaContext from a
 * ManagerState, applies morale bundles, and drives press conferences, the phone
 * inbox and random events. Reuses the pure meta/* modules so Manager Mode gets
 * the same press rooms, inbox and jeopardy as the cup/story modes.
 *
 * Pure data + logic — no DOM, no engine imports (engine imports this).
 */
import type { Rng } from '../../sim/rng';
import { overallRating } from '../../sim/formations';
import type {
  MetaContext, MoraleDelta, PressTone, PressConference, MetaEvent,
  SenderType, PhoneReply, ExpectationTier, PerformanceMood,
} from '../../meta/metaTypes';
import { buildPressConference } from '../../meta/pressConference';
import { rollEvents } from '../../meta/randomEvents';
import { pushMessage } from '../../meta/phone';
import type { ManagerState, ManagerPlayer, TargetKind } from './types';
import { clamp, playerKey } from './types';
import { clubStrength, clubNameOf } from './utils';

// -------------------------------------------------------------- helpers

/** Map a board target kind onto a press-room expectation tier. */
function expectationForKind(kind: TargetKind): ExpectationTier {
  switch (kind) {
    case 'title': return 'favourite';
    case 'promotion': return 'contender';
    case 'playoffs': return 'dark-horse';
    case 'mid-table': return 'contender';
    case 'survival': return 'outsider';
    default: return 'contender';
  }
}

/** Derive star / in-form / out-of-form names from the user squad. */
function squadNarrative(squad: ManagerPlayer[]): { star?: string; inForm?: string; outOfForm?: string } {
  if (!squad.length) return {};
  const rated = squad.map((p) => ({ p, ovr: overallRating(p) })).sort((a, b) => b.ovr - a.ovr);
  const star = rated[0]?.p.name;
  // form-based: pick the best/worst form among the top 14 (likely rotation)
  const pool = rated.slice(0, Math.min(14, rated.length));
  const byForm = [...pool].sort((a, b) => b.p.form - a.p.form);
  const inForm = byForm[0]?.p.name;
  const outOfForm = byForm[byForm.length - 1]?.p.name;
  return { star, inForm, outOfForm };
}

/** Read performance mood from current sentiment (fans/pressure relative to par). */
function performanceMoodOf(state: ManagerState): PerformanceMood {
  const s = state.sentiment;
  const net = s.fans + s.squad - s.pressure;
  if (net >= 150) return 'heroic';
  if (net >= 110) return 'overperforming';
  if (net <= 50) return 'collapse';
  if (net <= 80) return 'underperforming';
  return 'par';
}

/** Press stance derived from media sentiment and pressure. */
function pressStanceOf(state: ManagerState): 'friendly' | 'neutral' | 'hostile' {
  const s = state.sentiment;
  if (s.media >= 62 && s.pressure < 45) return 'friendly';
  if (s.media <= 40 || s.pressure >= 60) return 'hostile';
  return 'neutral';
}

// -------------------------------------------------------------- context

/** Build a pure MetaContext describing the manager's current situation. */
export function buildManagerContext(
  state: ManagerState,
  tone: PressTone,
  opponentClubId?: string,
  lastScore?: [number, number],
): MetaContext {
  const userSquad = state.squads[state.userClubId] ?? [];
  const teamStrength = clubStrength(userSquad);

  let opponent: string | undefined;
  let opponentStrength: number | undefined;
  if (opponentClubId) {
    opponent = clubNameOf(state, opponentClubId);
    opponentStrength = clubStrength(state.squads[opponentClubId] ?? []);
  }

  const { star, inForm, outOfForm } = squadNarrative(userSquad);
  const s = state.sentiment;
  const expectationTier = expectationForKind(state.board.target.kind);
  const underdog = opponentStrength !== undefined && teamStrength + 5 < opponentStrength;

  return {
    teamName: clubNameOf(state, state.userClubId),
    managerName: state.managerName || 'the gaffer',
    opponent,
    tone,
    stage: `Season ${state.season} · MD ${state.matchday + 1}`,
    lastScore,
    knockedOut: false,
    star,
    inForm,
    outOfForm,
    matchNumber: state.matchday,
    pressStance: pressStanceOf(state),
    fans: s.fans,
    media: s.media,
    squad: s.squad,
    pressure: s.pressure,
    expectationTier,
    performanceMood: performanceMoodOf(state),
    teamStrength,
    opponentStrength,
    underdog,
  };
}

// -------------------------------------------------------------- morale

/** Apply a morale bundle to sentiment, board confidence and named user players. */
export function applyManagerMorale(state: ManagerState, delta?: MoraleDelta): void {
  if (!delta) return;
  const s = state.sentiment;
  if (delta.fans !== undefined) s.fans = clamp(s.fans + delta.fans);
  if (delta.media !== undefined) s.media = clamp(s.media + delta.media);
  if (delta.squad !== undefined) s.squad = clamp(s.squad + delta.squad);
  if (delta.pressure !== undefined) s.pressure = clamp(s.pressure + delta.pressure);
  if (delta.board !== undefined) state.board.confidence = clamp(state.board.confidence + delta.board);
  if (delta.reputation !== undefined) state.reputation = clamp(state.reputation + delta.reputation, 0, 100);

  const squad = state.squads[state.userClubId] ?? [];
  if (!squad.length) return;

  if (delta.squad !== undefined && delta.squad !== 0) {
    // a whole-squad nudge shifts morale/form a touch for everyone
    const moraleSwing = delta.squad * 0.5;
    const formSwing = delta.squad * 0.3;
    for (const p of squad) {
      p.morale = clamp(p.morale + moraleSwing);
      p.form = clamp(p.form + formSwing);
    }
  }

  if (delta.players?.length) {
    for (const entry of delta.players) {
      const match = squad.find((p) => p.name === entry.name);
      if (match) {
        match.morale = clamp(match.morale + entry.delta);
        match.form = clamp(match.form + entry.delta * 0.5);
      }
    }
  }
}

// -------------------------------------------------------------- press

/** Build a press conference for the current situation. `room` is a background
 *  asset path; '' lets the UI default. */
export function managerPressConference(
  state: ManagerState,
  tone: PressTone,
  opponentClubId?: string,
): PressConference {
  const ctx = buildManagerContext(state, tone, opponentClubId);
  return buildPressConference(ctx, '');
}

// -------------------------------------------------------------- events

/** Roll 0-2 random events for the between-match window. Auto-applies the effect
 *  of any event without choices; returns the ones with choices for the UI.
 *  Also pushes any event message into the inbox and any headline into the feed. */
export function rollManagerEvents(state: ManagerState, tone: PressTone, rng: Rng): MetaEvent[] {
  const ctx = buildManagerContext(state, tone);
  const rolled = rollEvents(ctx, () => rng.next(), 2);
  const withChoices: MetaEvent[] = [];
  for (const ev of rolled) {
    if (ev.message) {
      pushManagerMessage(state, {
        from: ev.message.from,
        senderType: ev.message.senderType,
        text: ev.message.text,
        replies: ev.message.replies,
        requiresResponse: ev.message.requiresResponse,
      });
    }
    if (ev.headline) {
      addManagerHeadline(state, { title: ev.headline, tone: 'neutral' });
    }
    if (ev.choices?.length) {
      withChoices.push(ev);
    } else if (ev.effect) {
      applyManagerMorale(state, ev.effect);
    }
  }
  return withChoices;
}

// -------------------------------------------------------------- inbox + headlines

/** Push a phone message, filling time/order from the current matchday. */
export function pushManagerMessage(
  state: ManagerState,
  partial: {
    from: string;
    senderType: SenderType;
    text: string;
    time?: string;
    order?: number;
    replies?: PhoneReply[];
    requiresResponse?: boolean;
  },
): void {
  pushMessage(state.inbox, {
    from: partial.from,
    senderType: partial.senderType,
    text: partial.text,
    time: partial.time ?? `MD ${state.matchday + 1}`,
    order: partial.order ?? (state.matchday * 100 + state.inbox.messages.length),
    replies: partial.replies,
    requiresResponse: partial.requiresResponse,
  });
}

/** Append a news headline; trimmed to the last 60. Monotonic id (no Date). */
export function addManagerHeadline(
  state: ManagerState,
  h: { title: string; source?: string; tone?: 'positive' | 'negative' | 'neutral' | 'sensational'; body?: string },
): void {
  const id = `h_${state.headlines.length + 1}_${state.season}`;
  state.headlines.push({
    id,
    title: h.title,
    source: h.source ?? 'Back Page',
    tone: h.tone ?? 'neutral',
    body: h.body,
    season: state.season,
  });
  if (state.headlines.length > 60) state.headlines = state.headlines.slice(-60);
}

// -------------------------------------------------------------- match narrative

/** Called by the engine after the user's match: chairman reaction + headline. */
export function recordUserMatchNarrative(
  state: ManagerState,
  score: [number, number],
  opponentClubId: string,
  rng: Rng,
): void {
  const fx = state.pendingUserFixture;
  const userIsHome = fx ? fx.homeClubId === state.userClubId : true;
  const [hg, ag] = score;
  const userGoals = userIsHome ? hg : ag;
  const oppGoals = userIsHome ? ag : hg;
  const opponentName = clubNameOf(state, opponentClubId);
  const margin = userGoals - oppGoals;
  const result: 'win' | 'loss' | 'draw' = margin > 0 ? 'win' : margin < 0 ? 'loss' : 'draw';
  const heavy = Math.abs(margin) >= 3;

  // chairman message — club-flavoured, mirrors cup pushResultMessages tone
  let chairmanText: string;
  if (result === 'win') {
    const lines = [
      `Excellent. That's how you get the crowd on side. Onward.`,
      `Three points. That's what you're here for. Keep it going.`,
      `A proper performance. The board is pleased — don't let it slip now.`,
    ];
    chairmanText = lines[rng.int(lines.length)];
  } else if (result === 'loss') {
    const lines = [
      `That isn't good enough. I expect a reaction next time out.`,
      `Supporters pay good money to watch that. Sort it.`,
      `The boardroom is restless. Results need to turn, quickly.`,
    ];
    chairmanText = lines[rng.int(lines.length)];
  } else {
    const lines = [
      `A point. Not disaster, not delight. We need more.`,
      `Work to do. Let's not make a habit of settling.`,
      `Even keel for now. The next one has to be a win.`,
    ];
    chairmanText = lines[rng.int(lines.length)];
  }

  pushManagerMessage(state, {
    from: `${clubNameOf(state, state.userClubId)} · Chairman`,
    senderType: 'chairman',
    text: `${chairmanText} ${result === 'win' ? 'Well done against' : 'Against'} ${opponentName}, ${userGoals}-${oppGoals}.`,
  });

  // headline — win positive, loss negative (sensational if heavy), draw neutral
  let title: string;
  let tone: 'positive' | 'negative' | 'neutral' | 'sensational';
  if (result === 'win') {
    title = heavy
      ? `${clubNameOf(state, state.userClubId)} rout ${opponentName} ${userGoals}-${oppGoals}`
      : `${clubNameOf(state, state.userClubId)} see off ${opponentName}`;
    tone = 'positive';
  } else if (result === 'loss') {
    title = heavy
      ? `Crisis deepens as ${clubNameOf(state, state.userClubId)} humbled by ${opponentName}`
      : `${clubNameOf(state, state.userClubId)} beaten at ${opponentName}`;
    tone = heavy ? 'sensational' : 'negative';
  } else {
    title = `${clubNameOf(state, state.userClubId)} held by ${opponentName}, ${userGoals}-${oppGoals}`;
    tone = 'neutral';
  }
  addManagerHeadline(state, { title, tone });
}

// -------------------------------------------------------------- seed inbox

/** Called once at career creation: seed the inbox with a welcome from the
 *  chairman, the assistant and an agent. */
export function seedManagerInbox(state: ManagerState): void {
  const clubName = clubNameOf(state, state.userClubId);
  const target = state.board.target;

  pushManagerMessage(state, {
    from: `${clubName} · Chairman`,
    senderType: 'chairman',
    text: `Welcome to ${clubName}. The brief is simple: ${target.description.toLowerCase()}. The board is behind you — now go and deliver.`,
    order: 0,
  });

  pushManagerMessage(state, {
    from: 'Assistant',
    senderType: 'assistant',
    text: `Gaffer. Squad's ready when you are. Shout if you want my read on the lads before we crack on.`,
    order: 1,
  });

  pushManagerMessage(state, {
    from: 'Agent — Coyle',
    senderType: 'agent',
    text: `Heard you'd taken the ${clubName} job. Congratulations. If you ever need bodies in — or out — you've got my number.`,
    order: 2,
  });
}
