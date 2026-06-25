import { describe, expect, it } from 'vitest';
import { MatchSim } from '../matchSim';
import { autoLineup } from '../formations';
import { TEAMS } from '../../data/teams';
import { DT, HALF_LEN, PENALTY_SPOT } from '../constants';
import { NULL_INPUT } from '../types';
import type { FormationId, MatchConfig, PadInput, SimPlayer, TeamData, Vec2 } from '../types';

const idle: [PadInput, PadInput] = [{ ...NULL_INPUT }, { ...NULL_INPUT }];

function cfg(seed: number, over: Partial<MatchConfig> = {}): MatchConfig {
  const a = TEAMS[0], b = TEAMS[1];
  return {
    teams: [
      { data: a, lineup: { formation: '4-4-2', starters: autoLineup(a.players, '4-4-2') }, kit: a.colors.home, controller: 'ai' },
      { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 90, difficulty: 1, cupTie: false, seed, ...over,
  };
}

function ang(a: number, b: number) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
function d(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }

describe('behaviour stability', () => {
  // Guards the core "erratic" fix: off-ball players must move smoothly and
  // commit to decisions rather than twitching their heading or destination
  // every frame. Measured over several deterministic CPU matches.
  it('keeps off-ball movement smooth and committed (no per-frame twitching)', () => {
    let velFlips = 0, velMeasured = 0, headSum = 0, headN = 0, aimDisp = 0, aimDispN = 0;
    for (const seed of [1, 7, 42, 1234, 99]) {
      const sim = new MatchSim(cfg(seed));
      const aiAim = (sim as unknown as { aiAim: Map<number, Vec2> }).aiAim;
      const prevVelDir = new Map<number, number>();
      const prevAim = new Map<number, Vec2>();
      for (let t = 0; t < 60 * 30; t++) {
        sim.step(idle);
        const st = sim.state;
        if (st.phase !== 'play') { prevVelDir.clear(); prevAim.clear(); continue; }
        for (const p of st.players) {
          if (p.isGK || p.sentOff || st.ball.ownerIdx === p.idx) continue;
          if (d(p.pos, st.ball.pos) < 8) { prevVelDir.delete(p.idx); prevAim.delete(p.idx); continue; }
          const sp = Math.hypot(p.vel.x, p.vel.y);
          if (sp > 1) {
            const vdir = Math.atan2(p.vel.y, p.vel.x);
            const pv = prevVelDir.get(p.idx);
            if (pv !== undefined) { velMeasured++; const dd = ang(vdir, pv); headSum += dd; headN++; if (dd > Math.PI / 2) velFlips++; }
            prevVelDir.set(p.idx, vdir);
          } else prevVelDir.delete(p.idx);
          const aim = aiAim.get(p.idx);
          if (aim) { const pa = prevAim.get(p.idx); if (pa) { aimDisp += d(pa, aim); aimDispN++; } prevAim.set(p.idx, { x: aim.x, y: aim.y }); }
        }
      }
    }
    const velReversal = velFlips / velMeasured;
    const meanHeading = headSum / headN;
    const meanAimDisp = aimDisp / aimDispN;
    // hard 180-ish heading reversals while moving must be essentially absent
    expect(velReversal).toBeLessThan(0.01);
    // average frame-to-frame heading change stays gentle (no shivering)
    expect(meanHeading).toBeLessThan(0.06);
    // the steering target itself doesn't fling around the pitch each tick
    expect(meanAimDisp).toBeLessThan(1.1);
  });

  it('does not let possession ping-pong between teams every few ticks', () => {
    let turnovers = 0, playTicks = 0;
    for (const seed of [1, 7, 42, 1234, 99]) {
      const sim = new MatchSim(cfg(seed));
      let prevOwnerTeam = -1;
      for (let t = 0; t < 60 * 30; t++) {
        sim.step(idle);
        const st = sim.state;
        if (st.phase !== 'play') continue;
        playTicks++;
        const ot = st.ball.ownerIdx >= 0 ? st.players[st.ball.ownerIdx].team : -1;
        if (ot >= 0 && prevOwnerTeam >= 0 && ot !== prevOwnerTeam) turnovers++;
        if (ot >= 0) prevOwnerTeam = ot;
      }
    }
    const perMin = turnovers / (playTicks / 60 / 60);
    // Per minute of real (compressed) in-play time. Open play turns over often, and
    // tighter central cover (a defender tucking in front of a central carrier) raises
    // it a little more — an accepted trade. The guard still catches the failure mode it
    // exists for: tick-level ping-pong, which blows perMin past ~40.
    expect(perMin).toBeLessThan(21);
  });

  it('penalty: the defending keeper holds his line, never standing in front of the ball', () => {
    const sim = new MatchSim(cfg(1));
    const st = sim.state;
    // Stage an in-match penalty for team 0 and hold it in the set-up phase (the kick
    // is not taken while restartTimer > 0).
    st.phase = 'penaltyKick';
    st.restartTeam = 0;
    st.restartTimer = 10;
    const atk = st.attackDir[0];
    const spot = { x: atk * (HALF_LEN - PENALTY_SPOT), y: 0 };
    st.restartPos = { ...spot };
    st.ball.pos = { ...spot };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.z = 0; st.ball.vz = 0;
    st.ball.ownerIdx = -1;
    // Put the defending keeper advanced, standing right in front of the ball — as he
    // often is in the build-up to the foul. The bug had him then "claim" the dead ball
    // and stay out there instead of retreating to his line.
    const keeper = st.players.find((p) => p.team === 1 && p.isGK)!;
    const goalLineX = atk * HALF_LEN; // team 0 attacks team 1's goal
    keeper.pos = { x: spot.x, y: 0 };
    keeper.vel = { x: 0, y: 0 };
    for (let t = 0; t < 150; t++) sim.step(idle);
    // he must have retreated back onto his line, not be standing in front of the ball
    expect(Math.abs(keeper.pos.x - goalLineX)).toBeLessThan(3);
  });

  it('penalty: stale live-shot state cannot pull the keeper off his line', () => {
    const sim = new MatchSim(cfg(1));
    const st = sim.state;
    st.phase = 'penaltyKick';
    st.restartTeam = 0;
    st.restartTimer = 10;
    const atk = st.attackDir[0];
    const spot = { x: atk * (HALF_LEN - PENALTY_SPOT), y: 0 };
    st.restartPos = { ...spot };
    st.ball.pos = { ...spot };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.z = 0; st.ball.vz = 0;
    st.ball.ownerIdx = -1;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { penaltyDiveGuess: number | null }).penaltyDiveGuess = null;
    const keeper = st.players.find((p) => p.team === 1 && p.isGK)!;
    const goalLineX = atk * HALF_LEN;
    keeper.pos = { x: spot.x, y: 0 };
    keeper.vel = { x: 0, y: 0 };

    for (let t = 0; t < 150; t++) sim.step(idle);

    expect(Math.abs(keeper.pos.x - goalLineX)).toBeLessThan(3);
  });
});

describe('tactical identity', () => {
  function withFormationStrength(formation: FormationId, strength: number): MatchConfig {
    const base = TEAMS[0];
    const data: TeamData = { ...base, strength };
    const c = cfg(5);
    c.teams[0] = { data, lineup: { formation, starters: autoLineup(data.players, formation) }, kit: data.colors.home, controller: 'ai' };
    return c;
  }

  it('gives a strong, front-foot side more attacking intent than a cautious one', () => {
    const aggressive = new MatchSim(withFormationStrength('4-3-3', 90));
    const cautious = new MatchSim(withFormationStrength('5-4-1', 66));
    const idOf = (sim: MatchSim) => (sim as unknown as { teamIdentity: (t: 0 | 1) => { aggression: number } }).teamIdentity(0);
    expect(idOf(aggressive).aggression).toBeGreaterThan(idOf(cautious).aggression + 0.4);
  });

  it("expresses identity in a team's risk and tempo", () => {
    const aggressive = new MatchSim(withFormationStrength('4-3-3', 90));
    const cautious = new MatchSim(withFormationStrength('5-4-1', 66));
    const mOf = (sim: MatchSim) => (sim as unknown as { teamMentality: (t: 0 | 1) => { risk: number; tempo: number } }).teamMentality(0);
    // same situational state at kickoff, but the front-foot side carries more
    // risk and a higher tempo than the cautious one — so they play differently
    expect(mOf(aggressive).risk).toBeGreaterThan(mOf(cautious).risk + 0.08);
    expect(mOf(aggressive).tempo).toBeGreaterThan(mOf(cautious).tempo + 0.04);
  });

  it('makes a front-foot side hold a literally higher defensive line', () => {
    const aggressive = new MatchSim(withFormationStrength('4-3-3', 92));
    const cautious = new MatchSim(withFormationStrength('5-4-1', 64));
    const lineOf = (sim: MatchSim) => (sim as unknown as { defensiveLineX: (t: 0 | 1) => number }).defensiveLineX(0);
    // team 0 attacks toward +x and defends toward -x, so a higher line sits
    // further UP the pitch (greater x). The aggressive side must hold higher.
    expect(lineOf(aggressive)).toBeGreaterThan(lineOf(cautious) + 4);
  });
});

describe('player form', () => {
  function withForm(form: number): MatchConfig {
    const c = cfg(9);
    const starters = c.teams[0].lineup.starters;
    const map: Record<number, number> = {};
    for (const s of starters) map[s] = form;
    c.teams[0].playerForm = map;
    return c;
  }
  it('makes out-of-form players a yard slower than in-form ones', () => {
    const slow = new MatchSim(withForm(15));
    const fast = new MatchSim(withForm(90));
    const speedOf = (sim: MatchSim) => {
      const p = sim.state.players.find((pl) => pl.team === 0 && !pl.isGK)!;
      const maxSpeed = (sim as unknown as { maxSpeed: (q: SimPlayer, s: boolean) => number }).maxSpeed.bind(sim);
      return maxSpeed(p, true);
    };
    expect(speedOf(fast)).toBeGreaterThan(speedOf(slow));
  });
  it('leaves matches with no form data unchanged (neutral 50)', () => {
    const sim = new MatchSim(cfg(9));
    const ff = (sim as unknown as { formByIdx: number[]; formFactor: (p: SimPlayer) => number });
    const p = sim.state.players[3];
    expect(ff.formFactor(p)).toBeCloseTo(1.0, 2);
  });
});

describe('join in progress', () => {
  it('starts a mid-match config directly in live play with no kickoff', () => {
    const c = cfg(3);
    c.startTimeSec = 30;
    c.startHalf = 2;
    c.startScore = [0, 1];
    const sim = new MatchSim(c);
    expect(sim.state.phase).toBe('play');
    expect(sim.state.clock).toBeGreaterThan(0);
    expect(sim.state.score).toEqual([0, 1]);
    // no kickoff event queued when joining in progress
    expect(sim.events.some((e) => e.type === 'kickoff')).toBe(false);
  });

  it('holds a defensive block instead of flipping mentality tick to tick', () => {
    const sim = new MatchSim(cfg(3));
    // park a settled mid-block: opponent (team 1) carries near halfway, static
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 1, y: 0 };
    carrier.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const stateOf = () => (sim as unknown as { teamTacticalState: (t: 0 | 1) => string }).teamTacticalState(0);
    const first = stateOf();
    let flips = 0, prev = first;
    for (let i = 0; i < 30; i++) {
      // jiggle the ball a touch around the threshold each tick
      sim.state.ball.pos.x = 1 + (i % 2 ? 0.4 : -0.4);
      const s = stateOf();
      if (s !== prev) flips++;
      prev = s;
    }
    // the committed-state window means the block doesn't oscillate every frame
    expect(flips).toBeLessThanOrEqual(1);
  });
});

describe('forward-run commitment', () => {
  it('does not abandon a run the instant its depth is reached', () => {
    const sim = new MatchSim(cfg(11));
    const runs = (sim as unknown as { forwardRuns: Map<number, { until: number; target: Vec2 }> }).forwardRuns;
    const supportTarget = (sim as unknown as { supportTarget: (p: SimPlayer, o: SimPlayer) => Vec2 }).supportTarget.bind(sim);
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.pos = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const runner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    // runner has reached the run's x but is still 6m away in y
    runner.pos = { x: 20, y: -6 };
    runs.set(runner.idx, { until: sim.state.tick + Math.round(2 / DT), target: { x: 20, y: 0 } });
    const target = supportTarget(runner, owner);
    // it should still steer toward the committed run target, not bail out
    expect(d(target, { x: 20, y: 0 })).toBeLessThan(1.5);
  });
});

describe('player switching', () => {
  function humanCfg(seed: number): MatchConfig {
    const c = cfg(seed);
    c.teams[0] = { ...c.teams[0], controller: 'human' };
    return c;
  }
  it('keeps the manually-chosen player through the override window', () => {
    const sim = new MatchSim(humanCfg(5));
    sim.state.phase = 'play';
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 0, y: 0 };
    const outfield = sim.state.players.filter((p) => p.team === 0 && !p.isGK);
    const chosen = outfield.find((p) => p.attrs.pos === 'FW')!;
    chosen.pos = { x: 34, y: 22 }; // deliberately far from the ball
    const nearBall = outfield.find((p) => p.attrs.pos === 'DF')!;
    nearBall.pos = { x: 0.6, y: 0 }; // right on the ball — the auto pick
    sim.state.controlledIdx[0] = chosen.idx;
    const h = (sim as unknown as { humans: { manualSwitchUntil: number }[] }).humans[0];
    h.manualSwitchUntil = sim.state.tick + 100; // pretend a manual switch just happened
    const update = (sim as unknown as { updateControlledIndices: (i: [PadInput, PadInput]) => void }).updateControlledIndices.bind(sim);
    for (let i = 0; i < 12; i++) { sim.state.tick++; update([{ ...NULL_INPUT }, { ...NULL_INPUT }]); }
    // the engine must NOT yank control to the closer player during the window
    expect(sim.state.controlledIdx[0]).toBe(chosen.idx);
  });
  it('does not auto-switch unless a player is notably better placed', () => {
    const sim = new MatchSim(humanCfg(6));
    sim.state.phase = 'play';
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 0, y: 0 };
    const outfield = sim.state.players.filter((p) => p.team === 0 && !p.isGK);
    const a = outfield[0]; const b = outfield[1];
    a.pos = { x: 2, y: 0 };   // current control, near the ball
    b.pos = { x: 2.6, y: 0 }; // only marginally closer/further — under the bias margin
    sim.state.controlledIdx[0] = a.idx;
    const h = (sim as unknown as { humans: { manualSwitchUntil: number; autoSwitchAt: number }[] }).humans[0];
    h.manualSwitchUntil = -1; h.autoSwitchAt = 0;
    const update = (sim as unknown as { updateControlledIndices: (i: [PadInput, PadInput]) => void }).updateControlledIndices.bind(sim);
    sim.state.tick++; update([{ ...NULL_INPUT }, { ...NULL_INPUT }]);
    // b is barely different, so control should NOT flicker over to it
    expect(sim.state.controlledIdx[0]).toBe(a.idx);
  });
});

describe('defensive close-down when a man is beaten', () => {
  it('re-assigns the press to a covering defender once the carrier gets goal-side', () => {
    const sim = new MatchSim(cfg(8));
    sim.state.phase = 'play';
    // move team 0's outfielders away so the two defenders are clearly the
    // closest men to the ball (no midfielder steals the press assignment)
    sim.state.players.filter((p) => p.team === 0 && !p.isGK).forEach((p) => { p.pos = { x: 14, y: 0 }; });
    const carrier = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'FW')!;
    // team 1 attacks toward -x; put the carrier deep in team 0's defensive third
    carrier.pos = { x: -30, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const defs = sim.state.players.filter((p) => p.team === 0 && p.attrs.pos === 'DF');
    defs[0].pos = { x: -28, y: 0.5 };  // just in front of the carrier (will get beaten)
    defs[1].pos = { x: -36, y: 0.5 };  // goal-side cover
    const press = (sim as unknown as { pressAssignments: (t: 0 | 1, c: SimPlayer) => { primary: SimPlayer | null } }).pressAssignments.bind(sim);
    const first = press(0, carrier);
    expect(first.primary!.idx).toBe(defs[0].idx);
    // carrier knocks it past def0 and drives goal-side of him
    carrier.pos = { x: defs[0].pos.x - 4, y: 0.5 };
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.tick += 1;
    const second = press(0, carrier);
    // the beaten man is no longer the presser, and the new presser is goal-side
    expect(second.primary!.idx).toBe(defs[1].idx);
  });
});

describe('attacking shape — back line pushes up', () => {
  type ST = { supportTarget: (p: SimPlayer, o: SimPlayer) => Vec2 };
  type AS = { attackSign: (t: 0 | 1) => number };
  function attackingState(seed: number, ownerProgress: number) {
    const sim = new MatchSim(cfg(seed));
    sim.state.phase = 'play';
    const dir = (sim as unknown as AS).attackSign(0);
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.pos = { x: dir * ownerProgress, y: 0 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const cb = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.5)!;
    const target = (sim as unknown as ST).supportTarget.bind(sim)(cb, owner);
    return { progress: target.x * dir };
  }
  it('holds the back line around halfway when attacking the opponent half', () => {
    // carrier just 10m into the opponent half: the line used to sit ~8m INSIDE
    // our own half (negative). It must now hold at least around halfway.
    expect(attackingState(11, 10).progress).toBeGreaterThan(-6);
  });
  it('still caps the line short of the ball deep in the final third (counter cushion)', () => {
    expect(attackingState(11, 40).progress).toBeLessThanOrEqual(HALF_LEN - 29.5);
  });
});

describe('last man steps up instead of running away', () => {
  it('closes the last defender onto the carrier when no one else is goal-side', () => {
    const sim = new MatchSim(cfg(8));
    const aiTarget = (sim as unknown as { aiTarget: (p: SimPlayer) => Vec2 }).aiTarget.bind(sim);
    const ownGoalDir = (sim as unknown as { ownGoalDir: (t: 0 | 1) => number }).ownGoalDir(0);
    sim.state.phase = 'play';
    // everyone upfield except one CB (last man) — and a midfielder closer to the
    // ball who steals the press, so the CB only steps up via the last-man rule
    sim.state.players.filter((p) => p.team === 0 && !p.isGK).forEach((p) => { p.pos = { x: -ownGoalDir * 16, y: 6 }; });
    const carrier = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'FW')!;
    carrier.pos = { x: ownGoalDir * 16, y: 0 };
    carrier.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const mf = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    mf.pos = { x: ownGoalDir * 14, y: 0.5 }; // ball-side, nearest → presses
    const cb = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF')!;
    cb.pos = { x: ownGoalDir * 22, y: 1 }; // last man, ~6m goal-side of the carrier
    const target = aiTarget(cb);
    // he steps UP to within ~2.5m goal-side of the carrier, not ~6m off on the line
    const gap = (target.x - carrier.pos.x) * ownGoalDir;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(2.6);
  });
});

describe('long kicks and crosses land where aimed', () => {
  type KS = {
    simulateKick: (sp: number, l: number) => { carry: number; stop: number; reach: number };
    speedForStop: (r: number, l: number) => number;
    speedForReach: (d: number, l: number) => number;
  };
  it('a long restart kick comes to rest within a realistic range, not the length of the pitch', () => {
    const s = new MatchSim(cfg(3)) as unknown as KS;
    // A full-power lofted restart still travels a long way, but it checks up
    // after landing instead of skidding almost the whole length of the pitch.
    const fullPower = s.simulateKick(44, 0.6);
    expect(fullPower.stop).toBeLessThan(92);
    expect(fullPower.stop - fullPower.reach).toBeLessThan(13);
    // solving the speed for a ~55m punt stops it well short of the far goal
    const stop = s.simulateKick(s.speedForStop(55, 0.55), 0.55).stop;
    expect(stop).toBeGreaterThan(48);
    expect(stop).toBeLessThan(64);
  });
  it('a cross is pitched to drop onto the target, not sail past it', () => {
    const s = new MatchSim(cfg(3)) as unknown as KS;
    const d = 20;
    const loft = 0.5 + d * 0.006; // matchSim's cross loft for d=20
    const reach = s.simulateKick(s.speedForReach(d, loft), loft).reach;
    expect(Math.abs(reach - d)).toBeLessThan(3.5);
  });
});

describe('goalkeeper positioning', () => {
  it('shades toward the near post on a wide chance', () => {
    const sim = new MatchSim(cfg(2));
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    const ball = sim.state.ball;
    ball.ownerIdx = -1;
    ball.pos = { x: -40, y: 8 }; // wide and deep in front of team 0's goal
    ball.vel = { x: 0, y: 0 };
    const gkPosition = (sim as unknown as { gkPosition: (p: SimPlayer) => Vec2 }).gkPosition.bind(sim);
    const target = gkPosition(gk);
    // shades toward the ball's side, but stays INSIDE the frame so the far post is
    // still coverable — standing wide of the near post left the far corner open
    expect(target.y).toBeGreaterThan(1.4);
    expect(target.y).toBeLessThan(3.3);
  });
});
