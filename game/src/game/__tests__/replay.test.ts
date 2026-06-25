import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../data/teams';
import { autoLineup } from '../../sim/formations';
import { HALF_LEN } from '../../sim/constants';
import type { MatchConfig, MatchState } from '../../sim/types';
import { GoalReplayController } from '../replay';

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

function makeState(cfg: MatchConfig, tick: number): MatchState {
  return {
    phase: 'play',
    tick,
    clock: tick / 60,
    half: 1,
    score: [0, 0],
    goals: [],
    ball: { pos: { x: -18 + tick, y: tick * 0.2 }, z: 0, vel: { x: 20, y: 1 }, vz: 0, spin: 0, kickDir: { x: 1, y: 0 }, ownerIdx: -1, lastTouchTeam: 0, lastKicker: 1 },
    players: cfg.teams.flatMap((team, teamIdx) => team.lineup.starters.map((squadIdx, slotIdx) => ({
      idx: teamIdx * 11 + slotIdx,
      team: teamIdx as 0 | 1,
      attrs: team.data.players[squadIdx],
      squadIdx,
      isGK: slotIdx === 0,
      slot: { x: 0, y: 0 },
      pos: { x: teamIdx === 0 ? -tick : tick, y: slotIdx - 5 },
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

describe('goal replay controller', () => {
  it('builds a short replay from buffered pre-goal states with a locked alternate camera', () => {
    const cfg = makeCfg();
    const replay = new GoalReplayController({ windowSec: 2, durationSec: 1.4, sampleRate: 60 });

    for (let tick = 0; tick < 120; tick++) replay.record(makeState(cfg, tick));
    const goalState = makeState(cfg, 121);
    goalState.phase = 'goalCelebration';
    goalState.score = [1, 0];
    replay.startFromGoal(goalState, [{ type: 'goal', team: 0, player: 1 }]);

    expect(replay.active).toBe(true);
    const first = replay.update(0.1)!;
    expect(first.state.tick).toBeLessThan(goalState.tick);
    expect(first.camera.replay).toBe(true);
    expect(first.camera.fov).toBeGreaterThan(0);
    // team 0 attacks +x, so the fixed camera POSITION sits behind that goal
    expect(first.camera.pos.x).toBeGreaterThan(HALF_LEN);

    // the SAME fixed camera position is handed back every frame — it never moves
    // or flips sides (the renderer pans the look-at to follow the ball)
    const second = replay.update(0.1)!;
    expect(second.camera).toBe(first.camera);

    let frame = second;
    for (let i = 0; i < 30 && replay.active; i++) frame = replay.update(0.1)!;

    expect(replay.active).toBe(false);
    expect(frame.done).toBe(true);
  });

  it('does not start when no goal event is present', () => {
    const cfg = makeCfg();
    const replay = new GoalReplayController();
    replay.record(makeState(cfg, 1));
    replay.startFromGoal(makeState(cfg, 2), [{ type: 'shot', team: 0 }]);

    expect(replay.active).toBe(false);
    expect(replay.update(0.1)).toBeNull();
  });
});
