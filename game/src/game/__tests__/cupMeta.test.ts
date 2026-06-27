import { describe, expect, it } from 'vitest';
import {
  careerMomentumForTeam, newCareer, ensureCareerSystems, playerStateKey, userStarterForm,
  isPlayerUnavailable, careerStarterIndexes, markPlayerUnavailable,
} from '../career';
import {
  seedTournamentInbox, recordUserMatchForm, applyMoraleDelta, recomputeUnhappy,
  generateRoundMeta, pushResultMessages, buildContext, userTeamName, userManagerName, recordPressConferenceNarrative,
} from '../cupMeta';
import { activeArcHeat } from '../cupNarrative';
import { TEAMS } from '../../data/teams';
import { Rng } from '../../sim/rng';
import { overallRating } from '../../sim/formations';

function cupCareer() {
  const c = newCareer('cup', 0, 12345, 'international-cup');
  c.leagueId = 'international-cup';
  ensureCareerSystems(c);
  return c;
}

function cupCareerFor(teamId: string) {
  const idx = TEAMS.findIndex((team) => team.id === teamId);
  expect(idx).toBeGreaterThanOrEqual(0);
  const c = newCareer('cup', idx, 12345, 'international-cup');
  c.leagueId = 'international-cup';
  ensureCareerSystems(c);
  return c;
}

describe('cup meta', () => {
  it('seeds a welcome inbox', () => {
    const c = cupCareer();
    seedTournamentInbox(c);
    expect(c.inbox!.messages.length).toBeGreaterThanOrEqual(3);
    expect(c.inbox!.messages.some((m) => m.senderType === 'chairman')).toBe(true);
  });

  it('lifts starter form after a win and drops it after a loss', () => {
    const c = cupCareer();
    const teamId = TEAMS[0].id;
    const starter = c.squads[teamId][1].name; // an outfield starter
    const key = playerStateKey(teamId, starter);
    c.playerStates[key].form = 50;
    recordUserMatchForm(c, [3, 0], [starter], new Rng(1));
    const afterWin = c.playerStates[key].form;
    expect(afterWin).toBeGreaterThan(50);

    c.playerStates[key].form = 50;
    recordUserMatchForm(c, [0, 3], [starter], new Rng(1));
    expect(c.playerStates[key].form).toBeLessThan(50);
  });

  it('moves squad mood with results', () => {
    const c = cupCareer();
    const fans0 = c.sentiment!.fans;
    recordUserMatchForm(c, [2, 0], c.squads[TEAMS[0].id].slice(0, 11).map((p) => p.name), new Rng(2));
    expect(c.sentiment!.fans).toBeGreaterThan(fans0);
  });

  it('applies a morale delta and flags low-morale players as unhappy', () => {
    const c = cupCareer();
    const teamId = TEAMS[0].id;
    const name = c.squads[teamId][5].name;
    applyMoraleDelta(c, { players: [{ name, delta: -60 }], fans: -10 });
    recomputeUnhappy(c);
    expect(c.unhappy).toContain(name);
    expect(c.sentiment!.fans).toBeLessThan(60);
  });

  it('turns press and event morale into International Cup momentum', () => {
    const c = cupCareer();
    const before = careerMomentumForTeam(c, c.userTeam);

    applyMoraleDelta(c, { squad: 10, fans: 6, media: 4, pressure: -5 });

    expect(careerMomentumForTeam(c, c.userTeam)).toBeGreaterThan(before);
  });

  it('marks rested injury-scare players unavailable for the next match only', () => {
    const c = cupCareer();
    const teamId = TEAMS[c.userTeam].id;
    const name = c.squads[teamId][1].name;

    applyMoraleDelta(c, {
      availability: [{ name, unavailableMatches: 1, reason: 'Tight hamstring' }],
    });

    const state = c.playerStates[playerStateKey(teamId, name)];
    expect(state.unavailableUntilStep).toBe(c.step + 1);
    expect(state.unavailableReason).toBe('Tight hamstring');
    expect(isPlayerUnavailable(c, teamId, name)).toBe(true);

    c.step += 1;

    expect(isPlayerUnavailable(c, teamId, name)).toBe(false);
  });

  it('excludes unavailable players from the next career starter indexes', () => {
    const c = cupCareer();
    const teamId = TEAMS[c.userTeam].id;
    const blockedName = c.starters[1];
    const blockedIdx = c.squads[teamId].findIndex((p) => p.name === blockedName);

    applyMoraleDelta(c, {
      availability: [{ name: blockedName, unavailableMatches: 1, reason: 'Tight hamstring' }],
    });

    const starters = careerStarterIndexes(c, c.formation);

    expect(blockedIdx).toBeGreaterThanOrEqual(0);
    expect(starters).toHaveLength(11);
    expect(starters).not.toContain(blockedIdx);
  });

  it('exposes per-index starter form for the match builder', () => {
    const c = cupCareer();
    const teamId = TEAMS[0].id;
    c.playerStates[playerStateKey(teamId, c.squads[teamId][0].name)].form = 90;
    const map = userStarterForm(c);
    expect(map[0]).toBe(90);
  });

  it('generates between-round events and may push phone messages', () => {
    const c = cupCareer();
    const before = c.inbox!.messages.length;
    // run several windows; over many seeds at least one message should arrive
    let pushed = false;
    for (let s = 0; s < 8; s++) {
      generateRoundMeta(c, 'pre-match', new Rng(s + 1));
      if (c.inbox!.messages.length > before) pushed = true;
    }
    expect(pushed).toBe(true);
  });

  it('builds a press context from career state', () => {
    const c = cupCareer();
    const ctx = buildContext(c, 'pre-match', 'Brazil');
    expect(ctx.teamName).toBe(userTeamName(c));
    expect(ctx.opponent).toBe('Brazil');
    expect(ctx.star).toBeTruthy();
  });

  it('does not describe a left-out or unavailable player as the difference-maker', () => {
    const c = cupCareer();
    const teamId = TEAMS[c.userTeam].id;
    const fullSquadStar = [...c.squads[teamId]].sort((a, b) => overallRating(b) - overallRating(a))[0];
    c.starters = c.squads[teamId]
      .filter((p) => p.name !== fullSquadStar.name)
      .slice(0, 11)
      .map((p) => p.name);

    const ctx = buildContext(c, 'post-win', 'Brazil', [2, 0]);

    expect(c.starters).not.toContain(fullSquadStar.name);
    expect(ctx.star).not.toBe(fullSquadStar.name);
  });

  it('uses the saved International Cup manager name in context and headlines', () => {
    const c = cupCareer();
    c.managerName = 'Riley Stone';

    expect(userManagerName(c)).toBe('Riley Stone');
    expect(buildContext(c, 'pre-match', 'Brazil').managerName).toBe('Riley Stone');

    recordPressConferenceNarrative(c, {
      total: { media: -2 },
      answers: [{
        id: 'manager-name',
        text: 'We know what is coming.',
        tone: 'defiant',
        effect: { media: -2 },
        narrative: { headline: { title: '{manager} raises stakes before {opponent}', source: 'Back Page', tone: 'sensational' } },
      }],
    }, 'pre-match', 'Brazil');

    expect(c.cupNarrative!.headlines[0].title).toBe('Riley Stone raises stakes before Brazil');
  });

  it('adds expectation and performance context for opponent-specific press', () => {
    const c = cupCareerFor('cape-verde');
    const ctx = buildContext(c, 'post-draw', 'Brazil', [1, 1]);
    expect(ctx.expectationTier).toBe('minnow');
    expect(ctx.opponentTier).toBe('favourite');
    expect(ctx.performanceMood).toBe('heroic');
    expect(ctx.underdog).toBe(true);
    expect(ctx.pressStance).toBe('friendly');
  });

  it('marks the press hostile when media mood collapses', () => {
    const c = cupCareer();
    c.sentiment!.media = 22;
    const ctx = buildContext(c, 'pre-match', 'Brazil');
    expect(ctx.pressStance).toBe('hostile');
  });

  it('drops a result message into the inbox', () => {
    const c = cupCareer();
    pushResultMessages(c, [0, 2], 'Italy', new Rng(3));
    expect(c.inbox!.messages.some((m) => m.text.includes('Italy'))).toBe(true);
  });

  it('creates headlines and arcs from poor results', () => {
    const c = cupCareer();
    recordUserMatchForm(c, [0, 3], c.squads[TEAMS[0].id].slice(0, 11).map((p) => p.name), new Rng(4));
    pushResultMessages(c, [0, 3], 'Italy', new Rng(5));
    generateRoundMeta(c, 'post-loss', new Rng(9));
    expect(c.cupNarrative!.headlines.length).toBeGreaterThan(0);
    expect(activeArcHeat(c, 'board-pressure')).toBeGreaterThan(0);
  });

  it('turns a favourite failing against a minnow into pressure and federation panic', () => {
    const c = cupCareerFor('brazil');
    const opponentIdx = TEAMS.findIndex((team) => team.id === 'cape-verde');
    pushResultMessages(c, [1, 1], 'Cape Verde', new Rng(10), opponentIdx);

    expect(activeArcHeat(c, 'favourite-pressure')).toBeGreaterThan(0);
    expect(activeArcHeat(c, 'federation-panic')).toBeGreaterThan(0);
    expect(c.cupNarrative!.headlines[0].tone).toMatch(/negative|sensational/);
    expect(c.cupNarrative!.headlines[0].title.toLowerCase()).toMatch(/held|crisis|question|alarm/);
  });

  it('turns a minnow matching a favourite into a fairytale arc', () => {
    const c = cupCareerFor('cape-verde');
    const opponentIdx = TEAMS.findIndex((team) => team.id === 'brazil');
    pushResultMessages(c, [1, 1], 'Brazil', new Rng(11), opponentIdx);

    expect(activeArcHeat(c, 'fairytale-run')).toBeGreaterThan(0);
    expect(activeArcHeat(c, 'one-result-from-history')).toBeGreaterThanOrEqual(0);
    expect(c.cupNarrative!.headlines[0].tone).toBe('positive');
    expect(c.cupNarrative!.headlines[0].title.toLowerCase()).toMatch(/fairytale|believe|history|dream/);
  });

  it('a recorded injury makes the player unavailable next match', () => {
    const c = newCareer('cup', 0, 12345, 'international-cup');
    c.leagueId = 'international-cup';
    ensureCareerSystems(c);
    const teamId = TEAMS[c.userTeam].id;
    const name = c.squads[teamId][5].name;
    markPlayerUnavailable(c, teamId, name, 2, 'Injured');
    expect(isPlayerUnavailable(c, teamId, name)).toBe(true);
  });

  it('limits required messages generated in a normal round window', () => {
    const c = cupCareer();
    generateRoundMeta(c, 'post-loss', new Rng(12));
    const required = c.inbox!.messages.filter((m) => m.requiresResponse && !m.replied);
    expect(required.length).toBeLessThanOrEqual(1);
  });

  it('turns selected press answers into narrative arcs and headlines', () => {
    const c = cupCareer();
    recordPressConferenceNarrative(c, {
      total: { media: -3 },
      answers: [{
        id: 'a1',
        text: 'We answer on the pitch.',
        tone: 'defiant',
        effect: { media: -3 },
        narrative: { headline: { title: '{manager} fires back before {opponent}', source: 'Back Page', tone: 'sensational' } },
      }],
    }, 'pre-match', 'Brazil');
    expect(activeArcHeat(c, 'press-feud')).toBeGreaterThan(0);
    expect(c.cupNarrative!.headlines[0].title).toContain('Brazil');
  });
});
