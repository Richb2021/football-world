/**
 * International Cup meta layer glue: turns match results into form/morale/mood
 * changes, generates between-round jeopardy + phone messages, and builds the
 * contexts the shared press-conference module consumes.
 */
import { TEAMS } from '../data/teams';
import { fakeManagerName } from '../data/names';
import { Rng } from '../sim/rng';
import type { TeamData } from '../sim/types';
import type { Career } from './career';
import { adjustCareerMomentumForTeam, ensureCareerSystems, isPlayerUnavailable, markPlayerUnavailable, playerStateKey } from './career';
import type { MetaContext, MetaEvent, MoraleDelta, PressResult, PressTone } from '../meta/metaTypes';
import { rollEvents } from '../meta/randomEvents';
import { pushMessage } from '../meta/phone';
import { overallRating } from '../sim/formations';
import {
  activeArcHeat,
  addCupHeadline,
  assessMatchPerformance,
  cappedOffFieldMomentumDelta,
  ensureCupNarrative,
  heatCupArc,
  type CupNarrativeArcType,
  type MatchPerformanceContext,
  teamNarrativeProfile,
} from './cupNarrative';

const clamp = (v: number, a = 0, b = 100) => Math.min(b, Math.max(a, v));

export function userTeamId(career: Career): string { return TEAMS[career.userTeam].id; }
export function userTeamName(career: Career): string { return TEAMS[career.userTeam].name; }
export function sanitizeManagerName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
export function userManagerName(career: Career): string {
  return sanitizeManagerName(career.managerName) || fakeManagerName(userTeamId(career));
}

/** A friendly label for when something happened, used on phone messages. */
export function metaTimeLabel(career: Career): string {
  const total = career.step + 1;
  return `MD ${total}`;
}

/** The squad's current star (highest-rated) and most out-of-form starter names. */
export function squadFocus(career: Career): { star: string; outOfForm: string } {
  ensureCareerSystems(career);
  const teamId = userTeamId(career);
  const squad = career.squads[teamId] ?? [];
  const selectedNames = new Set(career.starters ?? []);
  const selectedAvailable = squad.filter((p) => selectedNames.has(p.name) && !isPlayerUnavailable(career, teamId, p.name));
  const available = squad.filter((p) => !isPlayerUnavailable(career, teamId, p.name));
  const focusPool = selectedAvailable.length ? selectedAvailable : available.length ? available : squad;
  const star = [...focusPool].sort((a, b) => overallRating(b) - overallRating(a))[0]?.name ?? 'the captain';
  const forms = focusPool.map((p) => ({ name: p.name, form: career.playerStates[playerStateKey(teamId, p.name)]?.form ?? 50 }));
  const outOfForm = forms.sort((a, b) => a.form - b.form)[0]?.name ?? star;
  return { star, outOfForm };
}

function teamByOpponent(opponentName?: string, opponentIdx?: number): TeamData | undefined {
  if (typeof opponentIdx === 'number') return TEAMS[opponentIdx];
  if (!opponentName) return undefined;
  const needle = opponentName.trim().toLowerCase();
  return TEAMS.find((team) => (
    team.name.toLowerCase() === needle
    || team.short.toLowerCase() === needle
    || team.id.toLowerCase() === needle
  ));
}

export function buildContext(career: Career, tone: PressTone, opponentName?: string, lastScore?: [number, number]): MetaContext {
  ensureCareerSystems(career);
  const team = TEAMS[career.userTeam];
  const opponentTeam = teamByOpponent(opponentName);
  const teamProfile = teamNarrativeProfile(team);
  const opponentProfile = opponentTeam ? teamNarrativeProfile(opponentTeam) : undefined;
  const performance = opponentTeam && lastScore
    ? assessMatchPerformance(team, opponentTeam, lastScore, Math.max(0, career.step - 1))
    : undefined;
  const focus = squadFocus(career);
  const sentiment = career.sentiment!;
  const pressHeat = activeArcHeat(career, 'press-feud') + activeArcHeat(career, 'selection-scrutiny');
  const defaultPressStance = sentiment.media < 38 || pressHeat >= 35 || tone === 'crisis'
    ? 'hostile'
    : sentiment.media > 68 && tone !== 'post-loss'
      ? 'friendly'
      : 'neutral';
  const pressStance = performance?.mood === 'collapse'
    || (performance?.mood === 'underperforming' && ['favourite', 'contender'].includes(teamProfile.expectationTier))
    ? 'hostile'
    : (performance?.mood === 'heroic' || (performance?.mood === 'overperforming' && teamProfile.expectationTier !== 'favourite'))
      ? 'friendly'
      : defaultPressStance;
  return {
    teamName: userTeamName(career),
    managerName: userManagerName(career),
    opponent: opponentName,
    tone,
    stage: stageLabel(career),
    lastScore,
    knockedOut: !career.cupAlive,
    unhappy: career.unhappy,
    star: focus.star,
    outOfForm: focus.outOfForm,
    inForm: focus.star,
    matchNumber: career.step,
    pressStance,
    fans: sentiment.fans,
    media: sentiment.media,
    squad: sentiment.squad,
    pressure: sentiment.pressure,
    expectationTier: teamProfile.expectationTier,
    opponentTier: opponentProfile?.expectationTier,
    performanceMood: performance?.mood,
    teamStrength: teamProfile.strength,
    opponentStrength: opponentProfile?.strength,
    underdog: !!opponentProfile && teamProfile.strength + 5 < opponentProfile.strength,
  };
}

export function stageLabel(career: Career): string {
  const ev = career.calendar[career.step];
  if (!ev) return 'The Tournament';
  if (ev.kind === 'league') return `Group Stage · Matchday ${ev.round + 1}`;
  if (ev.kind === 'cup') return career.cupRounds[ev.round]?.name ?? 'Knockout';
  return 'Transfer Window';
}

/** Apply a press/event morale bundle to the career's mood + players. */
export function applyMoraleDelta(career: Career, delta?: MoraleDelta): void {
  if (!delta) return;
  ensureCareerSystems(career);
  const s = career.sentiment!;
  s.fans = clamp(s.fans + (delta.fans ?? 0));
  s.media = clamp(s.media + (delta.media ?? 0));
  s.squad = clamp(s.squad + (delta.squad ?? 0));
  s.pressure = clamp(s.pressure + (delta.pressure ?? 0));
  if (delta.board) career.board.confidence = clamp(career.board.confidence + delta.board);
  const teamId = userTeamId(career);
  if (career.leagueId === 'international-cup') {
    const playerMood = (delta.players ?? []).reduce((sum, pl) => sum + pl.delta, 0) * 0.015;
    const rawMomentumDelta =
      (delta.squad ?? 0) * 0.08
      + (delta.fans ?? 0) * 0.04
      + (delta.media ?? 0) * 0.035
      + (delta.board ?? 0) * 0.03
      - (delta.pressure ?? 0) * 0.045
      + playerMood;
    const momentumDelta = cappedOffFieldMomentumDelta(rawMomentumDelta);
    if (Math.abs(momentumDelta) > 0.01) adjustCareerMomentumForTeam(career, career.userTeam, momentumDelta);
  }
  for (const pl of delta.players ?? []) {
    const key = playerStateKey(teamId, pl.name);
    const st = career.playerStates[key];
    if (st) { st.morale = clamp(st.morale + pl.delta); st.form = clamp(st.form + pl.delta * 0.4); }
  }
  for (const availability of delta.availability ?? []) {
    markPlayerUnavailable(
      career,
      teamId,
      availability.name,
      availability.unavailableMatches,
      availability.reason ?? 'OUT NEXT MATCH',
    );
  }
  recomputeUnhappy(career);
}

/** After a user match, move starter form/morale/fitness and the squad mood. */
export function recordUserMatchForm(career: Career, score: [number, number], starters: string[], rng: Rng): void {
  ensureCareerSystems(career);
  const teamId = userTeamId(career);
  const [gf, ga] = score;
  const result = gf > ga ? 'win' : gf < ga ? 'loss' : 'draw';
  const starterSet = new Set(starters);
  const squad = career.squads[teamId] ?? [];
  for (const p of squad) {
    const st = career.playerStates[playerStateKey(teamId, p.name)];
    if (!st) continue;
    if (starterSet.has(p.name)) {
      const swing = result === 'win' ? 6 : result === 'loss' ? -7 : -1;
      st.form = clamp(st.form + swing + rng.range(-2, 3));
      st.morale = clamp(st.morale + swing * 0.7 + rng.range(-1, 2));
      st.fitness = clamp(st.fitness - 8 - rng.range(0, 6), 30, 100);
      st.sharpness = clamp(st.sharpness + 3 + rng.range(0, 2));
    } else {
      // not involved: form drifts toward neutral, a little morale dip for sitting out
      st.form = clamp(st.form + (st.form < 50 ? 1.5 : -1) + rng.range(-1, 1));
      st.morale = clamp(st.morale - 1.5 + rng.range(-1, 1));
      st.fitness = clamp(st.fitness + 4, 30, 100);
    }
  }
  const s = career.sentiment!;
  if (result === 'win') { s.fans = clamp(s.fans + 8); s.squad = clamp(s.squad + 6); s.media = clamp(s.media + 5); s.pressure = clamp(s.pressure - 6); career.board.confidence = clamp(career.board.confidence + 5); }
  else if (result === 'loss') { s.fans = clamp(s.fans - 8); s.squad = clamp(s.squad - 6); s.media = clamp(s.media - 6); s.pressure = clamp(s.pressure + 9); career.board.confidence = clamp(career.board.confidence - 7); }
  else { s.pressure = clamp(s.pressure + 2); }
  if (career.leagueId === 'international-cup') {
    if (result === 'win') {
      heatCupArc(career, 'squad-unity', 5);
      if (gf - ga >= 2 || career.step >= 3) heatCupArc(career, 'underdog-run', 6);
    } else if (result === 'loss') {
      heatCupArc(career, 'press-feud', 4);
      heatCupArc(career, 'board-pressure', ga - gf >= 2 ? 10 : 5);
    } else {
      heatCupArc(career, 'selection-scrutiny', 3);
    }
  }
  recomputeUnhappy(career);
}

/** Players become unhappy when morale dips low; recovered ones drop off. */
export function recomputeUnhappy(career: Career): void {
  ensureCareerSystems(career);
  const teamId = userTeamId(career);
  const squad = career.squads[teamId] ?? [];
  career.unhappy = squad
    .filter((p) => (career.playerStates[playerStateKey(teamId, p.name)]?.morale ?? 60) < 36)
    .map((p) => p.name);
}

function performanceHeadline(
  performance: MatchPerformanceContext,
  rng: Rng,
): { title: string; source: string; tone: 'positive' | 'negative' | 'neutral' | 'sensational'; body: string } {
  const team = performance.team.teamName;
  const opponent = performance.opponent.teamName;
  const [gf, ga] = performance.score;
  const resultWord = gf > ga ? 'win' : gf < ga ? 'defeat' : 'draw';
  const tier = performance.team.expectationTier;
  const highExpectation = tier === 'favourite' || tier === 'contender';
  const underdog = performance.team.strength + 5 < performance.opponent.strength;

  if (performance.mood === 'heroic' && underdog) {
    return rng.pick([
      {
        title: `${team} fairytale grows after ${opponent} ${resultWord}`,
        source: 'World Game Wire',
        tone: 'positive',
        body: 'A result few outside the camp expected has changed the tone of the whole tournament.',
      },
      {
        title: `${team} make believers of a nation against ${opponent}`,
        source: 'Supporters Voice',
        tone: 'positive',
        body: 'The dressing room can feel the country coming with them after a statement result.',
      },
      {
        title: `${team} dream refuses to fade after ${opponent} test`,
        source: 'Tournament Desk',
        tone: 'positive',
        body: 'What began as hope is starting to look like a story with real force behind it.',
      },
    ]);
  }

  if ((performance.mood === 'heroic' || performance.mood === 'overperforming') && (tier === 'minnow' || tier === 'outsider' || tier === 'dark-horse')) {
    return rng.pick([
      {
        title: `${team} turn quiet belief into a tournament statement`,
        source: 'World Game Wire',
        tone: 'positive',
        body: 'The mood around the squad has shifted from cautious hope to visible belief.',
      },
      {
        title: `${team} history talk grows louder after ${opponent} result`,
        source: 'Supporters Voice',
        tone: 'positive',
        body: 'Supporters are allowing themselves to look further down the road after another step forward.',
      },
    ]);
  }

  if ((performance.mood === 'collapse' || performance.mood === 'underperforming') && highExpectation) {
    return rng.pick([
      {
        title: `${team} alarm bells ring after being held by ${opponent}`,
        source: 'Back Page',
        tone: performance.mood === 'collapse' ? 'sensational' : 'negative',
        body: 'For a squad carrying this level of expectation, the performance has turned scrutiny into pressure.',
      },
      {
        title: `${team} standards questioned after ${opponent} setback`,
        source: 'World Game Wire',
        tone: 'negative',
        body: 'The federation expected control. Instead, the next press room may feel like a referendum.',
      },
      {
        title: `${team} crisis talk builds after ${opponent} frustration`,
        source: 'Back Page',
        tone: 'sensational',
        body: 'A result that would be acceptable for many teams lands very differently under this badge.',
      },
    ]);
  }

  if (performance.mood === 'collapse' || performance.mood === 'underperforming') {
    return {
      title: `${team} left searching for answers after ${opponent} ${resultWord}`,
      source: 'Evening Sport',
      tone: 'negative',
      body: 'The result has dented belief and made the next camp decision more important.',
    };
  }

  if (tier === 'favourite' && gf > ga) {
    return {
      title: `${team} handle business as expectations rise`,
      source: 'Tournament Desk',
      tone: 'positive',
      body: 'Winning was expected, but the pressure now shifts to doing it again when the stage gets bigger.',
    };
  }

  return {
    title: `${team} take ${resultWord} from ${opponent} test`,
    source: 'Tournament Desk',
    tone: gf > ga ? 'positive' : gf < ga ? 'negative' : 'neutral',
    body: 'The result adds another thread to a tournament mood still taking shape.',
  };
}

function applyPerformanceNarrative(career: Career, performance: MatchPerformanceContext, rng: Rng): void {
  const tier = performance.team.expectationTier;
  const opponent = performance.opponent.teamName;
  const highExpectation = tier === 'favourite' || tier === 'contender';
  const underdog = performance.team.strength + 5 < performance.opponent.strength;
  const [gf, ga] = performance.score;
  const headline = performanceHeadline(performance, rng);
  addCupHeadline(career, {
    ...headline,
    matchNumber: career.step,
  });

  if ((performance.mood === 'heroic' || performance.mood === 'overperforming') && underdog) {
    heatCupArc(career, 'fairytale-run', performance.mood === 'heroic' ? 14 : 9, { relatedOpponent: opponent });
    heatCupArc(career, 'underdog-run', performance.mood === 'heroic' ? 10 : 6, { relatedOpponent: opponent });
    if (performance.isKnockout || performance.opponent.expectationTier === 'favourite') {
      heatCupArc(career, 'one-result-from-history', 7, { relatedOpponent: opponent });
    }
    applyMoraleDelta(career, {
      fans: tier === 'minnow' ? 7 : 5,
      media: 4,
      squad: 4,
      pressure: tier === 'minnow' ? 2 : 1,
      board: 2,
    });
    return;
  }

  if ((performance.mood === 'collapse' || performance.mood === 'underperforming') && highExpectation) {
    heatCupArc(career, 'favourite-pressure', performance.mood === 'collapse' ? 14 : 8, { relatedOpponent: opponent });
    heatCupArc(career, 'federation-panic', performance.mood === 'collapse' ? 10 : 5, { relatedOpponent: opponent });
    heatCupArc(career, 'press-feud', performance.mood === 'collapse' ? 6 : 3, { relatedOpponent: opponent });
    applyMoraleDelta(career, {
      fans: performance.mood === 'collapse' ? -7 : -4,
      media: performance.mood === 'collapse' ? -6 : -3,
      squad: -2,
      pressure: performance.mood === 'collapse' ? 8 : 5,
      board: performance.mood === 'collapse' ? -5 : -2,
    });
    return;
  }

  if (performance.mood === 'collapse' || performance.mood === 'underperforming') {
    heatCupArc(career, 'selection-scrutiny', ga - gf >= 2 ? 8 : 4, { relatedOpponent: opponent });
    applyMoraleDelta(career, {
      fans: -3,
      media: -2,
      squad: -2,
      pressure: 3,
    });
    return;
  }

  if (gf > ga && highExpectation) {
    heatCupArc(career, 'golden-generation', 4, { relatedOpponent: opponent });
  }
}

/** Drop a result-driven message from a contact into the phone. */
export function pushResultMessages(career: Career, score: [number, number], opponent: string, rng: Rng, opponentIdx?: number): void {
  ensureCareerSystems(career);
  const [gf, ga] = score;
  const time = metaTimeLabel(career);
  const order = career.step * 100 + Math.floor(rng.range(1, 9));
  const opponentTeam = teamByOpponent(opponent, opponentIdx);
  if (opponentTeam) {
    applyPerformanceNarrative(career, assessMatchPerformance(TEAMS[career.userTeam], opponentTeam, score, Math.max(0, career.step - 1)), rng);
  } else {
    addCupHeadline(career, {
      title: gf > ga
        ? `${userTeamName(career)} camp lifted by ${opponent} win`
        : gf < ga
          ? `${userTeamName(career)} under pressure after ${opponent} setback`
          : `${userTeamName(career)} left searching for spark after ${opponent} draw`,
      source: gf > ga ? 'Tournament Desk' : gf < ga ? 'Back Page' : 'Evening Sport',
      tone: gf > ga ? 'positive' : gf < ga ? (ga - gf >= 2 ? 'sensational' : 'negative') : 'neutral',
      body: 'The next response inside camp could shape the rest of the tournament.',
    });
  }
  if (gf > ga) {
    pushMessage(career.inbox!, { from: 'G. Hartley · Chief Exec', senderType: 'chairman', avatarSeed: 'exec_ceo', time, order, text: `Brilliant result against ${opponent}! The whole federation is buzzing. Keep this up and history beckons.` });
  } else if (gf < ga) {
    const msg = pushMessage(career.inbox!, { from: 'G. Hartley · Chief Exec', senderType: 'chairman', avatarSeed: 'exec_ceo', time, order, text: `Disappointing against ${opponent}. We expect a response. The nation is watching.`,
      requiresResponse: true,
      replies: [{ id: 'fix', text: "We'll put it right, I promise.", response: 'Make sure you do.', effect: { board: 3, pressure: 2 } }, { id: 'patience', text: 'Football is a marathon, not a sprint.', response: 'Hmm. Results matter.', effect: { board: -2 } }] });
    ensureCupNarrative(career).requiredMessageIds.push(msg.id);
  } else {
    pushMessage(career.inbox!, { from: 'Assistant', senderType: 'assistant', avatarSeed: 'assistant_coach', time, order, text: `A draw with ${opponent}. We live to fight another day, gaffer. On to the next.` });
  }
}

function arcType(value: string): CupNarrativeArcType | null {
  const valid: CupNarrativeArcType[] = [
    'press-feud',
    'squad-unity',
    'star-pressure',
    'bench-unrest',
    'board-pressure',
    'underdog-run',
    'captain-trust',
    'selection-scrutiny',
    'favourite-pressure',
    'golden-generation',
    'fairytale-run',
    'federation-panic',
    'defensive-backlash',
    'one-result-from-history',
  ];
  return (valid as string[]).includes(value) ? value as CupNarrativeArcType : null;
}

function fillCupTokens(text: string, career: Career, opponent?: string): string {
  const focus = squadFocus(career);
  return text
    .replace(/\{team\}/g, userTeamName(career))
    .replace(/\{manager\}/g, userManagerName(career))
    .replace(/\{opponent\}/g, opponent ?? 'the opposition')
    .replace(/\{star\}/g, focus.star)
    .replace(/\{outOfForm\}/g, focus.outOfForm);
}

export function recordPressConferenceNarrative(career: Career, result: PressResult | undefined, tone: PressTone, opponent?: string): void {
  if (!result || career.leagueId !== 'international-cup') return;
  ensureCareerSystems(career);
  ensureCupNarrative(career);
  for (const answer of result.answers) {
    if (answer.tone === 'fiery' || answer.tone === 'defiant' || answer.tone === 'sarcastic') heatCupArc(career, 'press-feud', 8, { relatedOpponent: opponent });
    if (answer.tone === 'protective') heatCupArc(career, 'squad-unity', 6);
    if (answer.tone === 'private' || answer.tone === 'calm' || answer.tone === 'diplomatic') heatCupArc(career, 'captain-trust', 3);
    const narrativeArc = answer.narrative?.arc ? arcType(answer.narrative.arc.type) : null;
    if (narrativeArc) heatCupArc(career, narrativeArc, answer.narrative!.arc!.heat, { relatedOpponent: opponent });
    const headline = answer.narrative?.headline;
    if (headline?.title) {
      addCupHeadline(career, {
        title: fillCupTokens(headline.title, career, opponent),
        source: headline.source ?? 'Back Page',
        tone: headline.tone ?? 'neutral',
        body: headline.body ? fillCupTokens(headline.body, career, opponent) : undefined,
      });
    } else if (tone === 'post-loss' && (answer.tone === 'defiant' || answer.tone === 'fiery')) {
      addCupHeadline(career, {
        title: `${userManagerName(career)} refuses to back down after ${opponent ?? 'setback'}`,
        source: 'Back Page',
        tone: 'sensational',
      });
    }
    const message = answer.narrative?.message;
    if (message) {
      const pushed = pushMessage(career.inbox!, {
        from: message.from,
        senderType: message.senderType,
        text: fillCupTokens(message.text, career, opponent),
        replies: message.replies,
        requiresResponse: message.requiresResponse,
        time: metaTimeLabel(career),
        order: career.step * 100 + 40 + result.answers.indexOf(answer),
      });
      if (message.requiresResponse) career.cupNarrative!.requiredMessageIds.push(pushed.id);
    }
  }
}

/** Roll between-round events. Auto-applies no-choice events; returns the ones
 * that need a player decision for the UI to present. */
export function generateRoundMeta(career: Career, tone: PressTone, rng: Rng, opponentName?: string, lastScore?: [number, number]): MetaEvent[] {
  ensureCareerSystems(career);
  const narrative = ensureCupNarrative(career);
  const ctx = buildContext(career, tone, opponentName, lastScore);
  const events = rollEvents(ctx, () => rng.next(), 2);
  const pending: MetaEvent[] = [];
  let n = 0;
  let requiredAdded = narrative.requiredMessageIds
    .filter((id) => career.inbox!.messages.some((m) => m.id === id && m.requiresResponse && !m.replied))
    .length;
  for (const e of events) {
    if (e.headline) {
      addCupHeadline(career, {
        title: e.headline,
        source: e.senderType === 'media' || e.senderType === 'pundit' ? 'Back Page' : 'Tournament Desk',
        tone: e.senderType === 'media' || e.senderType === 'pundit' ? 'sensational' : 'neutral',
      });
    }
    if (e.message) {
      const requiresResponse = !!e.message.requiresResponse && requiredAdded < 1;
      const msg = pushMessage(career.inbox!, {
        from: e.message.from,
        senderType: e.message.senderType,
        text: e.message.text,
        replies: e.message.replies,
        requiresResponse,
        time: metaTimeLabel(career),
        order: career.step * 100 + (++n),
      });
      if (requiresResponse) {
        narrative.requiredMessageIds.push(msg.id);
        requiredAdded++;
      }
    }
    if (e.choices?.length) {
      pending.push(e);
      if (e.senderType === 'teammate' || e.senderType === 'captain' || e.senderType === 'assistant') {
        if (!narrative.pendingTeamEvents.includes(e.id)) narrative.pendingTeamEvents.push(e.id);
      }
    }
    else applyMoraleDelta(career, e.effect);
  }
  if (!pending.length && activeArcHeat(career, 'board-pressure') >= 8 && requiredAdded < 1) {
    const msg = pushMessage(career.inbox!, {
      from: 'G. Hartley · Chief Exec',
      senderType: 'chairman',
      avatarSeed: 'exec_ceo',
      time: metaTimeLabel(career),
      order: career.step * 100 + 30,
      text: 'We need to understand the plan from here. Say the right thing publicly, but make sure the players believe it privately.',
      requiresResponse: true,
      replies: [
        { id: 'public', text: 'I will front up and protect the group.', response: 'Good. Leadership matters now.', effect: { board: 2, squad: 2, pressure: -1 } },
        { id: 'results', text: 'No speeches. The next result fixes it.', response: 'That had better be true.', effect: { board: -2, pressure: 2 } },
      ],
    });
    narrative.requiredMessageIds.push(msg.id);
  }
  narrative.lastGeneratedStep = career.step;
  recomputeUnhappy(career);
  return pending;
}

/** A welcome message bundle when the cup begins. */
export function seedTournamentInbox(career: Career): void {
  ensureCareerSystems(career);
  const focus = squadFocus(career);
  pushMessage(career.inbox!, { from: 'G. Hartley · Chief Exec', senderType: 'chairman', avatarSeed: 'exec_ceo', time: 'Pre-Tournament', order: 1,
    text: `Welcome aboard for the International Cup. The whole nation dreams of glory. Get us out of the group and we'll all be very happy. Anything less... well, let's not think about that.`,
    replies: [{ id: 'win', text: "We're winning the whole thing.", response: 'Bold! I like it.', effect: { board: 4, pressure: 5 } }, { id: 'humble', text: 'One game at a time.', response: 'Sensible. Good luck.', effect: { board: 2, pressure: -2 } }] });
  pushMessage(career.inbox!, { from: 'Agent — Coyle', senderType: 'agent', avatarSeed: 'agent_coyle', time: 'Pre-Tournament', order: 2,
    text: `Massive tournament for ${focus.star}, and the whole country's watching how you use him. Keep my man in the side and starting — this is where reputations get made. Don't waste it.` });
  pushMessage(career.inbox!, { from: 'Home', senderType: 'family', avatarSeed: 'home_family', time: 'Pre-Tournament', order: 3,
    text: `So proud of you leading the nation out. Go and make us all dream. We'll be watching every kick. x` });
}
