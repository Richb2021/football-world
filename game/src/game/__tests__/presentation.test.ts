import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../data/teams';
import { autoLineup } from '../../sim/formations';
import { HALF_LEN, HALF_WID } from '../../sim/constants';
import type { MatchConfig, MatchState } from '../../sim/types';
import {
  buildExitPresentationState,
  buildHydrationBreakState,
  buildMatchdayGraphicText,
  buildSubstitutionPresentationSceneState,
  buildSubstitutionPresentationState,
  buildWalkoutPresentationState,
} from '../presentation';

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
    phase: 'kickoff',
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
      slot: { x: slotIdx * 0.01, y: 0 },
      pos: { x: -20 + slotIdx * 4, y: teamIdx === 0 ? -12 : 12 },
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
    controlledIdx: [-1, -1],
    substitutionsUsed: [0, 0],
    subbedOff: [[], []],
    subbedOn: [[], []],
    penalties: null,
    penaltyAim: 0,
    excitement: 0,
    momentum: [0, 0],
    injuries: [],
    winner: -1,
  };
}

describe('match presentation states', () => {
  it('formats a 90s broadcast-style match graphic title', () => {
    const cfg = makeCfg();

    expect(buildMatchdayGraphicText(cfg)).toBe(`${cfg.teams[0].data.name} VS ${cfg.teams[1].data.name}`);
  });

  it('walks players from the touchline to their kickoff positions without mutating live state', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    const originalY = state.players[0].pos.y;

    const start = buildWalkoutPresentationState(state, 0);
    const done = buildWalkoutPresentationState(state, 1);

    expect(start.players[0].pos.y).toBeLessThan(-HALF_WID);
    expect(start.players.every((p) => p.anim === 'run')).toBe(true);
    expect(done.players[0].pos).toEqual(state.players[0].pos);
    expect(state.players[0].pos.y).toBe(originalY);
  });

  it('walks players off at half-time and differentiates winners at full-time', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    state.score = [2, 0];
    state.winner = 0;

    const half = buildExitPresentationState(state, 1, 'halfTime');
    const full = buildExitPresentationState(state, 1, 'fullTime');

    expect(half.players[0].pos.y).toBeGreaterThan(HALF_WID);
    expect(half.players.every((p) => p.anim === 'run')).toBe(true);
    expect(full.players.find((p) => p.team === 0)?.anim).toBe('celebrate');
    expect(full.players.find((p) => p.team === 1)?.anim).toBe('run');
  });

  it('stages substitutions at the tunnel with the incoming player waiting as the outgoing player runs off', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    const outgoing = {
      ...state.players[4],
      attrs: { ...state.players[4].attrs },
      slot: { ...state.players[4].slot },
      pos: { ...state.players[4].pos },
      vel: { ...state.players[4].vel },
    };
    const incomingName = cfg.teams[0].data.players[12].name;
    state.players[4] = {
      ...state.players[4],
      attrs: { ...cfg.teams[0].data.players[12] },
      squadIdx: 12,
    };

    const leaving = buildSubstitutionPresentationState(state, 0.25, 4, outgoing);
    const entering = buildSubstitutionPresentationState(state, 0.75, 4, outgoing);
    const waitingIncoming = leaving.players[4];
    const leavingOutgoing = leaving.players.find((p) => p.idx !== 4 && p.attrs.name === outgoing.attrs.name);

    expect(waitingIncoming.attrs.name).toBe(incomingName);
    expect(waitingIncoming.anim).toBe('idle');
    expect(waitingIncoming.pos.x).toBeGreaterThan(0);
    expect(waitingIncoming.pos.y).toBeLessThan(-HALF_WID);
    expect(leavingOutgoing).toBeTruthy();
    expect(leavingOutgoing!.anim).toBe('run');
    expect(leavingOutgoing!.pos.x).toBeLessThan(0);
    expect(leavingOutgoing!.pos.y).toBeLessThan(-HALF_WID);
    expect(entering.players[4].attrs.name).toBe(incomingName);
    expect(entering.players[4].anim).toBe('run');
    expect(entering.players[4].pos.y).toBeGreaterThan(waitingIncoming.pos.y);
    expect(state.players[4].attrs.name).toBe(incomingName);
  });

  it('gathers both teams into touchline huddles for a hydration break and returns them', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    const homeY0 = state.players[0].pos.y;

    const out = buildHydrationBreakState(state, 0.0);
    const hold = buildHydrationBreakState(state, 0.5);
    const back = buildHydrationBreakState(state, 1.0);

    // leaving the pitch they are jogging
    expect(out.players.every((p) => p.anim === 'run')).toBe(true);
    // mid-break: gathered near the near touchline, standing to drink/talk
    expect(hold.players.every((p) => p.pos.y < -HALF_WID + 12)).toBe(true);
    expect(hold.players.every((p) => p.anim === 'idle')).toBe(true);
    // the two teams huddle apart, one on each side
    const avgX = (team: 0 | 1) => {
      const ps = hold.players.filter((p) => p.team === team);
      return ps.reduce((s, p) => s + p.pos.x, 0) / ps.length;
    };
    expect(avgX(0)).toBeLessThan(0);
    expect(avgX(1)).toBeGreaterThan(0);
    // by the end they are back at their on-pitch positions, and live state untouched
    expect(back.players[0].pos).toEqual(state.players[0].pos);
    expect(state.players[0].pos.y).toBe(homeY0);
  });

  it('uses an isolated touchline scene when a substitution is made during a goal celebration', () => {
    const cfg = makeCfg();
    const state = makeState(cfg);
    state.phase = 'goalCelebration';
    state.players.forEach((p, idx) => {
      p.pos = { x: HALF_LEN - 4 + (idx % 3) * 0.4, y: -2 + (idx % 5) };
      p.anim = 'run';
    });
    const outgoing = {
      ...state.players[4],
      attrs: { ...state.players[4].attrs },
      slot: { ...state.players[4].slot },
      pos: { ...state.players[4].pos },
      vel: { ...state.players[4].vel },
    };
    state.players[4] = {
      ...state.players[4],
      attrs: { ...cfg.teams[0].data.players[12] },
      squadIdx: 12,
    };

    const cutaway = buildSubstitutionPresentationSceneState(state, 0.25, [{ playerIdx: 4, outgoing }]);
    const subPlayer = cutaway.players[4];
    const outgoingRunner = cutaway.players.find((p) => p.idx !== 4 && p.attrs.name === outgoing.attrs.name);
    const backgroundPlayers = cutaway.players.filter((p) => p.idx !== 4 && p !== outgoingRunner);

    expect(subPlayer.pos.y).toBeLessThan(-HALF_WID);
    expect(outgoingRunner).toBeTruthy();
    expect(outgoingRunner!.pos.y).toBeLessThan(-HALF_WID);
    expect(backgroundPlayers.every((p) => p.pos.y < -HALF_WID - 6)).toBe(true);
    expect(backgroundPlayers.every((p) => p.anim === 'idle')).toBe(true);
  });
});
