import { afterEach, describe, expect, it } from 'vitest';
import { TEAMS } from '../../data/teams';
import type { MatchConfig, MatchState, SimEvent } from '../../sim/types';
import { autoLineup } from '../../sim/formations';
import {
  COMMENTARY_CATALOG,
  buildAmbientCommentaryLines,
  buildEventCommentaryLines,
  buildMatchIntroLines,
  buildMatchIntroSequence,
  buildPrematchLineupLines,
  planCommentaryStitches,
  playerCallName,
  playerFullNameClipId,
  playerNameClipId,
  scoreNumberClipId,
  setAvailableClipIds,
  stadiumNameClipId,
  teamNameClipId,
} from '../commentary';

function makeCfg(): MatchConfig {
  const home = TEAMS[0];
  const away = TEAMS[1];
  return {
    teams: [
      { data: home, lineup: { formation: '4-4-2', starters: autoLineup(home.players, '4-4-2') }, kit: home.colors.home, controller: 'human' },
      { data: away, lineup: { formation: '4-4-2', starters: autoLineup(away.players, '4-4-2') }, kit: away.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 60,
    difficulty: 1,
    cupTie: false,
    seed: 42,
  };
}

function makeState(cfg: MatchConfig): MatchState {
  return {
    phase: 'play',
    tick: 0,
    clock: 0,
    half: 1,
    score: [0, 0],
    goals: [],
    ball: { pos: { x: 0, y: 0 }, z: 0, vel: { x: 0, y: 0 }, vz: 0, spin: 0, kickDir: { x: 1, y: 0 }, ownerIdx: -1, lastTouchTeam: 0, lastKicker: -1 },
    players: cfg.teams.flatMap((team, teamIdx) => team.lineup.starters.map((squadIdx, slotIdx) => ({
      idx: teamIdx * 11 + slotIdx,
      team: teamIdx as 0 | 1,
      attrs: team.data.players[squadIdx],
      squadIdx,
      isGK: slotIdx === 0,
      slot: { x: 0, y: 0 },
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      facing: 0,
      stamina: 1,
      staminaCeiling: 1,
      control: false,
      yellowCards: 0,
      foulsCommitted: 0,
      sentOff: false,
      kickCooldown: 0,
      slideTimer: 0,
      anim: 'idle' as const,
    }))),
    attackDir: [1, -1],
    restartTeam: 0,
    restartPos: { x: 0, y: 0 },
    restartTimer: 0,
    controlledIdx: [1, -1],
    substitutionsUsed: [0, 0],
    subbedOff: [[], []],
    subbedOn: [[], []],
    penalties: null,
    penaltyAim: 0,
    excitement: 0,
    momentum: [0, 0],
    winner: -1,
  };
}

afterEach(() => {
  setAvailableClipIds(null);
});

describe('commentary catalogue', () => {
  it('has enough prepared phrase variety for commentator and pundit roles', () => {
    expect(COMMENTARY_CATALOG.people.commentator).toBe('Malcolm Grange');
    expect(COMMENTARY_CATALOG.people.pundit).toBe('Jimmy Michaels');
    expect(COMMENTARY_CATALOG.phrases.length).toBeGreaterThanOrEqual(100);
    expect(COMMENTARY_CATALOG.phrases.some((p) => p.speaker === 'commentator' && p.category === 'goal')).toBe(true);
    expect(COMMENTARY_CATALOG.phrases.some((p) => p.speaker === 'pundit' && p.category === 'analysis')).toBe(true);
  });

  it('uses stable clip ids for team and player name variants', () => {
    expect(teamNameClipId('man-united', 'big')).toBe('team.man-united.big');
    expect(stadiumNameClipId('man-united')).toBe('stadium.man-united.calm');
    expect(playerNameClipId('man-united', 'Eric Cantona', 'excited')).toBe('player.man-united.eric-cantona.excited');
    expect(scoreNumberClipId(3, 'big')).toBe('number.3.big');
  });

  it('uses base spoken team ids for historical season variants so the year is not spoken', () => {
    expect(teamNameClipId('teesside-96', 'calm')).toBe('team.teesside.calm');
    expect(teamNameClipId('tyneside-95', 'big')).toBe('team.tyneside.big');
    expect(stadiumNameClipId('teesside-96')).toBe('stadium.teesside.calm');
    expect(playerNameClipId('highbury-95', 'David Seeman', 'calm')).toBe('player.highbury.david-seeman.calm');
    expect(playerFullNameClipId('highbury-95', 'David Seeman', 'big')).toBe('player-full.highbury.david-seeman.big');
  });

  it('reuses available historical player clips when a season pack has no exact player audio', () => {
    const cfg = makeCfg();
    cfg.teams[0] = { ...cfg.teams[0], data: { ...cfg.teams[0].data, id: 'tyneside-95' } };
    const state = makeState(cfg);
    const passer = state.players.find((p) => p.team === 0 && !p.isGK)!;
    const receiver = state.players.find((p) => p.team === 0 && p !== passer && !p.isGK)!;
    passer.attrs = { ...passer.attrs, name: 'Pavel Srniceke' };
    receiver.attrs = { ...receiver.attrs, name: 'Shay Givene' };
    setAvailableClipIds(new Set([
      'phrase.commentator.pass.to.01',
      'player.tyneside-96.pavel-srniceke.calm',
      'player.tyneside-96.shay-givene.calm',
    ]));

    const lines = buildEventCommentaryLines([{ type: 'pass', team: 0, player: passer.idx, target: receiver.idx }], state, cfg, 0);

    expect(lines[0].ids).toContain('player.tyneside-96.pavel-srniceke.calm');
    expect(lines[0].ids).toContain('player.tyneside-96.shay-givene.calm');
    expect(lines[0].ids).toContain('phrase.commentator.pass.to.01');
  });

  it('uses surname-led spoken names for player call clips', () => {
    expect(playerCallName('Eric Cantona')).toBe('Cantona');
    expect(playerCallName('Chris Bart-Williams')).toBe('Bart-Williams');
    expect(playerCallName('Preki')).toBe('Preki');
  });

  it('keeps direct goal-call phrases as shouted exclamations', () => {
    const directGoalPhrases = COMMENTARY_CATALOG.phrases.filter((p) => (
      p.speaker === 'commentator'
      && p.category === 'goal'
      && !p.id.includes('.for_team.')
      && !p.id.includes('.scorer.')
      && !p.id.includes('.scorer_')
      && !p.id.includes('.score_')
    ));

    expect(directGoalPhrases.length).toBeGreaterThanOrEqual(8);
    expect(directGoalPhrases.every((p) => p.text.endsWith('!'))).toBe(true);
  });

  it('uses less formal half-time wording', () => {
    const halfTime = COMMENTARY_CATALOG.phrases.find((p) => p.id === 'phrase.commentator.time.half_time.01');
    expect(halfTime?.text).toBe("That's half time.");
    expect(COMMENTARY_CATALOG.phrases.some((p) => /travelling/i.test(p.text))).toBe(false);
  });

  it('builds varied spliceable intro lines with stadium, teams and pundit setup', () => {
    const cfg = makeCfg();
    const lines = buildMatchIntroLines(cfg, 2);
    const ids = lines.flatMap((line) => line.ids);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((line) => line.speaker === 'pundit')).toBe(true);
    expect(ids).toContain(stadiumNameClipId(cfg.teams[0].data.id));
    expect(ids).toContain(teamNameClipId(cfg.teams[0].data.id, 'calm'));
    expect(ids).toContain(teamNameClipId(cfg.teams[1].data.id, 'calm'));
    expect(ids).toContain('phrase.commentator.prematch.self_intro.01');
    expect(ids).toContain('phrase.commentator.prematch.pundit_question.01');
  });

  it('keeps the legacy intro sequence helper backed by the first intro line', () => {
    const cfg = makeCfg();
    expect(buildMatchIntroSequence(cfg, 0)).toEqual(buildMatchIntroLines(cfg, 0)[0].ids);
  });

  it('builds a pre-match lineup sequence that spotlights both teams and key players', () => {
    const cfg = makeCfg();
    const lines = buildPrematchLineupLines(cfg, 1);
    const ids = lines.flatMap((line) => line.ids);
    const homeKey = cfg.teams[0].data.players[cfg.teams[0].lineup.starters.find((i) => cfg.teams[0].data.players[i].pos === 'FW')!];
    const awayKey = cfg.teams[1].data.players[cfg.teams[1].lineup.starters.find((i) => cfg.teams[1].data.players[i].pos === 'FW')!];

    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(ids).toContain(teamNameClipId(cfg.teams[0].data.id, 'calm'));
    expect(ids).toContain(teamNameClipId(cfg.teams[1].data.id, 'calm'));
    expect(ids).toContain(playerFullNameClipId(cfg.teams[0].data.id, homeKey.name, 'calm'));
    expect(ids).toContain(playerFullNameClipId(cfg.teams[1].data.id, awayKey.name, 'calm'));
    expect(lines.some((line) => line.speaker === 'pundit')).toBe(true);
  });

  it('ends the pre-match lineup sequence by heading to the stadium', () => {
    const cfg = makeCfg();
    const lines = buildPrematchLineupLines(cfg, 0);
    const finalLine = lines.at(-1);

    expect(lines.length).toBeLessThanOrEqual(6);
    expect(finalLine?.speaker).toBe('commentator');
    expect(finalLine?.ids).toEqual([
      'phrase.commentator.prematch.head_to.01',
      stadiumNameClipId(cfg.teams[0].data.id),
    ]);
  });

  it('varies goal commentary between team, scorer-only and scoreline calls', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    state.score = [2, 1];
    const scorer = state.players.find((p) => p.team === 0 && !p.isGK)!;
    const events: SimEvent[] = [{ type: 'goal', team: 0, player: scorer.idx }];

    const teamGoal = buildEventCommentaryLines(events, state, cfg, 0);
    const scorerOnly = buildEventCommentaryLines(events, state, cfg, 1);
    const scoreline = buildEventCommentaryLines(events, state, cfg, 2);

    expect(teamGoal[0].ids).toContain(teamNameClipId(cfg.teams[0].data.id, 'big'));
    expect(teamGoal[0].ids).toContain(playerFullNameClipId(cfg.teams[0].data.id, scorer.attrs.name, 'big'));
    expect(scorerOnly[0].ids).toContain(playerFullNameClipId(cfg.teams[0].data.id, scorer.attrs.name, 'big'));
    expect(scorerOnly[0].ids).not.toContain(teamNameClipId(cfg.teams[0].data.id, 'big'));
    expect(scoreline[0].ids).toContain(scoreNumberClipId(2, 'big'));
    expect(scoreline[0].ids).toContain(scoreNumberClipId(1, 'big'));
    expect(scoreline.some((line) => line.speaker === 'pundit')).toBe(true);
  });

  it('uses full player names for disciplinary calls', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    const offender = state.players.find((p) => p.team === 0 && !p.isGK)!;

    const lines = buildEventCommentaryLines([{ type: 'yellowCard', team: 0, player: offender.idx }], state, cfg, 0);

    expect(lines[0].ids).toContain(playerFullNameClipId(cfg.teams[0].data.id, offender.attrs.name, 'excited'));
  });

  it('announces passes with varied in-game surname call structures', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    const passer = state.players.find((p) => p.team === 0 && p.attrs.name.includes('Adams')) ?? state.players[1];
    const receiver = state.players.find((p) => p.team === 0 && p !== passer && !p.isGK)!;
    const passEvent: SimEvent = { type: 'pass', team: 0, player: passer.idx, target: receiver.idx };
    const direct = buildEventCommentaryLines([passEvent], state, cfg, 0);
    const tries = buildEventCommentaryLines([passEvent], state, cfg, 1);
    const nowHasIt = buildEventCommentaryLines([passEvent], state, cfg, 2);
    const picksOut = buildEventCommentaryLines([passEvent], state, cfg, 3);

    expect(direct[0].ids[0]).toBe(playerNameClipId(cfg.teams[0].data.id, passer.attrs.name, 'calm'));
    expect(direct[0].ids).toContain('phrase.commentator.pass.to.01');
    expect(tries[0].ids).toContain('phrase.commentator.pass.tries_find.01');
    expect(nowHasIt[0].ids).toContain('phrase.commentator.pass.now_has.01');
    expect(picksOut[0].ids).toContain('phrase.commentator.pass.picks_out.01');
    expect(direct[0].ids).toContain(playerNameClipId(cfg.teams[0].data.id, receiver.attrs.name, 'calm'));
    expect(direct[0].ids).not.toContain(playerFullNameClipId(cfg.teams[0].data.id, passer.attrs.name, 'excited'));
  });

  it('speaks scorelines without a team-score "to" separator', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    state.score = [2, 1];
    const scorer = state.players.find((p) => p.team === 0 && !p.isGK)!;

    const scoreline = buildEventCommentaryLines([{ type: 'goal', team: 0, player: scorer.idx }], state, cfg, 2);

    expect(scoreline[0].ids).toEqual(expect.arrayContaining([
      teamNameClipId(cfg.teams[0].data.id, 'big'),
      scoreNumberClipId(2, 'big'),
      teamNameClipId(cfg.teams[1].data.id, 'big'),
      scoreNumberClipId(1, 'big'),
    ]));
    expect(scoreline[0].ids).not.toContain('phrase.commentator.goal.score_separator.01');
  });

  it('varies full-time commentary with a spliceable scoreline and pundit reaction', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    state.score = [3, 1];

    const lines = buildEventCommentaryLines([{ type: 'fullTime' }], state, cfg, 3);
    const ids = lines.flatMap((line) => line.ids);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(ids).toContain(teamNameClipId(cfg.teams[0].data.id, 'calm'));
    expect(ids).toContain(scoreNumberClipId(3, 'calm'));
    expect(ids).toContain(teamNameClipId(cfg.teams[1].data.id, 'calm'));
    expect(ids).toContain(scoreNumberClipId(1, 'calm'));
    expect(ids).not.toContain('phrase.commentator.goal.score_separator.01');
    expect(lines.some((line) => line.speaker === 'pundit')).toBe(true);
  });

  it('adds half-time analysis and a full-time sign-off for broadcast presentation scenes', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    state.score = [1, 0];

    const half = buildEventCommentaryLines([{ type: 'halfTime' }], state, cfg, 0);
    const full = buildEventCommentaryLines([{ type: 'fullTime' }], state, cfg, 0);

    expect(half.some((line) => line.speaker === 'pundit')).toBe(true);
    expect(full.flatMap((line) => line.ids)).toContain('phrase.commentator.time.signoff.01');
  });

  it('builds commentator-pundit dialogue around the player on the ball', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    const owner = state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    state.ball.ownerIdx = owner.idx;

    const lines = buildAmbientCommentaryLines(state, cfg, 5);

    expect(lines).toHaveLength(2);
    expect(lines[0].speaker).toBe('commentator');
    expect(lines[0].ids).toContain(playerFullNameClipId(cfg.teams[0].data.id, owner.attrs.name, 'calm'));
    expect(lines[1].speaker).toBe('pundit');
    expect(lines[1].ids[0]).toMatch(/phrase\.pundit\.dialogue\.fw\./);
  });

  it('tightens pass connector-to-name joins instead of adding a fixed playback gap', () => {
    const clips = {
      'player.highbury.tony-addams.calm': { id: 'player.highbury.tony-addams.calm', src: '', speaker: 'commentator', kind: 'player' },
      'phrase.commentator.pass.to.01': { id: 'phrase.commentator.pass.to.01', src: '', speaker: 'commentator', kind: 'phrase' },
      'player.highbury.ian-write.calm': { id: 'player.highbury.ian-write.calm', src: '', speaker: 'commentator', kind: 'player' },
    } as const;
    const planned = planCommentaryStitches(
      Object.keys(clips),
      { version: 1, generatedAt: '', people: COMMENTARY_CATALOG.people, voices: COMMENTARY_CATALOG.voices, clips },
      {
        'player.highbury.tony-addams.calm': { durationMs: 520, leadingSilenceMs: 4, trailingSilenceMs: 12 },
        'phrase.commentator.pass.to.01': { durationMs: 650, leadingSilenceMs: 58, trailingSilenceMs: 226 },
        'player.highbury.ian-write.calm': { durationMs: 500, leadingSilenceMs: 3, trailingSilenceMs: 10 },
      },
    );

    const connector = planned[1];
    const receiver = planned[2];
    const connectorEnd = connector.startMs + connector.durationMs;

    expect(connector.offsetMs).toBeGreaterThanOrEqual(50);
    expect(receiver.startMs).toBeLessThan(connectorEnd);
    expect(connectorEnd - receiver.startMs).toBeGreaterThanOrEqual(60);
    expect(connectorEnd - receiver.startMs).toBeLessThanOrEqual(110);
    expect(connector.fadeOutMs).toBeGreaterThan(0);
    expect(receiver.fadeInMs).toBeGreaterThan(0);
  });

  it('keeps a real conversational pause between separate commentator and pundit lines', () => {
    const commentator = planCommentaryStitches(
      ['phrase.commentator.save.01'],
      {
        version: 1,
        generatedAt: '',
        people: COMMENTARY_CATALOG.people,
        voices: COMMENTARY_CATALOG.voices,
        clips: {
          'phrase.commentator.save.01': { id: 'phrase.commentator.save.01', src: '', speaker: 'commentator', kind: 'phrase' },
        },
      },
      { 'phrase.commentator.save.01': { durationMs: 900, leadingSilenceMs: 60, trailingSilenceMs: 180 } },
    );
    const pundit = planCommentaryStitches(
      ['phrase.pundit.analysis.save.01'],
      {
        version: 1,
        generatedAt: '',
        people: COMMENTARY_CATALOG.people,
        voices: COMMENTARY_CATALOG.voices,
        clips: {
          'phrase.pundit.analysis.save.01': { id: 'phrase.pundit.analysis.save.01', src: '', speaker: 'pundit', kind: 'phrase' },
        },
      },
      { 'phrase.pundit.analysis.save.01': { durationMs: 1100, leadingSilenceMs: 70, trailingSilenceMs: 190 } },
    );

    expect(commentator[0].startMs).toBe(0);
    expect(pundit[0].startMs).toBe(0);
  });
});
