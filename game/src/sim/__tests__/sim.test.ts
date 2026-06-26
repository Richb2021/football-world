import { describe, expect, it } from 'vitest';
import { MatchSim } from '../matchSim';
import { Rng } from '../rng';
import { simulateFixture, simulateKnockout } from '../statSim';
import { autoLineup, FORMATION_IDS, FORMATIONS, FORMATION_NEEDS } from '../formations';
import { roundRobin, computeTable } from '../../game/fixtures';
import { playerValue, clubBudget, buyPlayer, sellPlayer, MAX_SQUAD } from '../../game/transfers';
import {
  newCareer, advance, currentEvent, leagueTable, userFixture,
  applyTrainingWeek, ensureCareerSystems, setTrainingPlan,
} from '../../game/career';
import { TEAMS } from '../../data/teams';
import { CENTER_CIRCLE_R, DT, GOAL_DEPTH, GOAL_HALF_WIDTH, HALF_LEN, HALF_WID, PENALTY_SPOT } from '../constants';
import type { FormationId, MatchConfig, PadInput, SimPlayer, Vec2 } from '../types';
import { NULL_INPUT } from '../types';

const idle: [PadInput, PadInput] = [{ ...NULL_INPUT }, { ...NULL_INPUT }];
const idleWithSwitch: PadInput = { ...NULL_INPUT, switchPlayer: false };

function makeCfg(over: Partial<MatchConfig> = {}): MatchConfig {
  const a = TEAMS[0], b = TEAMS[1];
  return {
    teams: [
      { data: a, lineup: { formation: '4-4-2', starters: autoLineup(a.players, '4-4-2') }, kit: a.colors.home, controller: 'ai' },
      { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 60,
    difficulty: 1,
    cupTie: false,
    seed: 1234,
    ...over,
  };
}

function makeHumanCfg(over: Partial<MatchConfig> = {}): MatchConfig {
  const cfg = makeCfg(over);
  cfg.teams[0] = { ...cfg.teams[0], controller: 'human' };
  return cfg;
}

function makeFormationCfg(homeFormation: FormationId, awayFormation: FormationId = '4-4-2'): MatchConfig {
  const cfg = makeCfg();
  cfg.teams[0] = {
    ...cfg.teams[0],
    lineup: { formation: homeFormation, starters: autoLineup(cfg.teams[0].data.players, homeFormation) },
  };
  cfg.teams[1] = {
    ...cfg.teams[1],
    lineup: { formation: awayFormation, starters: autoLineup(cfg.teams[1].data.players, awayFormation) },
  };
  return cfg;
}

function stepMany(sim: MatchSim, n: number, inputs: [PadInput, PadInput] = idle) {
  for (let i = 0; i < n; i++) sim.step([{ ...inputs[0] }, { ...inputs[1] }]);
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDelta(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

describe('team data', () => {
  it('has 64 nations of full squads with valid mixes', () => {
    // 48 World Cup qualifiers + 16 non-qualified nations kept for Exhibition / Stars
    expect(TEAMS.length).toBe(64);
    for (const t of TEAMS) {
      // World Cup squads are 26 players; non-qualified exhibition nations stay at 23.
      expect(t.players.length).toBeGreaterThanOrEqual(23);
      expect(t.players.filter((p) => p.pos === 'GK').length).toBeGreaterThanOrEqual(3);
      expect(t.players.filter((p) => p.pos === 'DF').length).toBeGreaterThanOrEqual(6);
      expect(t.players.filter((p) => p.pos === 'FW').length).toBeGreaterThanOrEqual(3);
      // no duplicate names within a squad
      expect(new Set(t.players.map((p) => p.name)).size).toBe(t.players.length);
      expect(t.players[0].pos).toBe('GK');
      expect(t.colors.home.shirt).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('formations', () => {
  it('includes modern tactical shapes for career and all match modes', () => {
    expect(FORMATION_IDS).toEqual(expect.arrayContaining([
      '2-3-5',
      'w-m',
      '4-2-4',
      '4-2-2-2',
      '4-3-2-1',
      '4-2-3-1',
      '4-1-4-1',
      '4-3-1-2',
      '4-4-1-1',
      '3-4-3',
      '3-4-1-2',
      '3-4-2-1',
      '3-1-4-2',
      '5-4-1',
    ]));
  });

  it('autoLineup returns 11 unique players with a GK first', () => {
    for (const t of TEAMS.slice(0, 5)) {
      for (const f of FORMATION_IDS) {
        const xi = autoLineup(t.players, f);
        expect(xi.length).toBe(11);
        expect(new Set(xi).size).toBe(11);
        expect(t.players[xi[0]].pos).toBe('GK');
        expect(FORMATIONS[f].length).toBe(11);
        expect(FORMATION_NEEDS[f].length).toBe(10);
      }
    }
  });

  it('can re-slot the active XI when a formation is changed during a match', () => {
    const sim = new MatchSim(makeFormationCfg('4-4-2'));
    const beforeSquads = new Set(sim.state.players.filter((p) => p.team === 0).map((p) => p.squadIdx));

    expect(sim.changeFormation(0, '4-3-3')).toBe(true);

    const lineup = sim.cfg.teams[0].lineup;
    expect(lineup.formation).toBe('4-3-3');
    expect(new Set(lineup.starters)).toEqual(beforeSquads);
    lineup.starters.forEach((squadIdx, slotIdx) => {
      const player = sim.state.players.find((p) => p.team === 0 && p.squadIdx === squadIdx);
      expect(player?.slot).toEqual(FORMATIONS['4-3-3'][slotIdx]);
    });
  });
});

describe('substitutions', () => {
  it('keeps a subbed-off player inactive and refuses to bring them back on', () => {
    const sim = new MatchSim(makeCfg());
    const team = 0 as const;
    const onField = (squadIdx: number) =>
      sim.state.players.some((p) => p.team === team && p.squadIdx === squadIdx);

    // take an outfield starter (A) off for an outfield bench player (B)
    const off = sim.state.players.find((p) => p.team === team && !p.isGK)!;
    const aSquad = off.squadIdx;
    const bSquad = sim.cfg.teams[team].data.players.findIndex(
      (pl, squadIdx) => pl.pos !== 'GK' && !onField(squadIdx),
    );
    expect(bSquad).toBeGreaterThanOrEqual(0);

    expect(sim.substitute(team, off.idx, bSquad, true)).toBe(true);
    expect(onField(aSquad)).toBe(false); // A is now inactive
    expect(onField(bSquad)).toBe(true); // B is on the pitch

    // A has been used — they must never be allowed back on
    const bPlayer = sim.state.players.find((p) => p.team === team && p.squadIdx === bSquad)!;
    expect(sim.substitute(team, bPlayer.idx, aSquad, true)).toBe(false);
    expect(onField(aSquad)).toBe(false);
  });

  it('swaps two outfield players positions without consuming a substitution', () => {
    const sim = new MatchSim(makeCfg());
    const outfield = sim.state.players.filter((p) => p.team === 0 && !p.isGK);
    const a = outfield[0], b = outfield[5];
    const slotA = { ...a.slot }, slotB = { ...b.slot };
    const usedBefore = sim.state.substitutionsUsed[0];
    const starters = sim.cfg.teams[0].lineup.starters;
    const slotIdxA = starters.indexOf(a.squadIdx);
    const slotIdxB = starters.indexOf(b.squadIdx);

    expect(sim.swapPositions(0, a.idx, b.idx)).toBe(true);
    expect(a.slot).toEqual(slotB); // they have traded formation slots
    expect(b.slot).toEqual(slotA);
    expect(sim.state.substitutionsUsed[0]).toBe(usedBefore); // a free swap, not a sub
    // the lineup slot->squad mapping reflects the swap
    expect(starters[slotIdxA]).toBe(b.squadIdx);
    expect(starters[slotIdxB]).toBe(a.squadIdx);

    // the goalkeeper can't be shuffled into an outfield role
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    expect(sim.swapPositions(0, gk.idx, b.idx)).toBe(false);
  });
});

describe('match momentum', () => {
  it('starts neutral by default and accepts a clamped match seed', () => {
    expect(new MatchSim(makeCfg()).state.momentum).toEqual([0, 0]);
    expect(new MatchSim(makeCfg({ initialMomentum: [24, -30] })).state.momentum).toEqual([12, -12]);
  });

  it('swings hard toward a team that scores against the run of play', () => {
    const sim = new MatchSim(makeCfg());
    const scorer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.phase = 'play';
    sim.state.momentum = [-5, 5];
    sim.state.ball.pos = { x: HALF_LEN - 0.06, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vel = { x: 10, y: 0 };
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = scorer.idx;

    sim.step(idle);

    expect(sim.state.score[0]).toBe(1);
    expect(sim.state.momentum[0]).toBeGreaterThan(-1);
    expect(sim.state.momentum[1]).toBeLessThan(2);
  });

  it('uses momentum as a small pass-quality boost or drag', () => {
    type PassHarness = { applyPassSkillToAim(kicker: SimPlayer, aim: Vec2, aerial: boolean): Vec2 };
    const boosted = new MatchSim(makeCfg({ seed: 99, initialMomentum: [12, 0] }));
    const drained = new MatchSim(makeCfg({ seed: 99, initialMomentum: [-12, 0] }));
    const boostedKicker = boosted.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const drainedKicker = drained.state.players.find((p) => p.team === 0 && !p.isGK)!;
    boostedKicker.pos = { x: 0, y: 0 };
    drainedKicker.pos = { x: 0, y: 0 };
    const aim = { x: 32, y: 0 };

    const boostedAim = (boosted as unknown as PassHarness).applyPassSkillToAim(boostedKicker, aim, false);
    const drainedAim = (drained as unknown as PassHarness).applyPassSkillToAim(drainedKicker, aim, false);

    expect(Math.abs(boostedAim.y)).toBeLessThan(Math.abs(drainedAim.y));
  });
});

describe('match sim', () => {
  it('runs a full AI match to completion without NaNs', () => {
    const sim = new MatchSim(makeCfg());
    let guard = 0;
    while (sim.state.phase !== 'finished' && guard < 60 * 60 * 12) {
      sim.step(idle);
      guard++;
      const b = sim.state.ball;
      expect(Number.isFinite(b.pos.x)).toBe(true);
      expect(Number.isFinite(b.pos.y)).toBe(true);
    }
    expect(sim.state.phase).toBe('finished');
    expect(sim.state.half).toBeGreaterThanOrEqual(2);
    expect(sim.state.score[0]).toBeGreaterThanOrEqual(0);
  }, 15000);

  it('takes a momentum-clearing hydration break midway through a half in international cup ties', () => {
    const sim = new MatchSim(makeCfg({ leagueId: 'international-cup', halfLengthSec: 60, initialMomentum: [9, -7] }));
    let momentumAtBreak: [number, number] | null = null;
    let breakClock = -1;
    let guard = 0;
    while (sim.state.phase !== 'finished' && guard++ < 60 * 60 * 4) {
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'hydrationBreak')) {
        momentumAtBreak = [sim.state.momentum[0], sim.state.momentum[1]];
        breakClock = sim.state.clock;
        break;
      }
    }
    // it happens around the middle of the 60s half
    expect(breakClock).toBeGreaterThan(25);
    expect(breakClock).toBeLessThan(58);
    // and it wipes out the momentum that had built up to that point
    expect(momentumAtBreak).toEqual([0, 0]);
  });

  it('saps stamina faster at a higher pitch temperature', () => {
    const drained = (temperature: number) => {
      const sim = new MatchSim(makeHumanCfg({ temperature, halfLengthSec: 600 }));
      sim.state.phase = 'play';
      const p = sim.state.players.find((q) => q.team === 0 && !q.isGK)!;
      p.pos = { x: -30, y: 0 };
      const inp: PadInput = { ...NULL_INPUT, sprint: true, moveX: 1, moveY: 0 };
      p.control = true;
      sim.state.controlledIdx[0] = p.idx;
      for (let i = 0; i < 180; i++) sim.step([{ ...inp }, { ...NULL_INPUT }]);
      return p.stamina;
    };
    expect(drained(36)).toBeLessThan(drained(15)); // hotter = more tired
  });

  it('stages a hydration break in a hot match even outside the cup, but not in cool conditions', () => {
    const hadBreak = (over: Partial<MatchConfig>) => {
      const sim = new MatchSim(makeCfg({ halfLengthSec: 60, ...over }));
      let got = false, guard = 0;
      while (sim.state.phase !== 'finished' && guard++ < 60 * 60 * 4) {
        sim.step(idle);
        if (sim.events.some((e) => e.type === 'hydrationBreak')) { got = true; break; }
      }
      return got;
    };
    expect(hadBreak({ temperature: 36 })).toBe(true);  // hot exhibition
    expect(hadBreak({ temperature: 16 })).toBe(false); // cool exhibition, none
    expect(hadBreak({ temperature: 16, leagueId: 'international-cup' })).toBe(true); // cup always
  });

  it('hands players a slug of stamina back at a hydration break', () => {
    const sim = new MatchSim(makeCfg({ temperature: 36, halfLengthSec: 60 }));
    let jump = 0, guard = 0;
    while (sim.state.phase !== 'finished' && guard++ < 60 * 60 * 4) {
      const before = sim.state.players.map((p) => p.stamina);
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'hydrationBreak')) {
        jump = Math.max(...sim.state.players.map((p, i) => p.stamina - before[i]));
        break;
      }
    }
    expect(jump).toBeGreaterThan(0.1); // a real top-up, well beyond a tick of trickle recovery
  });

  it('does not stage hydration breaks outside international cup ties', () => {
    const sim = new MatchSim(makeCfg({ halfLengthSec: 60 }));
    let breaks = 0;
    let guard = 0;
    while (sim.state.half <= 1 && sim.state.phase !== 'finished' && guard++ < 60 * 60 * 3) {
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'hydrationBreak')) breaks++;
    }
    expect(breaks).toBe(0);
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const sim = new MatchSim(makeCfg());
      for (let i = 0; i < 60 * 30; i++) sim.step(idle);
      return JSON.stringify([sim.state.score, sim.state.ball.pos, sim.state.clock]);
    };
    expect(run()).toBe(run());
  });

  it('cup ties never finish level', () => {
    for (const seed of [7, 99, 555]) {
      const sim = new MatchSim(makeCfg({ cupTie: true, halfLengthSec: 30, seed }));
      let guard = 0;
      while (sim.state.phase !== 'finished' && guard < 60 * 60 * 20) {
        sim.step(idle);
        guard++;
      }
      expect(sim.state.phase).toBe('finished');
      expect(sim.state.winner === 0 || sim.state.winner === 1).toBe(true);
    }
  }, 30000); // 3 full ties + ET + penalties; ~2.3s alone but can exceed 15s under full-suite CPU contention

  it('keeps players inside sane bounds', () => {
    const sim = new MatchSim(makeCfg());
    for (let i = 0; i < 60 * 20; i++) sim.step(idle);
    for (const p of sim.state.players) {
      expect(Math.abs(p.pos.x)).toBeLessThan(56);
      expect(Math.abs(p.pos.y)).toBeLessThan(38);
    }
  });

  it('lets a human manually switch player without immediate auto-switch reversal', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 2.1;
    const team = sim.state.players.filter((p) => p.team === 0 && !p.isGK);
    team[0].pos = { x: 1, y: 0 };
    team[1].pos = { x: 3, y: 0 };
    sim.step([{ ...idleWithSwitch }, { ...NULL_INPUT }]);
    const autoIdx = sim.state.controlledIdx[0];

    sim.step([{ ...idleWithSwitch, switchPlayer: true }, { ...NULL_INPUT }]);
    const manualIdx = sim.state.controlledIdx[0];

    expect(manualIdx).not.toBe(autoIdx);
    sim.step([{ ...idleWithSwitch, switchPlayer: false }, { ...NULL_INPUT }]);
    expect(sim.state.controlledIdx[0]).toBe(manualIdx);
  });

  it('hands control to the receiver of a forward through-ball so the human can run onto it', () => {
    const sim = new MatchSim(makeHumanCfg({ halfLengthSec: 600 }));
    sim.state.phase = 'play';
    const team0 = sim.state.players.filter((p) => p.team === 0 && !p.isGK);
    const team1 = sim.state.players.filter((p) => p.team === 1);
    const carrier = team0[0];
    carrier.pos = { x: 0, y: 0 };
    carrier.facing = 0; // facing +x, the way team 0 attacks
    const runner = team0[1];
    runner.pos = { x: 14, y: 0 }; // a man ahead, in the lane, to run onto
    // clear the other attackers out of the lane so the assisted pass picks the runner
    for (const p of team0) if (p !== carrier && p !== runner) p.pos = { x: -34, y: p.idx % 2 ? 30 : -30 };
    for (const p of team1) p.pos = { x: 45, y: (p.idx % 5 - 2) * 6 }; // defenders deep → runner is onside
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.controlledIdx[0] = carrier.idx;
    carrier.control = true;
    // pass fires on release: press, then release → a forward through-ball into space ahead
    sim.step([{ ...NULL_INPUT, pass: true }, { ...NULL_INPUT }]);
    sim.step([{ ...NULL_INPUT, pass: false }, { ...NULL_INPUT }]);
    const controlled = sim.state.controlledIdx[0];
    expect(controlled).not.toBe(carrier.idx); // control left the passer...
    expect(sim.state.players[controlled].pos.x).toBeGreaterThan(2); // ...onto a man ahead, to run on
  });

  it('hands the human control of his own keeper while he holds a caught ball', () => {
    const sim = new MatchSim(makeHumanCfg()); // team 0 = human
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    sim.state.ball.ownerIdx = gk.idx;
    sim.state.ball.held = true;
    sim.state.ball.pos = { x: gk.pos.x, y: gk.pos.y };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 1;
    // keep the keeper inside his hold window so the CPU doesn't auto-clear yet
    (sim as unknown as { aiDecideAt: Map<number, number> }).aiDecideAt.set(gk.idx, sim.state.tick + 120);
    stepMany(sim, 3);
    expect(sim.state.ball.held).toBe(true);
    expect(sim.state.controlledIdx[0]).toBe(gk.idx);
  });

  it('auto-clears the keeper held ball upfield if the human never throws it', () => {
    const sim = new MatchSim(makeHumanCfg()); // team 0 = human, attacks +x
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    sim.state.ball.ownerIdx = gk.idx;
    sim.state.ball.held = true;
    sim.state.ball.pos = { x: gk.pos.x, y: gk.pos.y };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 1;
    // hold window already elapsed and the human presses nothing
    (sim as unknown as { aiDecideAt: Map<number, number> }).aiDecideAt.set(gk.idx, sim.state.tick);
    stepMany(sim, 2);
    expect(sim.state.ball.held).toBe(false); // released
    expect(sim.state.ball.vel.x).toBeGreaterThan(0); // hoofed long, upfield (away from his goal)
  });

  it('gathers a back-pass on his feet instead of diving at it', () => {
    const sim = new MatchSim(makeCfg()); // both AI; team 0 keeper defends -x
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    const defender = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    // push the opponents upfield so the back-pass is unambiguously the keeper's
    // to deal with (no forward nips in to confound the test)
    for (const p of sim.state.players) {
      if (p.team === 1) { p.pos = { x: HALF_LEN - 8 - (p.idx % 4), y: (p.idx % 6) - 3 }; p.vel = { x: 0, y: 0 }; }
    }
    // a team-mate has knocked the ball back toward our keeper at a firm but
    // collectable pace and slightly to his side — exactly the shape that used to
    // trip the loose-shot dive even though it is our own pass to clear
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.held = false;
    sim.state.ball.pos = { x: gk.pos.x + 9, y: 2.6 };
    sim.state.ball.vel = { x: -15, y: 0 };
    sim.state.ball.vz = 0;
    sim.state.ball.z = 0;
    sim.state.ball.spin = 0;
    sim.state.ball.kickDir = { x: -1, y: 0 };
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = defender.idx;
    // name the keeper as the intended receiver, as a real back-pass does
    const s = sim as unknown as { livePassTargetIdx: number; livePassTargetUntil: number };
    s.livePassTargetIdx = gk.idx;
    s.livePassTargetUntil = sim.state.tick + 240;

    let dived = false;
    for (let i = 0; i < 150; i++) {
      sim.step(idle);
      if (gk.diving || gk.anim === 'dive') dived = true;
      if (sim.state.ball.ownerIdx === gk.idx) break;
    }
    expect(dived).toBe(false); // he collects it, never flings into a save dive
    expect(sim.state.ball.ownerIdx).toBe(gk.idx); // and ends up with the ball
    expect(sim.state.score[1]).toBe(0); // and it never trickles into his own net
  });

  it('steers a sprinting human receiver back onto a pass played behind him', () => {
    const sim = new MatchSim(makeHumanCfg()); // team 0 human
    sim.state.phase = 'play';
    const recv = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== recv)!;
    // park everyone else far away so control stays on our receiver
    for (const p of sim.state.players) {
      if (p === recv || p.isGK) continue;
      p.pos = { x: -HALF_LEN + 4, y: (p.idx % 9) * 4 - 16 };
      p.vel = { x: 0, y: 0 };
    }
    recv.pos = { x: 10, y: 0 };
    recv.vel = { x: 0, y: 0 };
    recv.control = true;
    sim.state.controlledIdx[0] = recv.idx;
    // a pass rolling BEHIND him (back toward our half); he is the intended receiver
    const b = sim.state.ball;
    b.ownerIdx = -1; b.held = false;
    b.pos = { x: 7, y: 0 }; b.vel = { x: -6, y: 0 }; b.z = 0; b.vz = 0; b.spin = 0;
    b.kickDir = { x: -1, y: 0 };
    b.lastTouchTeam = 0; b.lastKicker = mate.idx;
    const s = sim as unknown as { livePassTargetIdx: number; livePassTargetUntil: number };
    s.livePassTargetIdx = recv.idx;
    s.livePassTargetUntil = sim.state.tick + 200;
    // the human HOLDS SPRINT and (wrongly) steers forward — the receive assist must
    // still draw the intended receiver back onto the incoming ball
    const inp: PadInput = { ...NULL_INPUT, sprint: true, moveX: 1, moveY: 0 };
    let collected = false;
    for (let i = 0; i < 120; i++) {
      sim.step([{ ...inp }, { ...NULL_INPUT }]);
      if (sim.state.ball.ownerIdx === recv.idx) { collected = true; break; }
    }
    expect(collected).toBe(true);
  });

  it('carries a clear one-on-one closer instead of blazing from outside the box', () => {
    const sim = new MatchSim(makeCfg()); // both AI; team 0 attacks +x
    sim.state.phase = 'play';
    const striker = sim.state.players.filter((p) => p.team === 0 && p.attrs.pos === 'FW')[0];
    // isolate a clean run to goal — park everyone else behind the play; keepers
    // hold their lines so the opponent keeper is rooted on his goal line
    for (const p of sim.state.players) {
      if (p === striker || p.isGK) continue;
      p.pos = { x: -HALF_LEN + 6, y: (p.idx % 7) * 4 - 14 };
      p.vel = { x: 0, y: 0 };
    }
    const goalX = HALF_LEN;
    striker.pos = { x: goalX - 26, y: 0 }; // ~26m out, dead central, clean through
    striker.vel = { x: 0, y: 0 };
    striker.kickCooldown = 0;
    sim.state.ball.ownerIdx = striker.idx;
    sim.state.ball.held = false;
    sim.state.ball.pos = { x: striker.pos.x, y: 0 };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;

    let shotDGoal = -1;
    for (let i = 0; i < 220; i++) {
      const prevOwner = sim.state.ball.ownerIdx;
      sim.step(idle);
      const b = sim.state.ball;
      if (prevOwner === striker.idx && b.ownerIdx === -1 && Math.hypot(b.vel.x, b.vel.y) > 12) {
        shotDGoal = Math.hypot(goalX - striker.pos.x, striker.pos.y);
        break;
      }
    }
    expect(shotDGoal).toBeGreaterThan(0); // he did take the shot on
    // ...but only after carrying into a real finishing position, not from 26m out
    expect(shotDGoal).toBeLessThan(18);
  });

  it('keeps both teams in their own half while waiting for kickoff', () => {
    const cfg = makeHumanCfg();
    cfg.teams[1] = { ...cfg.teams[1], controller: 'human' };
    const sim = new MatchSim(cfg);

    stepMany(sim, Math.round(2 / DT), [{ ...idleWithSwitch }, { ...idleWithSwitch }]);

    for (const p of sim.state.players) {
      if (p.team === 0) expect(p.pos.x).toBeLessThanOrEqual(0.2);
      else expect(p.pos.x).toBeGreaterThanOrEqual(-0.2);
    }
    expect(sim.state.clock).toBe(0);
  });

  it('keeps opponents outside the centre circle before kickoff is taken', () => {
    const sim = new MatchSim(makeHumanCfg());

    stepMany(sim, Math.round(1.5 / DT), [{ ...idleWithSwitch }, { ...NULL_INPUT }]);

    for (const p of sim.state.players) {
      if (p.team === sim.state.restartTeam || p.sentOff) continue;
      expect(Math.hypot(p.pos.x, p.pos.y)).toBeGreaterThanOrEqual(CENTER_CIRCLE_R - 0.05);
    }
  });

  it('does not let human restart takers run ahead of the dead ball', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'corner';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - 0.4, y: HALF_WID - 0.4 };
    sim.state.restartTimer = 0.2;

    stepMany(sim, Math.round(1.2 / DT), [{ ...idleWithSwitch, moveX: -1, moveY: -1 }, { ...NULL_INPUT }]);

    const taker = sim.state.players
      .filter((p) => p.team === 0 && !p.isGK)
      .sort((a, b) => Math.hypot(a.pos.x - sim.state.restartPos.x, a.pos.y - sim.state.restartPos.y)
        - Math.hypot(b.pos.x - sim.state.restartPos.x, b.pos.y - sim.state.restartPos.y))[0];
    expect(taker.pos.x).toBeGreaterThan(HALF_LEN);
    expect(taker.pos.y).toBeGreaterThan(HALF_WID);
  });

  it('places the throw-in taker off the pitch', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'throwIn';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: 4, y: HALF_WID - 0.2 };
    sim.state.restartTimer = 0.4;

    sim.step(idle);

    const taker = sim.state.players
      .filter((p) => p.team === 0 && !p.isGK)
      .sort((a, b) => Math.hypot(a.pos.x - sim.state.restartPos.x, a.pos.y - sim.state.restartPos.y)
        - Math.hypot(b.pos.x - sim.state.restartPos.x, b.pos.y - sim.state.restartPos.y))[0];
    expect(taker.pos.y).toBeGreaterThan(HALF_WID);
  });

  it('lets a dead ball roll off the pitch briefly before setting the throw-in', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    sim.state.players.forEach((p, i) => { p.pos = { x: -34 + i, y: i % 2 ? 20 : -20 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.pos = { x: 4, y: HALF_WID + 0.1 };
    sim.state.ball.vel = { x: 2, y: 7 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;

    sim.step(idle);
    expect(sim.state.phase).toBe('throwIn');
    const restart = { ...sim.state.restartPos };

    sim.step(idle);
    expect(sim.state.ball.pos.y).toBeGreaterThan(HALF_WID);
    expect(dist2(sim.state.ball.pos, restart)).toBeGreaterThan(0.4);

    stepMany(sim, Math.round(0.8 / DT), idle);
    // the thrower holds the ball OVER HIS HEAD behind the line — off the pitch at
    // throwing height, near the throw spot, not sitting on the line in front of him
    expect(sim.state.ball.z).toBeCloseTo(1.5, 1);
    expect(Math.abs(sim.state.ball.pos.y)).toBeGreaterThan(HALF_WID);
    expect(Math.abs(sim.state.ball.pos.x - sim.state.restartPos.x)).toBeLessThan(2);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBe(0);
  });

  it('ignores backward aftertouch so the ball only curves left or right', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = 1;
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 14, y: 0 };
    sim.state.ball.vz = 0;
    sim.state.ball.spin = 0;
    sim.state.ball.kickDir = { x: 1, y: 0 };
    (sim as unknown as { humans: { aftertouchUntil: number }[] }).humans[0].aftertouchUntil = sim.state.tick + Math.round(0.5 / DT);

    stepMany(sim, 1, [{ ...idleWithSwitch, moveX: -1 }, { ...NULL_INPUT }]);

    expect(sim.state.ball.vel.x).toBeGreaterThan(0);
    expect(sim.state.ball.vz).toBeLessThanOrEqual(0);
    expect(Math.abs(sim.state.ball.spin)).toBeLessThan(0.01);
  });

  it('curls an aftertouch shot toward the stick, matching the camera frame', () => {
    // +moveY is screen-DOWN (the input convention) and sim +y renders screen-down
    // (the open-play camera is fixed, never flips), so pushing the stick down must
    // bend the ball to +y and pushing up to -y — i.e. it curls where you point.
    const curlFor = (moveY: number) => {
      const sim = new MatchSim(makeHumanCfg());
      sim.state.phase = 'play';
      for (const p of sim.state.players) p.pos = { x: -40, y: p.idx }; // clear of the ball
      const b = sim.state.ball;
      b.ownerIdx = -1; b.lastTouchTeam = 0; b.lastKicker = 1;
      b.pos = { x: 0, y: 0 }; b.vel = { x: 16, y: 0 }; b.vz = 0; b.spin = 0;
      b.kickDir = { x: 1, y: 0 }; b.z = 0.3; // a ball driven to screen-right
      (sim as unknown as { humans: { aftertouchUntil: number }[] }).humans[0].aftertouchUntil = sim.state.tick + Math.round(0.4 / DT);
      for (let i = 0; i < 8; i++) sim.step([{ ...NULL_INPUT, moveY }, { ...NULL_INPUT }]);
      return sim.state.ball.vel.y;
    };
    expect(curlFor(1)).toBeGreaterThan(0.4);  // stick down -> ball bends down
    expect(curlFor(-1)).toBeLessThan(-0.4);   // stick up   -> ball bends up
  });

  it('accelerates controlled players quickly from the first input frames', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const ctl = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    ctl.pos = { x: -6, y: 0 };
    ctl.vel = { x: 0, y: 0 };
    sim.state.controlledIdx[0] = ctl.idx;
    sim.state.ball.ownerIdx = ctl.idx;
    sim.state.ball.pos = { ...ctl.pos };

    stepMany(sim, Math.round(0.12 / DT), [{ ...idleWithSwitch, moveX: 1 }, { ...NULL_INPUT }]);

    expect(ctl.vel.x).toBeGreaterThan(3.1);
  });

  it('uses the same max speed for controlled and AI players with matching attributes', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 0 }));
    const runner = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    runner.attrs = { ...runner.attrs, pace: 78 };
    runner.stamina = 0.84;
    const maxSpeed = (sim as unknown as { maxSpeed: (p: SimPlayer, sprinting: boolean) => number }).maxSpeed.bind(sim);

    runner.control = true;
    const controlledNormal = maxSpeed(runner, false);
    const controlledSprint = maxSpeed(runner, true);
    runner.control = false;
    const aiNormal = maxSpeed(runner, false);
    const aiSprint = maxSpeed(runner, true);

    expect(aiNormal).toBeCloseTo(controlledNormal, 5);
    expect(aiSprint).toBeCloseTo(controlledSprint, 5);
  });

  it('uses the same acceleration for human-controlled and AI players with matching attributes', () => {
    const speedAfterFrame = (controller: 'human' | 'ai') => {
      const cfg = makeCfg({ difficulty: 2 });
      cfg.teams[0] = { ...cfg.teams[0], controller };
      const sim = new MatchSim(cfg);
      sim.state.phase = 'play';
      const runner = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      runner.attrs = { ...runner.attrs, pace: 78 };
      runner.pos = { x: 0, y: 0 };
      runner.vel = { x: 0, y: 0 };
      runner.stamina = 1;
      runner.control = controller === 'human';
      sim.state.controlledIdx[0] = controller === 'human' ? runner.idx : -1;
      sim.state.ball.ownerIdx = -1;
      sim.state.ball.pos = { x: 10, y: 0 };
      sim.state.ball.vel = { x: 0, y: 0 };
      sim.state.players
        .filter((p) => p !== runner)
        .forEach((p, i) => { p.pos = { x: 30 + i * 0.4, y: i % 2 ? 25 : -25 }; });

      (sim as unknown as { integratePlayers: (inputs: [PadInput, PadInput], celebrating: boolean) => void })
        .integratePlayers(
          controller === 'human'
            ? [{ ...idleWithSwitch, moveX: 1, sprint: true }, { ...NULL_INPUT }]
            : idle,
          false,
        );

      return Math.hypot(runner.vel.x, runner.vel.y);
    };

    expect(speedAfterFrame('ai')).toBeCloseTo(speedAfterFrame('human'), 5);
  });

  it('uses pace for first-step acceleration as well as normal and sprint top speed', () => {
    const speedAfterFrame = (pace: number) => {
      const sim = new MatchSim(makeHumanCfg());
      sim.state.phase = 'play';
      const runner = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      runner.attrs = { ...runner.attrs, pace };
      runner.pos = { x: 0, y: 0 };
      runner.vel = { x: 0, y: 0 };
      runner.stamina = 1;
      runner.control = true;
      sim.state.controlledIdx[0] = runner.idx;
      sim.state.ball.ownerIdx = -1;
      sim.state.players
        .filter((p) => p !== runner)
        .forEach((p, i) => { p.pos = { x: 30 + i * 0.4, y: i % 2 ? 25 : -25 }; });

      (sim as unknown as { integratePlayers: (inputs: [PadInput, PadInput], celebrating: boolean) => void })
        .integratePlayers([{ ...idleWithSwitch, moveX: 1 }, { ...NULL_INPUT }], false);

      const maxSpeed = (sim as unknown as { maxSpeed: (p: SimPlayer, sprinting: boolean) => number }).maxSpeed.bind(sim);
      return {
        firstFrame: Math.hypot(runner.vel.x, runner.vel.y),
        normal: maxSpeed(runner, false),
        sprint: maxSpeed(runner, true),
      };
    };

    const low = speedAfterFrame(35);
    const high = speedAfterFrame(95);

    expect(high.firstFrame).toBeGreaterThan(low.firstFrame + 0.12);
    expect(high.normal).toBeGreaterThan(low.normal + 1.2);
    expect(high.sprint).toBeGreaterThan(high.normal + 1.6);
  });

  it('gives a controlled defender slight help when the stick points away from the ball', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const defender = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const attacker = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    defender.pos = { x: 0, y: 0 };
    defender.vel = { x: 0, y: 0 };
    defender.stamina = 1;
    defender.control = true;
    sim.state.controlledIdx[0] = defender.idx;
    attacker.pos = { x: 8, y: 0 };
    attacker.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    sim.state.players
      .filter((p) => p !== defender && p !== attacker)
      .forEach((p, i) => { p.pos = { x: 35 + i, y: i % 2 ? 26 : -26 }; });

    (sim as unknown as { integratePlayers: (inputs: [PadInput, PadInput], celebrating: boolean) => void })
      .integratePlayers([{ ...idleWithSwitch, moveX: -1 }, { ...NULL_INPUT }], false);

    expect(defender.vel.x).toBeGreaterThan(0);
  });

  it('does not add AI-only difficulty error to targeted passes', () => {
    const passAngle = (difficulty: 0 | 3) => {
      const sim = new MatchSim(makeCfg({ difficulty, seed: 1 }));
      sim.state.phase = 'play';
      const owner = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== owner)!;
      const marker = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
      const lineDefenders = sim.state.players.filter((p) => p.team === 1 && !p.isGK && p !== marker).slice(0, 2);
      owner.attrs = { ...owner.attrs, pass: 100 };
      owner.pos = { x: 0, y: 0 };
      owner.vel = { x: 0, y: 0 };
      owner.facing = 0;
      owner.kickCooldown = 0;
      mate.pos = { x: 14, y: 0 };
      mate.vel = { x: 0, y: 0 };
      marker.pos = { x: 0, y: 2.2 };
      lineDefenders.forEach((p, i) => { p.pos = { x: 18, y: i === 0 ? -8 : 8 }; });
      sim.state.players
        .filter((p) => p !== owner && p !== mate && p !== marker && !lineDefenders.includes(p))
        .forEach((p, i) => { p.pos = { x: -30 - i * 0.4, y: i % 2 ? 25 : -25 }; });
      sim.state.ball.ownerIdx = owner.idx;
      sim.state.ball.pos = { ...owner.pos };
      sim.state.ball.vel = { x: 0, y: 0 };

      (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

      expect(sim.events.some((e) => e.type === 'pass' && e.target === mate.idx)).toBe(true);
      return Math.atan2(sim.state.ball.vel.y, sim.state.ball.vel.x);
    };

    expect(angleDelta(passAngle(0), passAngle(3))).toBeLessThan(0.0001);
  });

  it('does not add AI-only difficulty error to shot accuracy', () => {
    const shotAngle = (difficulty: 0 | 3) => {
      const sim = new MatchSim(makeCfg({ difficulty, seed: 9999 }));
      const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      shooter.attrs = { ...shooter.attrs, shoot: 42 };
      shooter.pos = { x: HALF_LEN - 20, y: 4 };
      shooter.vel = { x: 0, y: 0 };

      (sim as unknown as { aiShoot: (owner: SimPlayer, goal: { x: number; y: number }) => void })
        .aiShoot(shooter, { x: HALF_LEN, y: 0 });

      return Math.atan2(sim.state.ball.vel.y, sim.state.ball.vel.x);
    };

    expect(angleDelta(shotAngle(0), shotAngle(3))).toBeLessThan(0.0001);
  });

  it('keeps close AI finishes low and driven', () => {
    const sim = new MatchSim(makeCfg({ seed: 20260614 }));
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    shooter.attrs = { ...shooter.attrs, shoot: 92 };
    shooter.pos = { x: HALF_LEN - 9.5, y: 0.6 };
    shooter.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = shooter.idx;
    sim.state.ball.pos = { ...shooter.pos };

    (sim as unknown as { aiShoot: (owner: SimPlayer, goal: { x: number; y: number }) => void })
      .aiShoot(shooter, { x: HALF_LEN, y: 0 });

    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(27);
    expect(sim.state.ball.vz).toBeLessThan(2.1);
  });

  it('aims narrow angle AI finishes across goal', () => {
    const sim = new MatchSim(makeCfg());
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    shooter.attrs = { ...shooter.attrs, shoot: 90 };
    shooter.pos = { x: HALF_LEN - 8, y: 8.4 };
    shooter.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = shooter.idx;
    sim.state.ball.pos = { ...shooter.pos };
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: () => 0.8,
      range: (a: number, b: number) => (a + b) / 2,
    };

    (sim as unknown as { aiShoot: (owner: SimPlayer, goal: { x: number; y: number }) => void })
      .aiShoot(shooter, { x: HALF_LEN, y: 0 });

    const tToLine = (HALF_LEN - sim.state.ball.pos.x) / sim.state.ball.vel.x;
    const yAtLine = sim.state.ball.pos.y + sim.state.ball.vel.y * tToLine;
    expect(yAtLine).toBeLessThan(-GOAL_HALF_WIDTH * 0.25);
  });

  it('lets AI pressers sprint to close down from outside the short ball radius', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const presser = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 8, y: 0 };
    presser.pos = { x: 22, y: 0 };
    presser.stamina = 1;
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK && p !== presser)
      .forEach((p, i) => { p.pos = { x: 34 + i * 0.5, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };

    const target = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(presser);
    const wantsSprint = (sim as unknown as { aiWantsSprint: (p: SimPlayer, target: { x: number; y: number }) => boolean })
      .aiWantsSprint(presser, target);

    expect(dist2(target, carrier.pos)).toBeLessThan(1.2);
    expect(wantsSprint).toBe(true);
  });

  it('lets AI support runners sprint into attacking space away from the ball', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const runner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    owner.pos = { x: 12, y: -8 };
    runner.pos = { x: 4, y: 15 };
    runner.stamina = 1;
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };

    const target = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(runner);
    const wantsSprint = (sim as unknown as { aiWantsSprint: (p: SimPlayer, target: { x: number; y: number }) => boolean })
      .aiWantsSprint(runner, target);

    expect(target.x).toBeGreaterThan(runner.pos.x + 4);
    expect(dist2(runner.pos, sim.state.ball.pos)).toBeGreaterThan(12);
    expect(wantsSprint).toBe(true);
  });

  it('sprints bunched support players out to wide attacking targets', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const support = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    owner.pos = { x: 2, y: -2 };
    support.pos = { x: 4, y: 1 };
    support.stamina = 1;
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const target = { x: support.pos.x, y: owner.pos.y + 15 };

    const wantsSprint = (sim as unknown as { aiWantsSprint: (p: SimPlayer, target: { x: number; y: number }) => boolean })
      .aiWantsSprint(support, target);

    expect(wantsSprint).toBe(true);
  });

  it('spreads AI attackers into width and depth during a fast break', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: -3, y: -2 };
    carrier.vel = { x: 5.5, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    (sim as unknown as { lastTurnover: { tick: number; team: 0 | 1 } }).lastTurnover = { tick: sim.state.tick, team: 0 };

    const attackers = sim.state.players.filter((p) => p.team === 0 && !p.isGK && p !== carrier);
    attackers.forEach((p, i) => {
      p.pos = { x: carrier.pos.x - 2 + (i % 3) * 0.4, y: carrier.pos.y + ((i % 4) - 1.5) * 0.5 };
      p.vel = { x: 0, y: 0 };
    });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 20 + (i % 4) * 2, y: -14 + i * 3.4 }; });

    const targets = attackers
      .map((p) => ({ p, target: (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(p) }))
      .filter(({ p }) => p.attrs.pos === 'FW' || p.attrs.pos === 'MF');
    const wideTargets = targets.filter(({ target }) => Math.abs(target.y - carrier.pos.y) > 8);
    const depthTargets = targets.filter(({ target }) => target.x - carrier.pos.x > 9);

    expect(wideTargets.length).toBeGreaterThanOrEqual(2);
    expect(depthTargets.length).toBeGreaterThanOrEqual(2);
  });

  it('does not choose sterile backwards AI passes on an open counter attack', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2, seed: 12 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const backward = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF')!;
    const wideForward = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    carrier.pos = { x: 1, y: 0 };
    carrier.vel = { x: 4.8, y: 0 };
    carrier.kickCooldown = 0;
    backward.pos = { x: carrier.pos.x - 11, y: 0.8 };
    wideForward.pos = { x: carrier.pos.x + 15, y: 12 };
    wideForward.vel = { x: 2.2, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && p !== carrier && p !== backward && p !== wideForward)
      .forEach((p, i) => { p.pos = { x: -24 - i, y: i % 2 ? 24 : -24 }; });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 24 + (i % 4) * 2, y: -16 + i * 4 }; });
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    (sim as unknown as { lastTurnover: { tick: number; team: 0 | 1 } }).lastTurnover = { tick: sim.state.tick, team: 0 };

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'pass', target: wideForward.idx }));
    expect(sim.events).not.toContainEqual(expect.objectContaining({ type: 'pass', target: backward.idx }));
  });

  it('avoids short AI recycle passes into a crowded support cluster', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2, seed: 21 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const clustered = sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== carrier)
      .slice(0, 3);
    carrier.pos = { x: 0, y: 0 };
    carrier.vel = { x: 0, y: 0 };
    carrier.facing = 0;
    carrier.kickCooldown = 0;
    carrier.stamina = 0.1;
    clustered[0].pos = { x: 0.8, y: 4.9 };
    clustered[1].pos = { x: -1.2, y: -4.8 };
    clustered[2].pos = { x: 2.1, y: -4.2 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== carrier && !clustered.includes(p))
      .forEach((p, i) => { p.pos = { x: -44 - i * 0.5, y: i % 2 ? 26 : -26 }; });
    const presser = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    presser.pos = { x: 1.8, y: 0.2 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK && p !== presser)
      .forEach((p, i) => { p.pos = { x: 24 + i * 1.5, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    expect(sim.events.some((e) => e.type === 'pass' && clustered.some((p) => p.idx === e.target))).toBe(false);
  });

  it('uses midfielders to press while defenders hold the line outside danger', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const defender = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    const midfielder = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 8, y: 0 };
    defender.pos = { x: 9.8, y: 0.3 };
    midfielder.pos = { x: 12, y: 1.4 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK && p !== defender && p !== midfielder)
      .forEach((p, i) => { p.pos = { x: 34 + i * 0.5, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };

    const defenderTarget = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(defender);
    const midfielderTarget = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(midfielder);

    expect(dist2(midfielderTarget, carrier.pos)).toBeLessThan(1.2);
    expect(dist2(defenderTarget, carrier.pos)).toBeGreaterThan(3.5);
  });

  it('keeps the secondary presser in a cover shadow instead of the same tackle pocket', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 9, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const midfielders = sim.state.players.filter((p) => p.team === 1 && p.attrs.pos === 'MF');
    midfielders[0].pos = { x: 11.5, y: 1.2 };
    midfielders[1].pos = { x: 12.4, y: -1.4 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK && p.attrs.pos !== 'MF')
      .forEach((p, i) => { p.pos = { x: 28 + i, y: i % 2 ? 22 : -22 }; });
    const press = (sim as unknown as {
      pressAssignments: (team: 0 | 1, carrier: SimPlayer) => { secondary: SimPlayer | null };
    }).pressAssignments(1, carrier);
    expect(press.secondary).not.toBeNull();

    const target = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(press.secondary!);

    expect(dist2(target, carrier.pos)).toBeGreaterThan(5.5);
  });

  it('keeps CPU defenders on a shared line instead of leaving one deep player onside', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 11, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const defenders = sim.state.players.filter((p) => p.team === 1 && p.attrs.pos === 'DF');
    defenders.forEach((p, i) => {
      p.pos = { x: i === 0 ? 43 : 29 + i * 0.4, y: -15 + i * 10 };
      p.vel = { x: 0, y: 0 };
    });
    sim.state.players
      .filter((p) => p.team === 0 && p !== carrier && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 15 + i * 0.8, y: i % 2 ? 18 : -18 }; });

    const targets = defenders.map((p) => (
      (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(p)
    ));
    const lineXs = targets.map((t) => t.x);
    const deepest = Math.max(...lineXs);
    const highest = Math.min(...lineXs);

    expect(deepest - highest).toBeLessThan(5.5);
    expect(deepest).toBeLessThan(36);
  });

  it('does not let one defender drop with a harmless wide runner and play everyone onside', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const wideRunner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    const wideDefender = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    carrier.pos = { x: 8, y: 0 };
    wideRunner.pos = { x: 36, y: -HALF_WID + 2.5 };
    wideRunner.vel = { x: 0, y: 0 };
    wideDefender.pos = { x: 39, y: -HALF_WID + 3.2 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'DF' && p !== wideDefender)
      .forEach((p, i) => { p.pos = { x: 28 + i * 0.5, y: -10 + i * 8 }; });
    sim.state.players
      .filter((p) => p.team === 0 && p !== carrier && p !== wideRunner && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 12 + i * 0.7, y: i % 2 ? 15 : -15 }; });

    const target = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(wideDefender);

    expect(target.x).toBeLessThan(33);
  });

  it('keeps defensive midfield and forward lines staggered instead of collapsing onto the carrier', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 4, y: 2 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const defender = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    const midfielder = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF')!;
    const forward = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'FW')!;

    const formationTarget = (p: SimPlayer) => (
      (sim as unknown as { formationTarget: (player: SimPlayer) => { x: number; y: number } }).formationTarget(p)
    );
    const defenderTarget = formationTarget(defender);
    const midfielderTarget = formationTarget(midfielder);
    const forwardTarget = formationTarget(forward);

    expect(midfielderTarget.x).toBeLessThan(defenderTarget.x - 5);
    expect(forwardTarget.x).toBeLessThan(midfielderTarget.x - 5);
    // forward holds well clear of the carrier (a real collapse would be a few
    // metres); the exact figure flexes ~half a metre with the team's line-height
    // identity, so this guards against collapse rather than pinning a number
    expect(dist2(forwardTarget, carrier.pos)).toBeGreaterThan(9.5);
  });

  it('keeps centre-backs out of the carrier pressure cluster when midfielders are pressing', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'FW')!;
    carrier.pos = { x: -24, y: -3 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const attackers = sim.state.players.filter((p) => p.team === 1 && !p.isGK && p !== carrier);
    attackers.forEach((p, i) => { p.pos = { x: -23 + i * 0.3, y: -5 + (i % 3) * 3.2 }; });
    const midfielders = sim.state.players.filter((p) => p.team === 0 && p.attrs.pos === 'MF');
    midfielders[0].pos = { x: -21.5, y: -3.5 };
    midfielders[1].pos = { x: -20.5, y: 0.2 };
    const centreBacks = sim.state.players.filter((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.4);
    centreBacks.forEach((p, i) => { p.pos = { x: -28 - i * 1.5, y: -5 + i * 8 }; });
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p.attrs.pos !== 'MF' && !centreBacks.includes(p))
      .forEach((p, i) => { p.pos = { x: -12 + i, y: i % 2 ? 22 : -22 }; });

    const targets = centreBacks.map((p) => (
      (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p)
    ));

    expect(targets.every((target) => dist2(target, carrier.pos) > 6.2)).toBe(true);
  });

  it('has AI shoot instead of passing backwards when clean through on goal', () => {
    const sim = new MatchSim(makeCfg({ seed: 7 }));
    sim.state.phase = 'play';
    const striker = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    const backPass = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && p !== striker)
      ?? sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== striker)!;
    striker.attrs = { ...striker.attrs, shoot: 78 };
    // already in a real finishing range (inside the box): from here he takes it on
    // rather than recycling. From further out with the keeper on his line he would
    // instead carry closer first — that is covered by the one-on-one carry test.
    striker.pos = { x: HALF_LEN - 13, y: 0 };
    striker.vel = { x: 0, y: 0 };
    striker.kickCooldown = 0;
    backPass.pos = { x: striker.pos.x - 6, y: 0 };
    backPass.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -20 - i, y: i % 2 ? 22 : -22 }; });
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1, y: 0 };
    sim.state.ball.ownerIdx = striker.idx;
    sim.state.ball.pos = { ...striker.pos };
    sim.state.ball.vel = { x: 0, y: 0 };

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    expect(sim.events.some((e) => e.type === 'shot' && e.team === 0)).toBe(true);
    expect(sim.events.some((e) => e.type === 'pass' && e.target === backPass.idx)).toBe(false);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(true);
  });

  it('assists manual passes toward a nearby teammate instead of empty space', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const ctl = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== ctl)!;
    ctl.pos = { x: 0, y: 0 };
    ctl.facing = 0;
    mate.pos = { x: -4, y: 9 };
    mate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== ctl && p !== mate)
      .forEach((p, i) => { p.pos = { x: 28 + i, y: i % 2 ? 28 : -28 }; });
    sim.state.controlledIdx[0] = ctl.idx;
    sim.state.ball.ownerIdx = ctl.idx;
    sim.state.ball.pos = { ...ctl.pos };
    const input = { ...idleWithSwitch, moveX: -1, moveY: 0, pass: true };

    sim.step([input, { ...NULL_INPUT }]);
    sim.step([{ ...input, pass: false }, { ...NULL_INPUT }]);

    const toMate = Math.atan2(mate.pos.y - ctl.pos.y, mate.pos.x - ctl.pos.x);
    const ballDir = Math.atan2(sim.state.ball.vel.y, sim.state.ball.vel.x);
    expect(Math.abs(Math.atan2(Math.sin(ballDir - toMate), Math.cos(ballDir - toMate)))).toBeLessThan(0.25);
  });

  it('nudges aimless manual passes toward a nearby teammate just outside the aim cone', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const ctl = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== ctl)!;
    ctl.pos = { x: 0, y: 0 };
    ctl.facing = 0;
    mate.pos = { x: 1, y: 12 };
    mate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== ctl && p !== mate)
      .forEach((p, i) => { p.pos = { x: -34 - i, y: i % 2 ? 27 : -27 }; });
    sim.state.controlledIdx[0] = ctl.idx;
    sim.state.ball.ownerIdx = ctl.idx;
    sim.state.ball.pos = { ...ctl.pos };
    const input = { ...idleWithSwitch, moveX: 1, moveY: 0, pass: true };

    sim.step([input, { ...NULL_INPUT }]);
    sim.step([{ ...input, pass: false }, { ...NULL_INPUT }]);

    const ballDir = Math.atan2(sim.state.ball.vel.y, sim.state.ball.vel.x);
    expect(ballDir).toBeGreaterThan(0.25);
    expect(ballDir).toBeLessThan(Math.PI / 2);
  });

  it('puts more pace on targeted ground passes', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    passer.pos = { x: -14, y: 0 };
    passer.facing = 0;
    mate.pos = { x: 24, y: 0 };
    mate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== passer && p !== mate)
      .forEach((p, i) => { p.pos = { x: -24 - i, y: i % 2 ? 28 : -28 }; });
    sim.state.players
      .filter((p) => p.team === 1)
      .forEach((p, i) => { p.pos = { x: 30 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(25);
  });

  it('emits targeted pass events with passer and receiver for commentary', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    passer.pos = { x: -14, y: 0 };
    passer.facing = 0;
    mate.pos = { x: 4, y: 0.5 };
    mate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== passer && p !== mate)
      .forEach((p, i) => { p.pos = { x: 30 + i, y: i % 2 ? 28 : -28 }; });
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.events).toContainEqual(expect.objectContaining({
      type: 'pass',
      team: 0,
      player: passer.idx,
      target: mate.idx,
    }));
  });

  it('does not apply aftertouch curl to targeted ground passes', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    // this test isolates AFTERTOUCH on a targeted pass — use an elite passer so the
    // (attribute-driven) accuracy cone is negligible and any vel.y is from aftertouch
    passer.attrs = { ...passer.attrs, pass: 99 };
    passer.pos = { x: -12, y: 0 };
    passer.facing = 0;
    mate.pos = { x: 18, y: 0 };
    mate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== passer && p !== mate)
      .forEach((p, i) => { p.pos = { x: -26 - i, y: i % 2 ? 28 : -28 }; });
    sim.state.players
      .filter((p) => p.team === 1)
      .forEach((p, i) => { p.pos = { x: 31 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);
    stepMany(sim, Math.round(0.3 / DT), [{ ...idleWithSwitch, moveY: 1 }, { ...NULL_INPUT }]);

    expect(Math.abs(sim.state.ball.spin)).toBeLessThan(0.01);
    expect(Math.abs(sim.state.ball.vel.y)).toBeLessThan(0.9);
  });

  it('does not bend live pass assist sideways off the launch line', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const receiver = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    receiver.pos = { x: 3.2, y: 2.2 };
    receiver.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 20, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;
    sim.state.ball.kickDir = { x: 1, y: 0 };
    (sim as unknown as { livePassTargetIdx: number }).livePassTargetIdx = receiver.idx;
    (sim as unknown as { livePassTargetUntil: number }).livePassTargetUntil = sim.state.tick + Math.round(1 / DT);

    sim.step(idle);

    expect(Math.abs(sim.state.ball.vel.y)).toBeLessThan(0.08);
  });

  it('helps the intended target collect a ground pass before it runs beyond them', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    passer.pos = { x: -10, y: 0 };
    passer.facing = 0;
    mate.pos = { x: 28, y: 0.5 };
    mate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== passer && p !== mate)
      .forEach((p, i) => { p.pos = { x: -18 - i, y: i % 2 ? 26 : -26 }; });
    sim.state.players
      .filter((p) => p.team === 1)
      .forEach((p, i) => { p.pos = { x: 32 + i * 0.4, y: i % 2 ? 24 : -24 }; });
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    let collected = false;
    let worstOvershoot = 0;
    for (let i = 0; i < Math.round(3.1 / DT); i++) {
      sim.step(idle);
      if (sim.state.ball.ownerIdx === mate.idx) {
        collected = true;
        break;
      }
      worstOvershoot = Math.max(worstOvershoot, sim.state.ball.pos.x - mate.pos.x);
    }
    expect(collected).toBe(true);
    expect(worstOvershoot).toBeLessThan(1.2);
  });

  it('prioritises a short safe teammate for tap passes without stick direction', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const shortMate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    const longMate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer && p !== shortMate)!;
    passer.pos = { x: -10, y: 0 };
    passer.facing = 0;
    shortMate.pos = { x: -5, y: 3.2 };
    shortMate.vel = { x: 0, y: 0 };
    longMate.pos = { x: 26, y: 0 };
    longMate.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== passer && p !== shortMate && p !== longMate)
      .forEach((p, i) => { p.pos = { x: -28 - i, y: i % 2 ? 27 : -27 }; });
    sim.state.players
      .filter((p) => p.team === 1)
      .forEach((p, i) => { p.pos = { x: 30 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false }, { ...NULL_INPUT }]);

    expect(sim.events).toContainEqual(expect.objectContaining({
      type: 'pass',
      team: 0,
      player: passer.idx,
      target: shortMate.idx,
    }));
    const toShort = Math.atan2(shortMate.pos.y - passer.pos.y, shortMate.pos.x - passer.pos.x);
    const ballDir = Math.atan2(sim.state.ball.vel.y, sim.state.ball.vel.x);
    expect(Math.abs(Math.atan2(Math.sin(ballDir - toShort), Math.cos(ballDir - toShort)))).toBeLessThan(0.16);
  });

  it('does not let a human-team receiver auto-kick before control switches to him', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const receiver = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const previous = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== receiver)!;
    receiver.pos = { x: HALF_LEN - 8, y: 0.2 };
    receiver.vel = { x: 0, y: 0 };
    receiver.attrs = { ...receiver.attrs, shoot: 95, pass: 95 };
    previous.control = true;
    receiver.control = false;
    sim.state.controlledIdx[0] = previous.idx;
    sim.state.ball.ownerIdx = receiver.idx;
    sim.state.ball.pos = { ...receiver.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -30 - i, y: i % 2 ? 24 : -24 }; });

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    expect(sim.state.ball.ownerIdx).toBe(receiver.idx);
    expect(sim.events.some((e) => e.type === 'kick' || e.type === 'shot' || e.type === 'pass')).toBe(false);
  });

  it('does not brake a live targeted pass before the receiver can trap it', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const receiver = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    receiver.pos = { x: 2.2, y: 0 };
    receiver.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: 0, y: 0 };
    sim.state.ball.vel = { x: 20, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;
    sim.state.ball.kickDir = { x: 1, y: 0 };
    (sim as unknown as { livePassTargetIdx: number }).livePassTargetIdx = receiver.idx;
    (sim as unknown as { livePassTargetUntil: number }).livePassTargetUntil = sim.state.tick + Math.round(1 / DT);

    sim.step(idle);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(19.2);
  });

  it('lets kickoff passes use the requested side instead of always the same lane', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.restartTimer = 0;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    const beforeY = taker.pos.y;

    sim.step([{ ...idleWithSwitch, pass: true, moveY: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(sim.state.ball.vel.y).toBeGreaterThan(1.2);
    expect(sim.state.ball.vel.x).toBeLessThan(0.5);
    expect(beforeY).toBeGreaterThanOrEqual(0);
  });

  it('puts zippy pace on kickoff passes', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.restartTimer = 0;

    sim.step([{ ...idleWithSwitch, pass: true, moveY: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(18);
  });

  it('launches player shots with more power', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    shooter.pos = { x: HALF_LEN - 26, y: 1 };
    shooter.facing = 0;
    sim.state.controlledIdx[0] = shooter.idx;
    sim.state.ball.ownerIdx = shooter.idx;
    sim.state.ball.pos = { ...shooter.pos };

    sim.step([{ ...idleWithSwitch, shoot: true, moveX: 1 }, { ...NULL_INPUT }]);
    stepMany(sim, Math.round(0.28 / DT), [{ ...idleWithSwitch, shoot: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, shoot: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(27);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(true);
  });

  it('does not trap a targeted pass until it reaches the player', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const receiver = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    receiver.pos = { x: 8, y: 0 };
    receiver.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: receiver.pos.x - 2.4, y: receiver.pos.y };
    sim.state.ball.vel = { x: 4, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;
    sim.state.ball.kickDir = { x: 1, y: 0 };
    (sim as unknown as { livePassTargetIdx: number }).livePassTargetIdx = receiver.idx;
    (sim as unknown as { livePassTargetUntil: number }).livePassTargetUntil = sim.state.tick + Math.round(1 / DT);

    sim.step(idle);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(dist2(sim.state.ball.pos, receiver.pos)).toBeGreaterThan(1.2);
  });

  it('keeps the dribbled ball close enough to look like foot contact', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    carrier.pos = { x: -8, y: 0 };
    carrier.vel = { x: 0, y: 0 };
    carrier.facing = 0;
    sim.state.controlledIdx[0] = carrier.idx;
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { x: carrier.pos.x + 0.4, y: carrier.pos.y };
    sim.state.ball.vel = { x: 0, y: 0 };

    let maxCarry = 0;
    let minCarry = Infinity;
    for (let i = 0; i < Math.round(0.9 / DT); i++) {
      sim.step([{ ...idleWithSwitch, moveX: 1, sprint: true, shoot: true }, { ...NULL_INPUT }]);
      const carry = dist2(sim.state.ball.pos, carrier.pos);
      maxCarry = Math.max(maxCarry, carry);
      minCarry = Math.min(minCarry, carry);
    }

    expect(sim.state.ball.ownerIdx).toBe(carrier.idx);
    expect(minCarry).toBeLessThan(0.72);
    expect(maxCarry).toBeLessThan(1.05);
  });

  it('allows up to five substitutions at a stoppage, blocks them in open play, and swaps attributes', () => {
    const sim = new MatchSim(makeHumanCfg());
    const outs = sim.state.players.filter((p) => p.team === 0 && !p.isGK).slice(0, 6);
    const active = new Set(sim.state.players.filter((p) => p.team === 0).map((p) => p.squadIdx));
    const bench = TEAMS[0].players
      .map((_, i) => i)
      .filter((i) => !active.has(i) && TEAMS[0].players[i].pos !== 'GK');

    expect(sim.state.substitutionsUsed).toEqual([0, 0]);

    // open play: subs are refused
    sim.state.phase = 'play';
    expect(sim.substitute(0, outs[0].idx, bench[0])).toBe(false);
    expect(sim.state.substitutionsUsed[0]).toBe(0);

    // at a stoppage: up to five allowed, the sixth refused
    sim.state.phase = 'goalKick';
    expect(sim.substitute(0, outs[0].idx, bench[0])).toBe(true);
    expect(outs[0].attrs.name).toBe(TEAMS[0].players[bench[0]].name);
    expect(sim.substitute(0, outs[1].idx, bench[1])).toBe(true);
    expect(sim.substitute(0, outs[2].idx, bench[2])).toBe(true);
    expect(sim.substitute(0, outs[3].idx, bench[3])).toBe(true);
    expect(sim.substitute(0, outs[4].idx, bench[4])).toBe(true);
    expect(sim.substitute(0, outs[5].idx, bench[5])).toBe(false);
    expect(sim.state.substitutionsUsed[0]).toBe(5);
  });

  it('uses the configured era substitution limit', () => {
    const sim = new MatchSim(makeHumanCfg({ era: { year: 1994, substitutionLimit: 2, fireworks: false } }));
    const outs = sim.state.players.filter((p) => p.team === 0 && !p.isGK).slice(0, 3);
    const active = new Set(sim.state.players.filter((p) => p.team === 0).map((p) => p.squadIdx));
    const bench = TEAMS[0].players
      .map((_, i) => i)
      .filter((i) => !active.has(i) && TEAMS[0].players[i].pos !== 'GK');

    sim.state.phase = 'goalKick';

    expect(sim.substitute(0, outs[0].idx, bench[0])).toBe(true);
    expect(sim.substitute(0, outs[1].idx, bench[1])).toBe(true);
    expect(sim.substitute(0, outs[2].idx, bench[2])).toBe(false);
    expect(sim.state.substitutionsUsed[0]).toBe(2);
  });

  it('blocks substitutions entirely before substitutions existed', () => {
    const sim = new MatchSim(makeHumanCfg({ era: { year: 1930, substitutionLimit: 0, fireworks: false } }));
    const off = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const active = new Set(sim.state.players.filter((p) => p.team === 0).map((p) => p.squadIdx));
    const bench = TEAMS[0].players.findIndex((p, i) => !active.has(i) && p.pos === off.attrs.pos);

    sim.state.phase = 'goalKick';

    expect(sim.substitute(0, off.idx, bench)).toBe(false);
    expect(sim.state.substitutionsUsed[0]).toBe(0);
  });

  it('does not apply aftertouch to kickoff passes', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.restartTimer = 0;
    const input = { ...idleWithSwitch, pass: true, moveY: 1 };

    sim.step([input, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, moveY: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(Math.abs(sim.state.ball.spin)).toBeLessThan(0.01);
    expect(sim.state.ball.vz).toBe(0);
  });

  it('takes a throw-in when pass was already held before the restart timer cleared', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'throwIn';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: 4, y: HALF_WID - 0.2 };
    sim.state.restartTimer = 0;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.pos = (sim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();
    (sim as unknown as { prevInputs: [PadInput, PadInput] }).prevInputs = [{ ...idleWithSwitch, pass: true }, { ...NULL_INPUT }];

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1, moveY: -0.3 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.z).toBeGreaterThan(1);
  });

  it('takes held corner crosses without arming aftertouch curl', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'corner';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - 0.4, y: HALF_WID - 0.4 };
    sim.state.restartTimer = 0;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.pos = (sim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();
    (sim as unknown as { prevInputs: [PadInput, PadInput] }).prevInputs = [{ ...idleWithSwitch, pass: true }, { ...NULL_INPUT }];

    sim.step([{ ...idleWithSwitch, pass: true, moveX: -1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, moveY: -1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(Math.abs(sim.state.ball.spin)).toBeLessThan(0.01);
  });

  it('takes held free-kick passes without arming aftertouch curl', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'freeKick';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: -8, y: 10 };
    sim.state.restartTimer = 0;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.pos = (sim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();
    (sim as unknown as { prevInputs: [PadInput, PadInput] }).prevInputs = [{ ...idleWithSwitch, pass: true }, { ...NULL_INPUT }];

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, moveY: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(Math.abs(sim.state.ball.spin)).toBeLessThan(0.01);
  });

  it('creates short and forward support options around attacking throw-ins', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'throwIn';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: 6, y: HALF_WID - 0.2 };
    sim.state.restartTimer = 0.4;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    const targets = sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== taker)
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));

    expect(targets.filter((target) => target.y < HALF_WID - 2 && dist2(target, sim.state.restartPos) < 15).length).toBeGreaterThanOrEqual(2);
    expect(targets.some((target) => target.x > sim.state.restartPos.x + 7 && target.y < HALF_WID - 4)).toBe(true);
  });

  it('creates edge and box runners for attacking corners', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'corner';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - 0.4, y: HALF_WID - 0.4 };
    sim.state.restartTimer = 0.4;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    const targets = sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== taker)
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));

    expect(targets.filter((target) => target.x > HALF_LEN - 15 && Math.abs(target.y) < 11).length).toBeGreaterThanOrEqual(3);
    expect(targets.some((target) => target.x < HALF_LEN - 18 && Math.abs(target.y) < 18)).toBe(true);
  });

  it('uses normal zippy targeted pass pace from throw-ins and free kicks', () => {
    const throwSim = new MatchSim(makeHumanCfg());
    throwSim.state.phase = 'throwIn';
    throwSim.state.restartTeam = 0;
    throwSim.state.restartPos = { x: 4, y: HALF_WID - 0.2 };
    throwSim.state.restartTimer = 0;
    let taker = (throwSim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.pos = (throwSim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();
    const throwReceiver = throwSim.state.players.find((p) => p.team === 0 && !p.isGK && p !== taker)!;
    throwReceiver.pos = { x: 12, y: HALF_WID - 8 };
    for (let i = 0; i < 4; i++) throwSim.step([{ ...idleWithSwitch, pass: true }, { ...NULL_INPUT }]);
    let throwPassEvent = false;
    let guard = 0;
    while (String(throwSim.state.phase) !== 'play' && guard++ < 10) {
      throwSim.step([{ ...idleWithSwitch }, { ...NULL_INPUT }]);
      if (throwSim.events.some((e) => e.type === 'pass' && e.target === throwReceiver.idx)) throwPassEvent = true;
    }

    expect(Math.hypot(throwSim.state.ball.vel.x, throwSim.state.ball.vel.y)).toBeGreaterThan(15);
    expect(throwPassEvent).toBe(true);

    const freeSim = new MatchSim(makeHumanCfg());
    freeSim.state.phase = 'freeKick';
    freeSim.state.restartTeam = 0;
    freeSim.state.restartPos = { x: -8, y: 9 };
    freeSim.state.restartTimer = 0;
    taker = (freeSim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.pos = (freeSim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();
    const freeReceiver = freeSim.state.players.find((p) => p.team === 0 && !p.isGK && p !== taker)!;
    freeReceiver.pos = { x: 9, y: 7 };
    freeSim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== taker && p !== freeReceiver)
      .forEach((p, i) => { p.pos = { x: -28 - i, y: i % 2 ? 27 : -27 }; });
    for (let i = 0; i < 4; i++) freeSim.step([{ ...idleWithSwitch, pass: true }, { ...NULL_INPUT }]);
    guard = 0;
    while (String(freeSim.state.phase) !== 'play' && guard++ < 10) {
      freeSim.step([{ ...idleWithSwitch }, { ...NULL_INPUT }]);
    }

    expect(Math.hypot(freeSim.state.ball.vel.x, freeSim.state.ball.vel.y)).toBeGreaterThan(16);
    expect(freeSim.events.some((e) => e.type === 'pass' && typeof e.target === 'number')).toBe(true);
  });

  it('places the corner taker outside the pitch', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'corner';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - 0.4, y: HALF_WID - 0.4 };
    sim.state.restartTimer = 0.4;

    sim.step(idle);

    const taker = sim.state.players
      .filter((p) => p.team === 0 && !p.isGK)
      .sort((a, b) => Math.hypot(a.pos.x - sim.state.restartPos.x, a.pos.y - sim.state.restartPos.y)
        - Math.hypot(b.pos.x - sim.state.restartPos.x, b.pos.y - sim.state.restartPos.y))[0];
    expect(taker.pos.x).toBeGreaterThan(HALF_LEN);
    expect(taker.pos.y).toBeGreaterThan(HALF_WID);
  });

  it('lets CPU defenders tackle a nearby ball carrier', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const defender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    carrier.pos = { x: 0, y: 0 };
    defender.pos = { x: 0.35, y: 0 };
    defender.attrs.tackle = 99;
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.ball.z = 0;

    sim.step(idle);

    expect(sim.events.some((e) => e.type === 'tackle' || e.type === 'foul')).toBe(true);
    expect(sim.state.ball.ownerIdx).not.toBe(carrier.idx);
  });

  it('lets a running player make a standing tackle by contacting the ball carrier', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const defender = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const carrier = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    defender.pos = { x: 0.95, y: 0 };
    defender.vel = { x: -5.8, y: 0 };
    defender.facing = Math.PI;
    defender.attrs.tackle = 92;
    carrier.pos = { x: 0, y: 0 };
    carrier.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p !== defender && p !== carrier)
      .forEach((p, i) => { p.pos = { x: 24 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.controlledIdx[0] = defender.idx;
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;

    sim.step([{ ...idleWithSwitch, moveX: -1 }, { ...NULL_INPUT }]);

    expect(sim.events.some((e) => e.type === 'tackle' && e.player === defender.idx)).toBe(true);
    expect(sim.state.ball.ownerIdx).not.toBe(carrier.idx);
  });

  it('makes tackle skill decide whether a standing contact tackle wins cleanly', () => {
    const run = (tackle: number) => {
      const sim = new MatchSim(makeHumanCfg());
      sim.state.phase = 'play';
      const defender = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      const carrier = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
      defender.pos = { x: 0.82, y: 0 };
      defender.vel = { x: -5.2, y: 0 };
      defender.facing = Math.PI;
      defender.attrs.tackle = tackle;
      carrier.pos = { x: 0, y: 0 };
      carrier.vel = { x: 0, y: 0 };
      sim.state.players
        .filter((p) => p !== defender && p !== carrier)
        .forEach((p, i) => { p.pos = { x: 25 + i, y: i % 2 ? 24 : -24 }; });
      sim.state.controlledIdx[0] = defender.idx;
      sim.state.ball.ownerIdx = carrier.idx;
      sim.state.ball.pos = { ...carrier.pos };
      sim.step([{ ...idleWithSwitch, moveX: -1 }, { ...NULL_INPUT }]);
      return {
        owner: sim.state.ball.ownerIdx,
        tackle: sim.events.some((e) => e.type === 'tackle' && e.player === defender.idx),
        foul: sim.events.some((e) => e.type === 'foul'),
        defender,
      };
    };

    const low = run(25);
    const high = run(95);

    expect(high.tackle).toBe(true);
    expect(high.owner === high.defender.idx || high.owner === -1).toBe(true);
    expect(low.tackle).toBe(false);
    expect(low.foul || low.owner !== low.defender.idx).toBe(true);
  });

  it('makes booked CPU players avoid marginal tackles away from immediate danger', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const defender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    carrier.pos = { x: -6, y: 0 };
    carrier.vel = { x: 1.2, y: 0 };
    defender.pos = { x: -5.0, y: 0.08 };
    defender.vel = { x: 0, y: 0 };
    defender.yellowCards = 1;
    defender.attrs.tackle = 55;
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK && p !== defender)
      .forEach((p, i) => { p.pos = { x: 24 + i, y: i % 2 ? 25 : -25 }; });
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.ball.z = 0;

    sim.step(idle);

    expect(sim.events.some((e) => e.type === 'tackle' || e.type === 'foul')).toBe(false);
    expect(sim.state.ball.ownerIdx).toBe(carrier.idx);
  });

  it('delays offside until an offside teammate touches the pass', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const runner = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    passer.pos = { x: 12, y: 0 };
    runner.pos = { x: 31, y: 0 };
    sim.state.players.filter((p) => p.team === 1).forEach((p, i) => {
      p.pos = {
        x: i < 2 ? 22 + i : 6 - i,
        y: i < 2 ? (i === 0 ? -18 : 18) : (i % 2 ? 24 : -24),
      };
    });
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(sim.events.some((e) => e.type === 'offside')).toBe(false);

    for (let i = 0; i < Math.round(2.0 / DT) && sim.state.phase === 'play'; i++) {
      sim.step(idle);
    }

    expect(sim.state.phase).toBe('freeKick');
    expect(sim.state.restartTeam).toBe(1);
    expect(sim.events.some((e) => e.type === 'offside')).toBe(true);
  });

  it('flags offside when an untargeted clearance / keeper punt is hoofed up to a striker beyond the last defender', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    sim.state.attackDir = [1, -1]; // team 0 attacks +x
    type V = { x: number; y: number };
    const x = sim as unknown as {
      kickBall: (p: SimPlayer, aim: V, speed: number, loft: number, t?: number, c?: boolean) => void;
      maybeCallPendingOffside: (t: SimPlayer) => boolean;
      pendingOffside: { offsideIdxs: number[] } | null;
    };
    const keeper = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    const striker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    // park every other team-0 outfielder safely onside, deep in their own half
    sim.state.players.filter((p) => p.team === 0 && !p.isGK && p !== striker)
      .forEach((p, i) => { p.pos = { x: -20, y: (i % 9) - 4 }; });
    keeper.pos = { x: -40, y: 0 };
    striker.pos = { x: 35, y: 0 }; // miles up the pitch, beyond the back line
    // team 1 sits deep: keeper deepest, the rest no further up than x=15
    sim.state.players.filter((p) => p.team === 1)
      .forEach((p, i) => { p.pos = { x: p.isGK ? 50 : 15, y: (i % 7) - 3 }; });
    sim.state.ball.pos = { x: keeper.pos.x, y: 0 };
    sim.events = [];

    // an untargeted hoof upfield (a clearance to space) — passTargetIdx = -1
    x.kickBall(keeper, { x: 45, y: 0 }, 24, 0.5, -1);
    expect(x.pendingOffside?.offsideIdxs).toContain(striker.idx);

    // the striker is first to the dropping ball -> offside against team 0
    expect(x.maybeCallPendingOffside(striker)).toBe(true);
    expect(sim.state.phase).toBe('freeKick');
    expect(sim.state.restartTeam).toBe(1);
    expect(sim.events.some((e) => e.type === 'offside')).toBe(true);
  });

  it('does not flag offside on a forward ball when the receiver is onside, nor when a defender wins it first', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    sim.state.attackDir = [1, -1];
    type V = { x: number; y: number };
    const x = sim as unknown as {
      kickBall: (p: SimPlayer, aim: V, speed: number, loft: number, t?: number, c?: boolean) => void;
      maybeCallPendingOffside: (t: SimPlayer) => boolean;
      pendingOffside: { offsideIdxs: number[] } | null;
    };
    const keeper = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    const striker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.players.filter((p) => p.team === 0 && !p.isGK && p !== striker)
      .forEach((p, i) => { p.pos = { x: -20, y: (i % 9) - 4 }; });
    keeper.pos = { x: -40, y: 0 };
    sim.state.players.filter((p) => p.team === 1)
      .forEach((p, i) => { p.pos = { x: p.isGK ? 50 : 15, y: (i % 7) - 3 }; });

    // striker level with / behind the last defender (x=10 < line at 15): onside
    striker.pos = { x: 10, y: 0 };
    sim.state.ball.pos = { x: keeper.pos.x, y: 0 };
    x.kickBall(keeper, { x: 45, y: 0 }, 24, 0.5, -1);
    expect(x.pendingOffside).toBeNull();

    // now offside again, but a defender intercepts first -> phase stays, no offside
    striker.pos = { x: 35, y: 0 };
    sim.events = [];
    x.kickBall(keeper, { x: 45, y: 0 }, 24, 0.5, -1);
    expect(x.pendingOffside?.offsideIdxs).toContain(striker.idx);
    const defender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    expect(x.maybeCallPendingOffside(defender)).toBe(false);
    expect(sim.state.phase).toBe('play');
    expect(sim.events.some((e) => e.type === 'offside')).toBe(false);
  });

  it('rates defensive quality from tackle and pace, centred on a mid defender', () => {
    const sim = new MatchSim(makeCfg());
    const x = sim as unknown as { defensiveQuality: (p: SimPlayer) => number };
    const p = sim.state.players.find((q) => q.team === 0 && !q.isGK)!;
    p.attrs.tackle = 92; p.attrs.pace = 88;
    const elite = x.defensiveQuality(p);
    p.attrs.tackle = 70; p.attrs.pace = 70;
    const mid = x.defensiveQuality(p);
    p.attrs.tackle = 52; p.attrs.pace = 50;
    const poor = x.defensiveQuality(p);
    expect(elite).toBeGreaterThan(0.9);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.6);
    expect(poor).toBeLessThan(0.1);
    expect(elite).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(poor);
  });

  it('scales the human close-down assist by the defender’s quality', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    type V = { x: number; y: number };
    const x = sim as unknown as {
      humanDefensiveAssistTarget: (p: SimPlayer, inp: PadInput, d: V) => V;
      defensiveQuality: (p: SimPlayer) => number;
    };
    const p = sim.state.players.find((q) => q.team === 0 && !q.isGK)!;
    const opp = sim.state.players.find((q) => q.team === 1 && !q.isGK)!;
    p.pos = { x: 0, y: 0 };
    opp.pos = { x: 10, y: 0 };
    sim.state.ball.ownerIdx = opp.idx;
    sim.state.ball.pos = { ...opp.pos };
    sim.state.ball.z = 0;
    // stick pushed AWAY from the ball; the assist resists and pulls him back toward it
    const inp: PadInput = { ...NULL_INPUT, moveX: -1 };
    const desired = { x: -10, y: 0 };

    p.attrs.tackle = 92; p.attrs.pace = 90;
    const resHigh = x.humanDefensiveAssistTarget(p, inp, { ...desired });
    p.attrs.tackle = 52; p.attrs.pace = 54;
    const resLow = x.humanDefensiveAssistTarget(p, inp, { ...desired });

    // a sharper defender is pulled further back toward the ball at +x
    expect(resHigh.x).toBeGreaterThan(resLow.x);
    // both stay short of the ball itself (it's an assist, not a snap-to)
    expect(resHigh.x).toBeLessThan(10);
  });

  it('keeps an idle controlled defender in shape, scaled by quality, only while the opponent has the ball', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    type V = { x: number; y: number };
    const x = sim as unknown as {
      idleDefensiveAssist: (p: SimPlayer) => { desired: V; sprint: boolean } | null;
      defensiveQuality: (p: SimPlayer) => number;
      aiTarget: (p: SimPlayer) => V;
    };
    const p = sim.state.players.find((q) => q.team === 0 && !q.isGK)!;
    const mate = sim.state.players.find((q) => q.team === 0 && !q.isGK && q !== p)!;
    const opp = sim.state.players.find((q) => q.team === 1 && !q.isGK)!;

    // our own team has the ball -> no idle defending
    sim.state.ball.ownerIdx = mate.idx;
    expect(x.idleDefensiveAssist(p)).toBeNull();

    // opponent has the ball -> tuck toward the AI defensive position, blend = 0.5 + q·0.3
    sim.state.ball.ownerIdx = opp.idx;
    sim.state.ball.pos = { ...opp.pos };
    const res = x.idleDefensiveAssist(p)!;
    expect(res).not.toBeNull();
    const aiRaw = x.aiTarget(p);
    const q = x.defensiveQuality(p);
    const w = 0.5 + q * 0.3;
    expect(res.desired.x).toBeCloseTo(p.pos.x * (1 - w) + aiRaw.x * w, 2);
    expect(res.desired.y).toBeCloseTo(p.pos.y * (1 - w) + aiRaw.y * w, 2);
    expect(res.sprint).toBe(Math.hypot(p.pos.x - aiRaw.x, p.pos.y - aiRaw.y) > 6 - q * 3);
  });

  it('holds the defensive back line outside the box instead of dropping onto goal', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    carrier.pos = { x: HALF_LEN - 13, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'MF')
      .forEach((p, i) => { p.pos = { x: HALF_LEN - 16, y: -6 + i * 4 }; });
    const defenderTargets = sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'DF')
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));

    expect(Math.max(...defenderTargets.map((p) => p.x))).toBeLessThanOrEqual(HALF_LEN - 14);
    expect(Math.min(...defenderTargets.map((p) => p.x))).toBeGreaterThanOrEqual(HALF_LEN - 25);
  });

  it('pushes attacking defenders up to close the gap to midfield', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.pos = { x: 30, y: 0 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const defenderTargets = sim.state.players
      .filter((p) => p.team === 0 && p.attrs.pos === 'DF')
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));

    expect(Math.min(...defenderTargets.map((p) => p.x))).toBeGreaterThan(-8);
    expect(Math.max(...defenderTargets.map((p) => Math.abs(p.x - owner.pos.x)))).toBeLessThan(42);
  });

  it('keeps attacking centre-backs behind the last onside counter attacker', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.pos = { x: 36, y: 12 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const counterAttackers = sim.state.players.filter((p) => p.team === 1 && p.attrs.pos === 'FW');
    counterAttackers.forEach((p, i) => { p.pos = { x: 8 + i * 10, y: -5 + i * 10 }; });

    const aiTarget = (p: SimPlayer) => (
      (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p)
    );
    const centreBackTargets = sim.state.players
      .filter((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.5)
      .map(aiTarget);
    const fullBackTargets = sim.state.players
      .filter((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) >= 0.5)
      .map(aiTarget);

    expect(Math.max(...centreBackTargets.map((p) => p.x))).toBeLessThanOrEqual(8.5);
    expect(Math.max(...fullBackTargets.map((p) => p.x))).toBeGreaterThan(13);
  });

  it('lets attacking centre-backs reach halfway when counter attackers are offside', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.pos = { x: 36, y: 0 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    sim.state.players
      .filter((p) => p.team === 1 && (p.attrs.pos === 'FW' || p.attrs.pos === 'MF'))
      .forEach((p, i) => { p.pos = { x: -9 - i * 3, y: -14 + i * 7 }; });

    const centreBackTargets = sim.state.players
      .filter((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.5)
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));
    const highestCentreBack = Math.max(...centreBackTargets.map((p) => p.x));

    expect(highestCentreBack).toBeGreaterThanOrEqual(-0.5);
    expect(highestCentreBack).toBeLessThanOrEqual(4.5);
  });

  it('uses a compact mid-block instead of centre-backs randomly pressing in midfield', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 9, y: 1 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'MF')
      .forEach((p, i) => { p.pos = { x: 15, y: -8 + i * 5 }; });
    sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'DF')
      .forEach((p, i) => { p.pos = { x: 20, y: -10 + i * 6 }; });

    const targets = sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .map((p) => ({ p, target: (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p) }));
    const midfieldTargets = targets.filter(({ p }) => p.attrs.pos === 'MF').map(({ target }) => target);
    const defenderTargets = targets.filter(({ p }) => p.attrs.pos === 'DF').map(({ target }) => target);

    expect(midfieldTargets.some((target) => dist2(target, carrier.pos) < 3.5)).toBe(true);
    expect(defenderTargets.every((target) => dist2(target, carrier.pos) > 6)).toBe(true);
    expect(Math.max(...defenderTargets.map((target) => target.x))).toBeLessThan(29);
    expect(Math.max(...defenderTargets.map((target) => target.x)) - Math.max(...midfieldTargets.map((target) => target.x))).toBeLessThan(13);
  });

  it('does not send four defenders into the same ball-carrier pressure crowd', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 16, y: 1 };
    carrier.vel = { x: 2.4, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK && p !== carrier)
      .forEach((p, i) => { p.pos = { x: 17 + (i % 3) * 1.2, y: -4 + i * 1.25 }; });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 20 + (i % 4) * 1.1, y: -8 + i * 1.7 }; });

    const targets = sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));
    const pressureCrowd = targets.filter((target) => dist2(target, carrier.pos) < 8.5);

    // a front-foot side that holds a higher line can commit an extra body, but
    // it must never send the whole back unit into the pressure crowd
    expect(pressureCrowd.length).toBeLessThanOrEqual(3);
  });

  it('holds a connected high back line instead of tracking offside runners while the passer is deep', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    carrier.pos = { x: -31, y: 0 };
    carrier.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const runner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && p !== carrier)!;
    runner.pos = { x: HALF_LEN - 13, y: -11 };
    runner.vel = { x: 0, y: 0 };
    const defenders = sim.state.players.filter((p) => p.team === 1 && p.attrs.pos === 'DF');
    defenders.forEach((p, i) => { p.pos = { x: 5 + i * 0.7, y: -12 + i * 7 }; });
    defenders[0].pos = { x: HALF_LEN - 16, y: -11.5 };

    const defenderTargets = defenders.map((p) => (
      (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p)
    ));
    const xs = defenderTargets.map((target) => target.x);

    expect(Math.max(...xs)).toBeLessThan(13);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(7);
  });

  it('keeps the back line high until the attack reaches the danger area', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 28, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const defenderTargets = sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'DF')
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));

    expect(Math.max(...defenderTargets.map((target) => target.x))).toBeLessThan(32);
    expect(Math.min(...defenderTargets.map((target) => target.x))).toBeGreaterThan(22);
  });

  it('uses team tactical state for fast breaks, high pressing and protecting leads', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: -4, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    (sim as unknown as { lastTurnover: { tick: number; team: 0 | 1 } }).lastTurnover = { tick: sim.state.tick, team: 0 };

    const api = sim as unknown as {
      teamTacticalState: (team: 0 | 1) => string;
      teamMentality: (team: 0 | 1) => { risk: number; tempo: number; lineBias: number; pressLimit: number };
    };
    expect(api.teamTacticalState(0)).toBe('fastBreak');
    expect(api.teamMentality(0).risk).toBeGreaterThan(1.1);

    sim.state.score = [0, 1];
    sim.state.half = 2;
    sim.state.clock = sim.cfg.halfLengthSec * 0.86;
    sim.state.ball.ownerIdx = carrier.idx;
    expect(api.teamTacticalState(1)).toBe('lowBlock');
    expect(api.teamMentality(1).risk).toBeLessThan(0.9);

    sim.state.score = [0, 1];
    const oppositionDefender = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    oppositionDefender.pos = { x: 24, y: 0 };
    sim.state.ball.ownerIdx = oppositionDefender.idx;
    sim.state.ball.pos = { ...oppositionDefender.pos };
    expect(api.teamTacticalState(0)).toBe('highPress');
    expect(api.teamMentality(0).pressLimit).toBeGreaterThanOrEqual(3);
  });

  it('derives player roles from position, slot and attributes', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    const role = (p: SimPlayer) => (
      (sim as unknown as { playerRole: (player: SimPlayer) => string }).playerRole(p)
    );
    const fullBack = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) > 0.55)!;
    fullBack.attrs = { ...fullBack.attrs, pace: 88, pass: 76, tackle: 54 };
    const centreBack = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.35)!;
    centreBack.attrs = { ...centreBack.attrs, pace: 84, tackle: 64 };
    const holder = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.35)!;
    holder.attrs = { ...holder.attrs, tackle: 86, pass: 60, shoot: 44 };
    const playmaker = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.35)!;
    playmaker.attrs = { ...playmaker.attrs, pass: 90, tackle: 54, shoot: 58 };

    expect(role(fullBack)).toBe('overlapFullBack');
    expect(role(centreBack)).toBe('coverCentreBack');
    expect(role(holder)).toBe('holdingMidfielder');
    expect(role(playmaker)).toBe('playmaker');
  });

  it('uses roles to create different attacking support movements', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.pos = { x: 18, y: 2 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const holder = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.35 && p !== owner)!;
    holder.attrs = { ...holder.attrs, tackle: 90, pass: 58, shoot: 42 };
    const fullBack = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) > 0.55)!;
    fullBack.attrs = { ...fullBack.attrs, pace: 90, pass: 82, tackle: 55 };

    const supportTarget = (p: SimPlayer) => (
      (sim as unknown as { supportTarget: (player: SimPlayer, owner: SimPlayer) => { x: number; y: number } }).supportTarget(p, owner)
    );
    const holderTarget = supportTarget(holder);
    const fullBackTarget = supportTarget(fullBack);

    expect(holderTarget.x).toBeLessThan(owner.pos.x - 8);
    expect(fullBackTarget.x).toBeGreaterThan(owner.pos.x - 2);
    expect(Math.abs(fullBackTarget.y)).toBeGreaterThan(HALF_WID - 10);
  });

  it('adds pressure-aware first touches and strength-aware contact duels', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2, seed: 44 }));
    sim.state.phase = 'play';
    const receiver = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const marker = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF')!;
    receiver.attrs = { ...receiver.attrs, pass: 38, pace: 42, tackle: 35 };
    marker.pos = { x: receiver.pos.x + 1.1, y: receiver.pos.y };
    const composed = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    composed.attrs = { ...composed.attrs, pass: 86, pace: 82, tackle: 58 };
    composed.pos = { x: -20, y: 18 };

    const api = sim as unknown as {
      firstTouchOutcome: (player: SimPlayer, incomingSpeed: number, fromOpponent: boolean) => { loose: boolean; push: number };
      duelScore: (challenger: SimPlayer, carrier: SimPlayer) => number;
    };
    const badTouch = api.firstTouchOutcome(receiver, 18, true);
    const cleanTouch = api.firstTouchOutcome(composed, 10, false);

    expect(badTouch.loose).toBe(true);
    expect(badTouch.push).toBeGreaterThan(0.25);
    expect(cleanTouch.loose).toBe(false);
    expect(cleanTouch.push).toBeLessThan(0.18);

    const tackler = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    const weakCarrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    tackler.attrs = { ...tackler.attrs, tackle: 92, pace: 78 };
    weakCarrier.attrs = { ...weakCarrier.attrs, pace: 45, pass: 42, tackle: 28 };
    expect(api.duelScore(tackler, weakCarrier)).toBeGreaterThan(0.25);
    expect(api.duelScore(weakCarrier, tackler)).toBeLessThan(-0.15);
  });

  it('derives decision profiles from player role and attributes', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    const profile = (p: SimPlayer) => (
      (sim as unknown as {
        playerDecisionProfile: (player: SimPlayer) => {
          passUrgency: number;
          carryBias: number;
          shootAggression: number;
          wideCarry: number;
          defensiveScreen: number;
        };
      }).playerDecisionProfile(p)
    );
    const playmaker = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.35)!;
    playmaker.attrs = { ...playmaker.attrs, pass: 92, tackle: 50, shoot: 54 };
    const wideForward = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    wideForward.slot = { ...wideForward.slot, y: 0.75 };
    wideForward.attrs = { ...wideForward.attrs, pace: 88, pass: 76, shoot: 66 };
    const poacher = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'FW')!;
    poacher.slot = { ...poacher.slot, y: 0.05 };
    poacher.attrs = { ...poacher.attrs, shoot: 93, pace: 67, pass: 48 };
    const holder = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.35)!;
    holder.attrs = { ...holder.attrs, tackle: 90, pass: 58, shoot: 40 };

    expect(profile(playmaker).passUrgency).toBeGreaterThan(profile(playmaker).carryBias);
    expect(profile(wideForward).wideCarry).toBeGreaterThan(0.75);
    expect(profile(poacher).shootAggression).toBeGreaterThan(0.85);
    expect(profile(holder).defensiveScreen).toBeGreaterThan(0.75);
  });

  it('keeps wide carriers in the crossing lane instead of cutting inside too early', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    carrier.slot = { ...carrier.slot, y: 0.78 };
    carrier.attrs = { ...carrier.attrs, pace: 88, pass: 78, shoot: 64 };
    carrier.pos = { x: HALF_LEN - 32, y: HALF_WID - 5 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };

    const target = (sim as unknown as { dribbleTarget: (player: SimPlayer) => { x: number; y: number } }).dribbleTarget(carrier);

    expect(target.x).toBeGreaterThan(carrier.pos.x + 5);
    expect(target.y).toBeGreaterThan(HALF_WID - 12);
  });

  it('lets poachers take early shots from the edge instead of recycling', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2, seed: 91 }));
    sim.state.phase = 'play';
    const poacher = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    poacher.slot = { ...poacher.slot, y: 0.04 };
    poacher.attrs = { ...poacher.attrs, shoot: 94, pass: 42, pace: 68 };
    poacher.pos = { x: HALF_LEN - 25, y: 4 };
    poacher.vel = { x: 0, y: 0 };
    poacher.kickCooldown = 0;
    sim.state.ball.ownerIdx = poacher.idx;
    sim.state.ball.pos = { ...poacher.pos };
    sim.state.players
      .filter((p) => p.team === 0 && p !== poacher && !p.isGK)
      .forEach((p, i) => { p.pos = { x: poacher.pos.x - 16 - i, y: i % 2 ? 24 : -24 }; });
    const blocker = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    blocker.pos = { x: HALF_LEN - 13, y: 2.8 };
    sim.state.players
      .filter((p) => p.team === 1 && p !== blocker && !p.isGK)
      .forEach((p, i) => { p.pos = { x: HALF_LEN - 6 - i * 0.4, y: i % 2 ? 24 : -24 }; });

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'shot', team: 0 }));
  });

  it('uses holding midfielders as a central screen against wide attacks', () => {
    const sim = new MatchSim(makeCfg({ difficulty: 2 }));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 18, y: HALF_WID - 4 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    const holder = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.35)!;
    holder.attrs = { ...holder.attrs, tackle: 92, pass: 58, shoot: 42 };
    holder.pos = { x: 22, y: 1 };
    const wideDefaultTarget = { x: carrier.pos.x + 3, y: carrier.pos.y - 2 };

    const screen = (sim as unknown as {
      nonPressingDefensiveTarget: (player: SimPlayer, carrier: SimPlayer, target: { x: number; y: number }) => { x: number; y: number };
    }).nonPressingDefensiveTarget(holder, carrier, wideDefaultTarget);

    expect(screen.x).toBeGreaterThan(carrier.pos.x + 5);
    expect(Math.abs(screen.y)).toBeLessThan(12);
  });

  it('derives team tactic profiles from selected formations', () => {
    const wide = new MatchSim(makeFormationCfg('4-3-3'));
    const compact = new MatchSim(makeFormationCfg('4-3-1-2'));
    const defensive = new MatchSim(makeFormationCfg('5-4-1'));
    const doublePivot = new MatchSim(makeFormationCfg('4-2-3-1'));
    const wingBacks = new MatchSim(makeFormationCfg('3-4-2-1'));
    const midfieldBox = new MatchSim(makeFormationCfg('3-1-4-2'));
    const profile = (sim: MatchSim, team: 0 | 1) => (
      (sim as unknown as {
        teamTacticProfile: (team: 0 | 1) => {
          width: number;
          switchPlay: number;
          centralOverload: number;
          defensiveCover: number;
          pivotDepth: number;
        };
      }).teamTacticProfile(team)
    );

    expect(profile(wide, 0).width).toBeGreaterThan(profile(compact, 0).width);
    expect(profile(wide, 0).switchPlay).toBeGreaterThan(0.7);
    expect(profile(compact, 0).centralOverload).toBeGreaterThan(profile(wide, 0).centralOverload);
    expect(profile(defensive, 0).defensiveCover).toBeGreaterThan(profile(wide, 0).defensiveCover);
    expect(profile(doublePivot, 0).pivotDepth).toBeGreaterThan(0.7);
    expect(profile(wingBacks, 0).width).toBeGreaterThan(0.65);
    expect(profile(wingBacks, 0).centralOverload).toBeGreaterThan(0.55);
    expect(profile(midfieldBox, 0).pivotDepth).toBeGreaterThan(0.6);
    expect(profile(midfieldBox, 0).defensiveCover).toBeGreaterThan(0.55);
  });

  it('applies manager tactics on top of the selected formation and dents momentum when changed in-match', () => {
    const cfg = makeFormationCfg('4-2-3-1');
    cfg.teams[0].lineup.tactics = {
      mentality: 'defensive',
      width: 32,
      defensiveDepth: 28,
      pressing: 'low',
      buildUp: 'patient',
    };
    cfg.teams[1].lineup.tactics = {
      mentality: 'attacking',
      width: 82,
      defensiveDepth: 78,
      pressing: 'high',
      buildUp: 'direct',
    };
    const sim = new MatchSim(cfg);
    const api = sim as unknown as {
      teamTacticProfile: (team: 0 | 1) => {
        width: number;
        defensiveCover: number;
        directness: number;
      };
      teamMentality: (team: 0 | 1) => { risk: number; tempo: number; pressLimit: number; supportWidth: number };
    };

    expect(api.teamTacticProfile(1).width).toBeGreaterThan(api.teamTacticProfile(0).width);
    expect(api.teamTacticProfile(1).directness).toBeGreaterThan(api.teamTacticProfile(0).directness);
    expect(api.teamTacticProfile(0).defensiveCover).toBeGreaterThan(api.teamTacticProfile(1).defensiveCover);
    expect(api.teamMentality(1).risk).toBeGreaterThan(api.teamMentality(0).risk);
    expect(api.teamMentality(1).pressLimit).toBeGreaterThan(api.teamMentality(0).pressLimit);

    sim.state.momentum[1] = 10;
    expect(sim.changeTactics(1, {
      mentality: 'balanced',
      width: 55,
      defensiveDepth: 50,
      pressing: 'mid',
      buildUp: 'balanced',
    })).toBe(true);
    expect(sim.state.momentum[1]).toBeGreaterThan(0);
    expect(sim.state.momentum[1]).toBeLessThan(7);
  });

  it('keeps 4-3-3 wide forwards wider than a 4-4-2 front pair in attack', () => {
    const wideSim = new MatchSim(makeFormationCfg('4-3-3'));
    const pairSim = new MatchSim(makeFormationCfg('4-4-2'));
    for (const sim of [wideSim, pairSim]) {
      sim.state.phase = 'play';
      const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
      owner.pos = { x: 10, y: 0 };
      sim.state.ball.ownerIdx = owner.idx;
      sim.state.ball.pos = { ...owner.pos };
    }
    const wideOwner = wideSim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const pairOwner = pairSim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const winger = wideSim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && Math.abs(p.slot.y) > 0.5)!;
    const frontPair = pairSim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;

    const wideTarget = (wideSim as unknown as { supportTarget: (p: SimPlayer, owner: SimPlayer) => { x: number; y: number } })
      .supportTarget(winger, wideOwner);
    const pairTarget = (pairSim as unknown as { supportTarget: (p: SimPlayer, owner: SimPlayer) => { x: number; y: number } })
      .supportTarget(frontPair, pairOwner);

    // 4-3-3 wingers still hold clearly more width than a 4-4-2 front pair (the
    // exact figure flexes a touch with line height affecting space-finding)
    expect(Math.abs(wideTarget.y)).toBeGreaterThan(Math.abs(pairTarget.y) + 4);
  });

  it('keeps the 4-2-3-1 double pivot underneath the ball during attacks', () => {
    const sim = new MatchSim(makeFormationCfg('4-2-3-1'));
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && p.slot.x > -0.1 && Math.abs(p.slot.y) < 0.2)!;
    const pivot = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && p.slot.x < -0.3)!;
    owner.pos = { x: 18, y: 1 };
    pivot.pos = { x: 8, y: -5 };
    pivot.attrs = { ...pivot.attrs, pass: 78, tackle: 68, shoot: 46 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };

    const target = (sim as unknown as { supportTarget: (p: SimPlayer, owner: SimPlayer) => { x: number; y: number } })
      .supportTarget(pivot, owner);

    expect(target.x).toBeLessThan(owner.pos.x - 10);
    expect(Math.abs(target.y)).toBeLessThan(14);
  });

  it('switches play to the far winger when a wide formation is crowded near-side', () => {
    const sim = new MatchSim(makeFormationCfg('4-3-3'));
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    owner.attrs = { ...owner.attrs, pass: 90 };
    owner.pos = { x: 0, y: HALF_WID - 8 };
    owner.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const farWinger = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && p.slot.y < -0.5)!;
    farWinger.pos = { x: 8, y: -HALF_WID + 7 };
    farWinger.vel = { x: 0, y: 0 };
    const nearOption = sim.state.players.find((p) => p.team === 0 && p !== owner && p !== farWinger && !p.isGK)!;
    nearOption.pos = { x: 8, y: HALF_WID - 9 };
    sim.state.players
      .filter((p) => p.team === 0 && p !== owner && p !== farWinger && p !== nearOption && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -42 - i, y: i % 2 ? 26 : -26 }; });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 16 + (i % 4), y: HALF_WID - 12 + (i % 3) * 2 }; });

    const option = (sim as unknown as {
      bestPassOption: (owner: SimPlayer, longOnly: boolean, allowThrough?: boolean) => { targetIdx: number } | null;
    }).bestPassOption(owner, false, true);

    expect(option?.targetIdx).toBe(farWinger.idx);
  });

  it('AI wide players loft crosses to a box runner', () => {
    const sim = new MatchSim(makeFormationCfg('4-3-3'));
    sim.state.phase = 'play';
    const crosser = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && p.slot.y > 0.5)!;
    const striker = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && Math.abs(p.slot.y) < 0.2)!;
    crosser.attrs = { ...crosser.attrs, pass: 92, shoot: 42, pace: 78 };
    crosser.pos = { x: HALF_LEN - 31, y: HALF_WID - 5 };
    crosser.vel = { x: 0, y: 0 };
    crosser.kickCooldown = 0;
    striker.attrs = { ...striker.attrs, shoot: 92, pace: 76 };
    striker.pos = { x: HALF_LEN - 11, y: 1.2 };
    striker.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && p !== crosser && p !== striker && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -28 - i, y: i % 2 ? 26 : -26 }; });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: HALF_LEN - 7 - (i % 3) * 1.2, y: -24 + (i % 5) * 9 }; });
    sim.state.ball.ownerIdx = crosser.idx;
    sim.state.ball.pos = { ...crosser.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    const pass = sim.events.find((e) => e.type === 'pass' && e.team === 0);
    expect(pass).toEqual(expect.objectContaining({ target: striker.idx }));
    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.vz).toBeGreaterThan(6);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(20);
  });

  it('spreads cross support between post runners and the edge of the box', () => {
    const sim = new MatchSim(makeFormationCfg('4-3-3'));
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && p.slot.y > 0.5)!;
    owner.pos = { x: HALF_LEN - 26, y: HALF_WID - 5 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };
    const forwards = sim.state.players
      .filter((p) => p.team === 0 && p.attrs.pos === 'FW' && p !== owner);
    const edgeMid = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.1)!;
    const api = sim as unknown as { supportTarget: (p: SimPlayer, owner: SimPlayer) => { x: number; y: number } };
    const postTargets = forwards.map((p) => api.supportTarget(p, owner));
    const edgeTarget = api.supportTarget(edgeMid, owner);

    expect(Math.max(...postTargets.map((p) => p.y))).toBeGreaterThan(5);
    expect(Math.min(...postTargets.map((p) => p.y))).toBeLessThan(-5);
    expect(edgeTarget.x).toBeLessThan(HALF_LEN - 9);
    expect(Math.abs(edgeTarget.y)).toBeLessThan(3);
  });

  it('spreads triggered box runs from a wide cross across both posts', () => {
    const sim = new MatchSim(makeFormationCfg('4-3-3'));
    sim.state.phase = 'play';
    const crosser = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW' && p.slot.y > 0.5)!;
    crosser.pos = { x: HALF_LEN - 24, y: HALF_WID - 5 };
    const api = sim as unknown as {
      triggerBoxRuns: (team: 0 | 1, excludeIdx: number, crossSide?: number) => void;
      supportTarget: (p: SimPlayer, owner: SimPlayer) => { x: number; y: number };
    };

    api.triggerBoxRuns(0, crosser.idx, crosser.pos.y);

    const targets = sim.state.players
      .filter((p) => p.team === 0 && p.attrs.pos === 'FW' && p !== crosser)
      .map((p) => api.supportTarget(p, crosser));
    expect(Math.max(...targets.map((p) => p.y))).toBeGreaterThan(5);
    expect(Math.min(...targets.map((p) => p.y))).toBeLessThan(-5);
  });

  it('slips central through balls into space behind the line', () => {
    const sim = new MatchSim(makeFormationCfg('4-2-3-1'));
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.1)!;
    const runner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    passer.attrs = { ...passer.attrs, pass: 96, shoot: 46, pace: 64 };
    passer.pos = { x: 10, y: 0 };
    passer.vel = { x: 0, y: 0 };
    passer.facing = 0;
    passer.kickCooldown = 0;
    runner.attrs = { ...runner.attrs, pace: 90, shoot: 84 };
    runner.pos = { x: 28, y: 4 };
    runner.vel = { x: 3.2, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && p !== passer && p !== runner && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -28 - i, y: i % 2 ? 24 : -24 }; });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 30 + (i % 3) * 1.2, y: -18 + i * 4.5 }; });
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    const pass = sim.events.find((e) => e.type === 'pass' && e.team === 0);
    expect(pass).toEqual(expect.objectContaining({ target: runner.idx }));
    expect(sim.state.ball.kickDir.x).toBeGreaterThan(0.985);
    expect(sim.state.ball.vel.x).toBeGreaterThan(20);
  });

  it('cuts the ball back from the inside channel to a late runner', () => {
    const sim = new MatchSim(makeFormationCfg('4-2-3-1'));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    const trailer = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.25)!;
    carrier.attrs = { ...carrier.attrs, pass: 90, shoot: 38, pace: 82 };
    carrier.pos = { x: HALF_LEN - 8, y: 12 };
    carrier.vel = { x: 0, y: 0 };
    carrier.kickCooldown = 0;
    trailer.attrs = { ...trailer.attrs, shoot: 82, pass: 76, pace: 72 };
    trailer.pos = { x: HALF_LEN - PENALTY_SPOT - 1, y: 0.6 };
    trailer.vel = { x: 1.6, y: 0 };
    sim.state.players
      .filter((p) => p.team === 0 && p !== carrier && p !== trailer && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -30 - i, y: i % 2 ? 25 : -25 }; });
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: HALF_LEN - 5 - (i % 3), y: -24 + i * 5.2 }; });
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;

    (sim as unknown as { updateAIWithBall: () => void }).updateAIWithBall();

    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'pass', target: trailer.idx }));
    expect(sim.state.ball.vz).toBeLessThan(1);
    expect(sim.state.ball.kickDir.x).toBeLessThan(-0.2);
  });

  it('creates a late central runner for cutbacks when the owner enters the box channel', () => {
    const sim = new MatchSim(makeFormationCfg('4-2-3-1'));
    sim.state.phase = 'play';
    const owner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    const lateMid = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.25)!;
    owner.pos = { x: HALF_LEN - 8, y: 10 };
    lateMid.pos = { x: HALF_LEN - 25, y: 0 };
    sim.state.ball.ownerIdx = owner.idx;
    sim.state.ball.pos = { ...owner.pos };

    const target = (sim as unknown as { supportTarget: (p: SimPlayer, owner: SimPlayer) => { x: number; y: number } })
      .supportTarget(lateMid, owner);

    expect(target.x).toBeGreaterThan(HALF_LEN - PENALTY_SPOT - 4);
    expect(target.x).toBeLessThan(HALF_LEN - PENALTY_SPOT + 2);
    expect(Math.abs(target.y)).toBeLessThan(2.5);
  });

  it('screens central cutback lanes without dragging extra defenders to the carrier', () => {
    const sim = new MatchSim(makeFormationCfg('4-2-3-1', '4-2-3-1'));
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    const trailer = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.25)!;
    carrier.pos = { x: HALF_LEN - 8.5, y: 11 };
    trailer.pos = { x: HALF_LEN - PENALTY_SPOT - 1, y: 0 };
    trailer.vel = { x: 1.2, y: 0 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.players
      .filter((p) => p.team === 0 && p !== carrier && p !== trailer && !p.isGK)
      .forEach((p, i) => { p.pos = { x: 18 + i * 0.6, y: i % 2 ? 22 : -22 }; });
    const defenders = sim.state.players.filter((p) => p.team === 1 && !p.isGK);
    defenders.forEach((p, i) => {
      p.pos = { x: HALF_LEN - 19 + (i % 4) * 1.2, y: -14 + i * 3.2 };
      p.vel = { x: 0, y: 0 };
    });

    const targets = defenders.map((p) => (
      (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p)
    ));
    const carrierPocket = targets.filter((target) => dist2(target, carrier.pos) < 5.5);
    const cutbackScreens = targets.filter((target) => (
      target.x > trailer.pos.x - 1
      && target.x < carrier.pos.x
      && target.y > 2
      && target.y < carrier.pos.y - 2
    ));

    expect(cutbackScreens.length).toBeGreaterThanOrEqual(1);
    expect(carrierPocket.length).toBeLessThanOrEqual(2);
  });

  it('keeps a 5-4-1 centre-back deeper than a back four in the same attack', () => {
    const backFour = new MatchSim(makeFormationCfg('4-4-2', '4-4-2'));
    const backFive = new MatchSim(makeFormationCfg('4-4-2', '5-4-1'));
    for (const sim of [backFour, backFive]) {
      sim.state.phase = 'play';
      const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
      carrier.pos = { x: 12, y: 0 };
      sim.state.ball.ownerIdx = carrier.idx;
      sim.state.ball.pos = { ...carrier.pos };
    }
    const fourCb = backFour.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.3)!;
    const fiveCb = backFive.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.1)!;
    const fourTarget = (backFour as unknown as { formationTarget: (p: SimPlayer) => { x: number; y: number } }).formationTarget(fourCb);
    const fiveTarget = (backFive as unknown as { formationTarget: (p: SimPlayer) => { x: number; y: number } }).formationTarget(fiveCb);

    expect(fiveTarget.x).toBeGreaterThan(fourTarget.x + 1.2);
  });

  it('keeps attacking runners checking along the defensive line', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    const runner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    carrier.pos = { x: HALF_LEN - 22, y: 0 };
    runner.pos = { x: HALF_LEN - 18, y: 4 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    sim.state.players
      .filter((p) => p.team === 1 && p.attrs.pos === 'DF')
      .forEach((p, i) => { p.pos = { x: HALF_LEN - 15, y: -9 + i * 6 }; });

    const target = (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(runner);

    // stays onside (goal-side of the line) and supports high up — but against a
    // higher line a runner legitimately checks his run a little to stay onside,
    // so he holds near the carrier rather than always bursting beyond
    expect(target.x).toBeLessThanOrEqual(HALF_LEN - 15.5);
    expect(target.x).toBeGreaterThan(carrier.pos.x - 6);
  });

  it('lets close free kicks be struck directly at goal', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'freeKick';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - 23, y: 2 };
    sim.state.restartTimer = 0;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    const spot = (sim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();
    taker.pos = { ...spot };
    taker.vel = { x: 0, y: 0 };

    for (let i = 0; i < 12; i++) sim.step([{ ...idleWithSwitch, shoot: true }, { ...NULL_INPUT }]);
    let sawShot = false;
    let guard = 0;
    while (String(sim.state.phase) !== 'play' && guard++ < 10) {
      sim.step([{ ...idleWithSwitch }, { ...NULL_INPUT }]);
      if (sim.events.some((e) => e.type === 'shot')) sawShot = true;
    }

    expect(sim.state.phase).toBe('play');
    expect(sawShot).toBe(true);
    expect(sim.state.ball.vel.x).toBeGreaterThan(18);
    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(true);
  });

  it('sets a defensive wall for close free kicks', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'freeKick';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - 24, y: 4 };
    const defenders = sim.state.players.filter((p) => p.team === 1 && !p.isGK && !p.sentOff);
    const targets = defenders
      .map((p) => (sim as unknown as { aiTarget: (player: SimPlayer) => { x: number; y: number } }).aiTarget(p));
    const wallX = sim.state.restartPos.x + 9.15;
    const wall = targets.filter((p) => Math.abs(p.x - wallX) < 1.6 && Math.abs(p.y - sim.state.restartPos.y) < 5);

    expect(wall.length).toBeGreaterThanOrEqual(4);
  });

  it('taps pass for a ground ball and holds pass for an aerial long ball', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const runner = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
    passer.pos = { x: -8, y: 0 };
    runner.pos = { x: 12, y: 3 };
    sim.state.controlledIdx[0] = passer.idx;
    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.vz).toBeLessThan(1);

    sim.state.ball.ownerIdx = passer.idx;
    sim.state.ball.pos = { ...passer.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    sim.state.ball.vz = 0;
    runner.pos = { x: 26, y: 4 };

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    expect(sim.state.ball.ownerIdx).toBe(passer.idx);
    stepMany(sim, Math.round(0.32 / DT), [{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.vz).toBeGreaterThan(2);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeGreaterThan(18);
  });

  it('does not show a card for a routine first foul but escalates repeat fouls', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const offender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    const victim = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const foul = (severity: number, x = 0) => {
      sim.state.phase = 'play';
      sim.state.ball.pos = { x, y: 0 };
      (sim as unknown as { commitFoul: (offender: SimPlayer, victim: SimPlayer, severity: number) => void })
        .commitFoul(offender, victim, severity);
    };

    // routine low-severity fouls aren't booked
    foul(0.3);
    foul(0.3, 5);
    foul(0.3, 9);
    expect(offender.yellowCards).toBe(0);
    expect(offender.sentOff).toBe(false);

    // but the persistent offender is finally cautioned on his fourth foul
    foul(0.45, 12);
    expect(offender.yellowCards).toBe(1);
    expect(offender.sentOff).toBe(false);
  });

  it('awards a penalty for a defensive foul inside the box', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const defender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.ball.pos = { x: HALF_LEN - 8, y: 3 };

    (sim as unknown as { commitFoul: (offender: SimPlayer, victim: SimPlayer, severity: number) => void })
      .commitFoul(defender, attacker, 0.35);

    expect(sim.state.phase).toBe('penaltyKick');
    expect(sim.state.restartTeam).toBe(0);
    expect(sim.state.restartPos).toEqual({ x: HALF_LEN - PENALTY_SPOT, y: 0 });
    expect(sim.events.some((e) => e.type === 'penalty')).toBe(true);
  });

  it('puts the fouled player on the ground so the foul reads clearly, then he gets up', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const offender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    const victim = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    offender.pos = { x: 0, y: 0 };
    victim.pos = { x: 0.6, y: 0 };
    victim.vel = { x: 6, y: 0 };
    (sim as unknown as { commitFoul: (o: SimPlayer, v: SimPlayer, s: number) => void })
      .commitFoul(offender, victim, 0.5);
    expect(victim.anim).toBe('fall');
    expect(victim.downTimer ?? 0).toBeGreaterThan(0.5);

    // while down he's grounded — he doesn't run off, and a team-mate (not him)
    // takes the free kick rather than him popping up off the turf
    const startPos = { ...victim.pos };
    stepMany(sim, Math.round(0.5 / DT), idle);
    expect(victim.anim).toBe('fall');
    expect(dist2(victim.pos, startPos)).toBeLessThan(3);

    // and he's back on his feet once the fall + get-up have played out (~2s)
    stepMany(sim, Math.round(1.8 / DT), idle);
    expect(victim.downTimer ?? 0).toBeLessThanOrEqual(0);
    expect(victim.anim).not.toBe('fall');
  });

  it('never flings a downed player into a tackle while he is on the ground', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const x = sim as unknown as { knockDown: (p: SimPlayer, by: SimPlayer, d: number) => void };
    const carrier = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    const victim = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    victim.pos = { x: 0, y: 0 };
    x.knockDown(victim, carrier, 0.8);

    // keep an opponent carrying the ball right on top of him each frame — exactly the
    // situation that used to make the AI assign the grounded man a slide tackle
    for (let i = 0; i < Math.round(0.7 / DT); i++) {
      carrier.pos = { x: victim.pos.x + 0.9, y: victim.pos.y };
      sim.state.ball.ownerIdx = carrier.idx;
      sim.state.ball.pos = { ...carrier.pos };
      sim.state.ball.z = 0;
      sim.step(idle);
      expect(victim.anim).toBe('fall'); // never 'slide'/'tackle'
      expect(victim.slideTimer).toBe(0);
    }
  });

  it('applies the hidden referee: strictness, leniency on marginal contact, and home bias', () => {
    const sim = new MatchSim(makeCfg());
    type Ref = { foulBias: number; cardBias: number; accuracy: number; homeBias: number };
    const setRef = (r: Ref) => { (sim as unknown as { referee: Ref }).referee = r; };
    const mul = (team: 0 | 1, fromBehind: boolean) =>
      (sim as unknown as { refereeFoulMul: (t: 0 | 1, f: boolean) => number }).refereeFoulMul(team, fromBehind);

    // a strict referee whistles a marginal (front) challenge far more than a lenient one
    setRef({ foulBias: 1.5, cardBias: 1, accuracy: 1, homeBias: 0 });
    const strictFront = mul(1, false);
    setRef({ foulBias: 0.6, cardBias: 1, accuracy: 1, homeBias: 0 });
    expect(strictFront).toBeGreaterThan(mul(1, false));

    // ...but a clear from-behind challenge swings far less (still a foul either way)
    setRef({ foulBias: 1.5, cardBias: 1, accuracy: 1, homeBias: 0 });
    expect(mul(1, true)).toBeLessThan(mul(1, false));

    // a home-biased referee whistles the away side (team 1) more than the home side (team 0)
    setRef({ foulBias: 1, cardBias: 1, accuracy: 1, homeBias: 0.2 });
    expect(mul(1, false)).toBeGreaterThan(mul(0, false));

    // the referee is deterministic from the seed (same seed -> same profile)
    const a = new MatchSim(makeCfg({ seed: 77 })) as unknown as { referee: Ref };
    const b = new MatchSim(makeCfg({ seed: 77 })) as unknown as { referee: Ref };
    expect(a.referee).toEqual(b.referee);
  });

  it('boos clearly wrong decisions and gives ironic applause when an aggrieved side finally gets one', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    type Internals = {
      referee: { foulBias: number; cardBias: number; accuracy: number; homeBias: number };
      refRng: { next: () => number };
      teamGrievance: [number, number];
      refereeWavesOn: (t: 0 | 1) => boolean;
      registerGrievance: (t: 0 | 1) => void;
      commitFoul: (o: SimPlayer, v: SimPlayer, sev: number, phantom?: boolean) => void;
    };
    const x = sim as unknown as Internals;
    const teamOnePlayer = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    const teamZeroPlayer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;

    // a referee who keeps waving on clear fouls: each wave-on boos and stokes the
    // wronged side's (team 0) grievance
    x.referee = { ...x.referee, accuracy: 0 };
    x.refRng = { next: () => 0 }; // always below the wave-on threshold
    sim.events = [];
    expect(x.refereeWavesOn(0)).toBe(true);
    expect(x.refereeWavesOn(0)).toBe(true);
    expect(x.teamGrievance[0]).toBe(2);
    expect(sim.events.filter((e) => e.type === 'crowdBoo' && e.team === 0)).toHaveLength(2);

    // a genuine free kick finally goes team 0's way -> sarcastic applause, grievance settled
    sim.events = [];
    sim.state.phase = 'play';
    sim.state.ball.pos = { x: 0, y: 0 };
    x.commitFoul(teamOnePlayer, teamZeroPlayer, 0.3);
    expect(sim.events.some((e) => e.type === 'crowdIronic' && e.team === 0)).toBe(true);
    expect(x.teamGrievance[0]).toBe(0);

    // a fresh decision their way with no grievance gets no ironic applause
    sim.events = [];
    sim.state.phase = 'play';
    sim.state.ball.pos = { x: 0, y: 0 };
    x.commitFoul(teamOnePlayer, teamZeroPlayer, 0.3);
    expect(sim.events.some((e) => e.type === 'crowdIronic')).toBe(false);

    // a phantom foul boos the wronged tackler's side and is never counted as the
    // beneficiary's decision earned, even if that side had been stewing
    sim.events = [];
    x.teamGrievance = [3, 0]; // team 0 aggrieved, but the call is a ref error
    sim.state.phase = 'play';
    sim.state.ball.pos = { x: 0, y: 0 };
    x.registerGrievance(1);
    x.commitFoul(teamOnePlayer, teamZeroPlayer, 0.3, true);
    expect(sim.events.some((e) => e.type === 'crowdBoo' && e.team === 1)).toBe(true);
    expect(sim.events.some((e) => e.type === 'crowdIronic')).toBe(false);
    expect(x.teamGrievance[0]).toBe(3); // untouched — a phantom never settles grievance
  });

  it('does not let a diving keeper clear the ball up the pitch until the dive finishes', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const x = sim as unknown as { updateAIWithBall: () => void; aiDecideAt: Map<number, number> };
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;

    // keeper has just claimed the ball but is still sprawling from the dive
    gk.diving = true;
    gk.slideTimer = 0.5;
    gk.kickCooldown = 0;
    gk.pos = { x: gk.pos.x, y: 0 };
    sim.state.ball.ownerIdx = gk.idx;
    sim.state.ball.held = true;
    sim.state.ball.pos = { x: gk.pos.x, y: gk.pos.y };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.vz = 0;

    // mid-dive: the AI must not distribute — the ball stays with him, no upfield pace
    x.aiDecideAt.set(gk.idx, 0);
    x.updateAIWithBall();
    expect(sim.state.ball.ownerIdx).toBe(gk.idx);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeLessThan(1);

    // once the dive has played out he clears it (the ball is released with pace)
    gk.diving = false;
    gk.slideTimer = 0;
    x.aiDecideAt.set(gk.idx, 0);
    x.updateAIWithBall();
    const cleared = sim.state.ball.ownerIdx !== gk.idx
      || Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y) > 5;
    expect(cleared).toBe(true);
  });

  it('gives a sarcastic mock cheer when a live shot misses by a long way', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    sim.state.attackDir = [1, -1]; // team 0 attacks +x
    const x = sim as unknown as { shotLive: boolean; checkBounds: () => void };

    // team 0 blazes one miles wide of the +x goal (well outside the post, low)
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.pos = { x: HALF_LEN + 1, y: GOAL_HALF_WIDTH + 7 };
    sim.state.ball.z = 0.3;
    sim.events = [];
    x.shotLive = true;
    x.checkBounds();
    expect(sim.events.some((e) => e.type === 'crowdMock' && e.team === 0)).toBe(true);
    expect(sim.events.some((e) => e.type === 'nearMiss')).toBe(false);

    // a shot that only just shaves the post is a near miss, not a mock cheer
    sim.state.ball.pos = { x: HALF_LEN + 1, y: GOAL_HALF_WIDTH + 1.5 };
    sim.events = [];
    x.shotLive = true;
    x.checkBounds();
    expect(sim.events.some((e) => e.type === 'nearMiss')).toBe(true);
    expect(sim.events.some((e) => e.type === 'crowdMock')).toBe(false);
  });

  it('tracks visible penalty aim while lining up a spot kick', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'penaltyKick';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - PENALTY_SPOT, y: 0 };
    sim.state.restartTimer = 0.4;

    sim.step([{ ...idleWithSwitch, moveY: 0.72 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('penaltyKick');
    expect(sim.state.penaltyAim).toBeCloseTo(0.72, 2);
  });

  it('keeps full-stick penalty aiming inside the posts', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'penaltyKick';
    sim.state.restartTeam = 0;
    sim.state.restartPos = { x: HALF_LEN - PENALTY_SPOT, y: 0 };
    sim.state.restartTimer = 0;
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.pos = (sim as unknown as { restartTakerSpot: () => { x: number; y: number } }).restartTakerSpot();

    sim.step([{ ...idleWithSwitch, shoot: true, moveY: 1 }, { ...NULL_INPUT }]);

    const tToLine = (HALF_LEN - sim.state.ball.pos.x) / sim.state.ball.vel.x;
    const yAtLine = sim.state.ball.pos.y + sim.state.ball.vel.y * tToLine;
    expect(Math.abs(yAtLine)).toBeLessThan(GOAL_HALF_WIDTH - 0.15);
  });

  it('uses passing skill to keep human passes closer to the intended target', () => {
    const run = (pass: number) => {
      const sim = new MatchSim(makeHumanCfg());
      sim.state.phase = 'play';
      const passer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      const mate = sim.state.players.find((p) => p.team === 0 && !p.isGK && p !== passer)!;
      passer.attrs.pass = pass;
      passer.pos = { x: -12, y: 0 };
      passer.facing = 0;
      mate.pos = { x: 14, y: 6 };
      mate.vel = { x: 0, y: 0 };
      sim.state.players
        .filter((p) => p.team === 0 && !p.isGK && p !== passer && p !== mate)
        .forEach((p, i) => { p.pos = { x: -28 - i, y: i % 2 ? 28 : -28 }; });
      sim.state.players
        .filter((p) => p.team === 1)
        .forEach((p, i) => { p.pos = { x: 30 + i, y: i % 2 ? 24 : -24 }; });
      sim.state.controlledIdx[0] = passer.idx;
      sim.state.ball.ownerIdx = passer.idx;
      sim.state.ball.pos = { ...passer.pos };

      sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
      sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

      const targetAngle = Math.atan2(mate.pos.y - passer.pos.y, mate.pos.x - passer.pos.x);
      const ballAngle = Math.atan2(sim.state.ball.vel.y, sim.state.ball.vel.x);
      return Math.abs(Math.atan2(Math.sin(ballAngle - targetAngle), Math.cos(ballAngle - targetAngle)));
    };

    expect(run(35)).toBeGreaterThan(run(95) + 0.035);
  });

  it('uses shooting skill for both shot power and accuracy', () => {
    // shot accuracy is stochastic per attempt; average several seeds so the
    // assertion tests the genuine skill->error relationship rather than a single
    // RNG draw (one sample is hostage to the exact rng sequence at kick time)
    const shotOnce = (shoot: number, seed: number) => {
      const cfg = makeHumanCfg();
      cfg.seed = seed;
      const sim = new MatchSim(cfg);
      sim.state.phase = 'play';
      const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      shooter.attrs.shoot = shoot;
      shooter.pos = { x: HALF_LEN - 24, y: 0 };
      shooter.facing = 0;
      sim.state.controlledIdx[0] = shooter.idx;
      sim.state.ball.ownerIdx = shooter.idx;
      sim.state.ball.pos = { ...shooter.pos };

      sim.step([{ ...idleWithSwitch, shoot: true, moveX: 1, moveY: 0.55 }, { ...NULL_INPUT }]);
      stepMany(sim, Math.round(0.22 / DT), [{ ...idleWithSwitch, shoot: true, moveX: 1, moveY: 0.55 }, { ...NULL_INPUT }]);
      sim.step([{ ...idleWithSwitch, shoot: false, moveX: 1, moveY: 0.55 }, { ...NULL_INPUT }]);

      const speed = Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y);
      const tToLine = (HALF_LEN - sim.state.ball.pos.x) / sim.state.ball.vel.x;
      const yAtLine = sim.state.ball.pos.y + sim.state.ball.vel.y * tToLine;
      const intendedY = 0.55 * GOAL_HALF_WIDTH * 1.04;
      return { speed, error: Math.abs(yAtLine - intendedY) };
    };
    const run = (shoot: number) => {
      const seeds = [101, 202, 303, 404, 505, 606, 707, 808];
      let speed = 0, error = 0;
      for (const s of seeds) { const r = shotOnce(shoot, s); speed += r.speed; error += r.error; }
      return { speed: speed / seeds.length, error: error / seeds.length };
    };

    const low = run(35);
    const high = run(95);

    expect(high.speed).toBeGreaterThan(low.speed + 1.2);
    expect(low.error).toBeGreaterThan(high.error + 0.12);
  });

  it('uses goalkeeper keeping to position better at narrow angles', () => {
    const run = (keeping: number) => {
      const sim = new MatchSim(makeCfg());
      sim.state.phase = 'play';
      const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
      attacker.pos = { x: HALF_LEN - 5.2, y: 7.4 };
      sim.state.ball.ownerIdx = attacker.idx;
      sim.state.ball.pos = { ...attacker.pos };
      gk.attrs.keeping = keeping;

      return (sim as unknown as { gkPosition: (p: SimPlayer) => { x: number; y: number } }).gkPosition(gk);
    };

    const low = run(35);
    const high = run(95);

    // a better keeper narrows the angle by coming further off his line...
    expect(high.x).toBeLessThan(low.x);
    // ...while BOTH stay inside the goal frame, covering the far post instead of
    // drifting out past the near post (which left the far corner gaping)
    expect(Math.abs(high.y)).toBeLessThanOrEqual(GOAL_HALF_WIDTH);
    expect(Math.abs(low.y)).toBeLessThanOrEqual(GOAL_HALF_WIDTH);
    // still shaded toward the attacker's side, not glued to the centre
    expect(high.y).toBeGreaterThan(1);
  });

  it('sets a good goalkeeper close to the near post before a side-box shot', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 8.4, y: GOAL_HALF_WIDTH + 0.45 };
    attacker.vel = { x: 1.9, y: -0.25 };
    gk.pos = { x: HALF_LEN - 1.1, y: GOAL_HALF_WIDTH * 0.9 };
    gk.attrs.keeping = 90;
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.z = 0;

    const target = (sim as unknown as { gkPosition: (p: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    expect(target.y).toBeGreaterThanOrEqual(GOAL_HALF_WIDTH * 0.86);
  });

  it('makes goalkeepers dive toward shots heading for the corner', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.1, y: 0 };
    gk.vel = { x: 0, y: 0 };
    sim.state.ball.pos = { x: HALF_LEN - 9, y: 0.4 };
    sim.state.ball.vel = { x: 22, y: 5.6 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0.2;
    sim.state.ball.ownerIdx = -1;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    // the ball is already in flight, so the keeper's reflex window has elapsed
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;

    sim.step(idle);

    expect(Math.abs(gk.vel.y)).toBeGreaterThan(4);
    expect(gk.anim).toBe('dive');
  });

  it('keeps line-save goalkeepers facing the shot and stores a stable dive side', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.1, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.facing = Math.PI;
    sim.state.ball.pos = { x: HALF_LEN - 9, y: 0.4 };
    sim.state.ball.vel = { x: 22, y: 5.6 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0.2;
    sim.state.ball.ownerIdx = -1;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    // the ball is already in flight, so the keeper's reflex window has elapsed
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    const dive = gk as unknown as { diveSide?: number; diveKind?: string | null };
    expect(gk.anim).toBe('dive');
    expect(dive.diveKind).toBe('line');
    expect(Math.abs(dive.diveSide ?? 0)).toBe(1);
    expect(Math.cos(gk.facing)).toBeLessThan(-0.65);

    const firstSide = dive.diveSide;
    gk.vel.y *= -1;
    sim.state.ball.vel.y *= -1;
    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(dive.diveSide).toBe(firstSide);
  });

  it('keeps line-save dives across the goal instead of backwards into the net', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 2.8, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.facing = Math.PI;
    sim.state.ball.pos = { x: HALF_LEN - 8.2, y: 0.2 };
    sim.state.ball.vel = { x: 20, y: 5.2 };
    sim.state.ball.z = 0.25;
    sim.state.ball.vz = 0.1;
    sim.state.ball.ownerIdx = -1;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    // the ball is already in flight, so the keeper's reflex window has elapsed
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(gk.anim).toBe('dive');
    expect(gk.vel.x).toBeLessThanOrEqual(0);
    expect(Math.abs(gk.vel.y)).toBeGreaterThan(Math.abs(gk.vel.x) * 4);
  });

  it('keeps tight-angle diagonal saves covering the near post instead of diving away from it', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 8.8, y: GOAL_HALF_WIDTH + 5.0 };
    gk.pos = { x: HALF_LEN - 1.1, y: GOAL_HALF_WIDTH * 0.94 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 84;

    const targetY = GOAL_HALF_WIDTH * 0.72;
    const angle = Math.atan2(targetY - shooter.pos.y, HALF_LEN - shooter.pos.x);
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = {
      x: shooter.pos.x + Math.cos(angle) * 2.0,
      y: shooter.pos.y + Math.sin(angle) * 2.0,
    };
    sim.state.ball.vel = { x: Math.cos(angle) * 25, y: Math.sin(angle) * 25 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0.05;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);
    (sim as unknown as { gkSetY: number }).gkSetY = gk.pos.y;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(gk.anim).toBe('dive');
    expect(gk.vel.y).toBeGreaterThanOrEqual(0);
  });

  it('treats diagonal side-box shots at the near post as near-post threats', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 8.4, y: GOAL_HALF_WIDTH + 0.45 };
    gk.pos = { x: HALF_LEN - 1.1, y: GOAL_HALF_WIDTH * 0.9 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 84;

    const targetY = GOAL_HALF_WIDTH * 0.68;
    const angle = Math.atan2(targetY - shooter.pos.y, HALF_LEN - shooter.pos.x);
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = {
      x: shooter.pos.x + Math.cos(angle) * 2.0,
      y: shooter.pos.y + Math.sin(angle) * 2.0,
    };
    sim.state.ball.vel = { x: Math.cos(angle) * 25, y: Math.sin(angle) * 25 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0.05;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);
    (sim as unknown as { gkSetY: number }).gkSetY = gk.pos.y;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(gk.anim).toBe('dive');
    expect(gk.vel.y).toBeGreaterThanOrEqual(0);
  });

  it('keeps live-shot goalkeeper positioning on the near-post side before the dive', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 8.4, y: GOAL_HALF_WIDTH + 0.45 };
    gk.pos = { x: HALF_LEN - 1.1, y: GOAL_HALF_WIDTH * 0.9 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 90;

    const targetY = GOAL_HALF_WIDTH * 0.68;
    const angle = Math.atan2(targetY - shooter.pos.y, HALF_LEN - shooter.pos.x);
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = {
      x: shooter.pos.x + Math.cos(angle) * 2.0,
      y: shooter.pos.y + Math.sin(angle) * 2.0,
    };
    sim.state.ball.vel = { x: Math.cos(angle) * 25, y: Math.sin(angle) * 25 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0.05;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);

    const target = (sim as unknown as { gkPosition: (player: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    expect(target.y).toBeGreaterThanOrEqual(gk.pos.y);
  });

  it('parries diving near-post saves instead of snapping the ball into the keeper hands', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 8.4, y: GOAL_HALF_WIDTH + 0.45 };
    gk.pos = { x: HALF_LEN - 1.1, y: GOAL_HALF_WIDTH * 0.9 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 90;
    const targetY = GOAL_HALF_WIDTH * 0.68;
    const angle = Math.atan2(targetY - shooter.pos.y, HALF_LEN - shooter.pos.x);
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = {
      x: HALF_LEN - 1.85,
      y: gk.pos.y - 0.55,
    };
    sim.state.ball.vel = { x: Math.cos(angle) * 25, y: Math.sin(angle) * 25 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0.05;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);
    (sim as unknown as { gkSetY: number }).gkSetY = gk.pos.y;
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: () => 0,
      range: (a, b) => (a + b) / 2,
    };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.events.some((e) => e.type === 'save' && e.team === 1)).toBe(true);
    expect(sim.state.ball.ownerIdx).not.toBe(gk.idx);
    expect(sim.state.ball.held).not.toBe(true);
  });

  it('registers a save when a live shot physically hits the goalkeeper', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.1, y: 0 };
    gk.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p !== gk)
      .forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: gk.pos.x - 0.7, y: 0 };
    sim.state.ball.vel = { x: 19, y: 0 };
    sim.state.ball.z = 0.45;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;

    (sim as unknown as { integrateBall: (inputs: [PadInput, PadInput]) => void }).integrateBall(idle);

    expect(sim.events.some((e) => e.type === 'save' && e.team === 1)).toBe(true);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeLessThan(13);
    expect(sim.state.ball.lastTouchTeam).toBe(1);
  });

  it('treats goalkeeper blocks from live shots as saves even when the shot is drifting just wide', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.2, y: GOAL_HALF_WIDTH + 1.15 };
    gk.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p !== gk)
      .forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: gk.pos.x - 0.65, y: gk.pos.y };
    sim.state.ball.vel = { x: 20, y: 1.8 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;

    (sim as unknown as { integrateBall: (inputs: [PadInput, PadInput]) => void }).integrateBall(idle);

    expect(sim.events.some((e) => e.type === 'save' && e.team === 1)).toBe(true);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(false);
  });

  it('emits a near miss when a live shot flashes just wide of the post', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.players.forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.pos = { x: HALF_LEN + 0.45, y: GOAL_HALF_WIDTH + 0.65 };
    sim.state.ball.vel = { x: 18, y: 0.15 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;

    sim.step(idle);

    expect(sim.events.some((e) => e.type === 'nearMiss')).toBe(true);
    expect(sim.state.excitement).toBeGreaterThan(0.1);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(false);
  });

  it('does not award a goal when a wide shot crosses outside the post before curling behind the side net', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.players.forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.pos = { x: HALF_LEN - 0.05, y: GOAL_HALF_WIDTH + 0.44 };
    sim.state.ball.vel = { x: 30, y: -36 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;

    sim.step(idle);

    expect(sim.events.some((e) => e.type === 'goal')).toBe(false);
    expect(sim.state.score[0]).toBe(0);
    expect(sim.state.phase).toBe('goalKick');
  });

  it('awards a goal when the first bounds check starts just behind the line inside the posts', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.players.forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.pos = { x: HALF_LEN + 0.45, y: GOAL_HALF_WIDTH * 0.42 };
    sim.state.ball.vel = { x: 22, y: 0.2 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;

    (sim as unknown as {
      checkBounds: (frameStart?: { pos: { x: number; y: number }; z: number }) => void;
    }).checkBounds({
      pos: { x: HALF_LEN + 0.02, y: GOAL_HALF_WIDTH * 0.42 },
      z: 0.35,
    });

    expect(sim.events.some((e) => e.type === 'goal')).toBe(true);
    expect(sim.state.score[0]).toBe(1);
    expect(sim.state.phase).toBe('goalCelebration');
  });

  it('does not award a goal when the ball is already deep behind the side net before moving inside the posts', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.players.forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.pos = { x: HALF_LEN + 0.22, y: GOAL_HALF_WIDTH * 0.42 };
    sim.state.ball.vel = { x: 0.5, y: -5 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;

    (sim as unknown as {
      checkBounds: (frameStart?: { pos: { x: number; y: number }; z: number }) => void;
    }).checkBounds({
      pos: { x: HALF_LEN + 0.18, y: GOAL_HALF_WIDTH * 0.42 },
      z: 0.35,
    });

    expect(sim.events.some((e) => e.type === 'goal')).toBe(false);
    expect(sim.state.score[0]).toBe(0);
  });

  it('keeps goalkeeper parries from launching the ball toward halfway', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.0, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 100;
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: HALF_LEN - 1.25, y: 1.2 };
    sim.state.ball.vel = { x: 24, y: 0.2 };
    sim.state.ball.z = 0.7;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: (() => {
        const seq = [0, 0.95];
        return () => seq.shift() ?? 0.5;
      })(),
      range: (a: number, b: number) => (a + b) / 2,
    };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.events.some((e) => e.type === 'save')).toBe(true);
    expect(Math.abs(sim.state.ball.vel.x)).toBeLessThan(9.5);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeLessThan(13);
  });

  it('keeps strong full-stretch saves close — tipped behind or spilled into the box', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.0, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 78;
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: HALF_LEN - 1.25, y: 1.6 };
    sim.state.ball.vel = { x: 26, y: 0 };
    sim.state.ball.z = 0.45;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: (() => {
        // first next() passes the save roll; second FORCES a spill (above the hold prob) so
        // we exercise the spill-handling path even for a competent keeper
        const seq = [0, 0.99];
        return () => seq.shift() ?? 0.5;
      })(),
      range: (a: number, b: number) => (a + b) / 2,
    };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.events.some((e) => e.type === 'save')).toBe(true);
    expect(sim.state.ball.ownerIdx).toBe(-1);
    // a strong full-stretch save is tipped behind for a corner or spilled into the
    // box for a scramble — never punched far back upfield (which sprang a counter)
    const spillSpeed = Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y);
    const tippedBehind = Math.abs(sim.state.ball.pos.x) >= HALF_LEN;
    expect(tippedBehind || spillSpeed < 6.5).toBe(true);
    expect(spillSpeed).toBeLessThan(6.5);
  });

  it('has the goalkeeper deal with a loose pass rolling toward the goal', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.pos = { x: HALF_LEN - 1.0, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 100;
    sim.state.players
      .filter((p) => p !== gk)
      .forEach((p, i) => { p.pos = { x: -38 + i, y: i % 2 ? 25 : -25 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = -1;
    sim.state.ball.pos = { x: HALF_LEN - 5.2, y: 0.45 };
    sim.state.ball.vel = { x: 9, y: 0 };
    sim.state.ball.z = 0.1;
    sim.state.ball.vz = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = false;
    const defendingTeam = gk.team;

    let saved = false;
    for (let i = 0; i < Math.round(1.2 / DT); i++) {
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'save')) saved = true;
      if (sim.state.ball.lastTouchTeam === defendingTeam || sim.state.ball.ownerIdx === gk.idx) break;
    }

    expect(sim.state.score[0]).toBe(0);
    expect(sim.state.ball.lastTouchTeam).toBe(defendingTeam);
    expect(saved || sim.state.ball.ownerIdx === gk.idx).toBe(true);
  });

  it('deflects a hard ball that clearly hits an outfield player', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const defender = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    defender.pos = { x: 0, y: 0 };
    defender.vel = { x: 0, y: 0 };
    defender.facing = Math.PI;
    sim.state.players
      .filter((p) => p !== defender)
      .forEach((p, i) => { p.pos = { x: 20 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = -1;
    sim.state.ball.pos = { x: -0.55, y: 0 };
    sim.state.ball.vel = { x: 20, y: 0 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;

    (sim as unknown as { integrateBall: (inputs: [PadInput, PadInput]) => void }).integrateBall(idle);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.lastTouchTeam).toBe(1);
    expect(sim.state.ball.vel.x).toBeLessThan(3);
    expect(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y)).toBeLessThan(14);
  });

  it('lets a player control a low-power ball that hits them', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const receiver = sim.state.players.find((p) => p.team === 1 && !p.isGK)!;
    receiver.pos = { x: 0, y: 0 };
    receiver.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p !== receiver)
      .forEach((p, i) => { p.pos = { x: 20 + i, y: i % 2 ? 24 : -24 }; });
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = -1;
    sim.state.ball.pos = { x: -0.72, y: 0 };
    sim.state.ball.vel = { x: 5.2, y: 0 };
    sim.state.ball.z = 0.15;
    sim.state.ball.vz = 0;

    (sim as unknown as { integrateBall: (inputs: [PadInput, PadInput]) => void }).integrateBall(idle);

    expect(sim.state.ball.ownerIdx).toBe(receiver.idx);
    expect(sim.state.ball.lastTouchTeam).toBe(1);
  });

  it('moves the goalkeeper out to close down a dribbler in the six-yard area', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 6.2, y: 1.2 };
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    gk.pos = { x: HALF_LEN - 0.9, y: 0 };

    const target = (sim as unknown as { gkPosition: (player: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    expect(target.x).toBeLessThan(HALF_LEN - 3);
    expect(Math.abs(target.y - attacker.pos.y)).toBeLessThan(1.5);
  });

  it('keeps a rushing goalkeeper committed instead of bouncing back to his line at the box edge', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.attrs.keeping = 84;
    gk.pos = { x: HALF_LEN - 1.0, y: 0 };
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.z = 0;

    attacker.pos = { x: HALF_LEN - 17.2, y: 1.0 };
    attacker.vel = { x: 1.8, y: 0 };
    sim.state.ball.pos = { ...attacker.pos };
    const committed = (sim as unknown as { gkPosition: (player: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    sim.state.tick += Math.round(0.12 / DT);
    attacker.pos = { x: HALF_LEN - 20.4, y: 1.1 };
    attacker.vel = { x: 0.5, y: 0 };
    sim.state.ball.pos = { ...attacker.pos };
    const held = (sim as unknown as { gkPosition: (player: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    expect(committed.x).toBeLessThan(HALF_LEN - 4.2);
    expect(Math.abs(held.x - committed.x)).toBeLessThan(1.2);
    expect(held.x).toBeLessThan(HALF_LEN - 4.0);
  });

  it('does not replace a goalkeeper rush commit with a retreat target while the same dribbler is still dangerous', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.attrs.keeping = 84;
    gk.pos = { x: HALF_LEN - 1.0, y: 0 };
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.z = 0;

    attacker.pos = { x: HALF_LEN - 12.0, y: 0 };
    attacker.vel = { x: 2.0, y: 0 };
    sim.state.ball.pos = { ...attacker.pos };
    const committed = (sim as unknown as { gkPosition: (player: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    sim.state.tick += Math.round(0.12 / DT);
    attacker.pos = { x: HALF_LEN - 15.5, y: 9.5 };
    attacker.vel = { x: 1.2, y: -0.2 };
    sim.state.ball.pos = { ...attacker.pos };
    const held = (sim as unknown as { gkPosition: (player: SimPlayer) => { x: number; y: number } }).gkPosition(gk);

    expect(committed.x).toBeLessThan(HALF_LEN - 9);
    expect(Math.abs(held.x - committed.x)).toBeLessThan(1.2);
    expect(Math.abs(held.y - committed.y)).toBeLessThan(4.5);
  });

  it('makes an off-line close-down goalkeeper spread and block a close shot', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 9.0, y: 0.25 };
    shooter.attrs = { ...shooter.attrs, shoot: 80 };
    gk.pos = { x: HALF_LEN - 5.6, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 86;
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: HALF_LEN - 7.0, y: 0.25 };
    sim.state.ball.vel = { x: 25, y: -0.25 };
    sim.state.ball.z = 0.25;
    sim.state.ball.vz = 0;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: () => 0,
      range: (a, b) => (a + b) / 2,
    };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(gk.anim).toBe('dive');
    expect(gk.diving).toBe(true);
    // a rushed-out close-down spread (rendered as a forward slide), not a lateral line dive
    expect((gk as unknown as { diveKind?: string | null }).diveKind).toBe('spread');
    expect(sim.events.some((e) => e.type === 'save' && e.team === 1)).toBe(true);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(false);
  });

  it('does not let an off-line goalkeeper block a shot before the ball reaches him', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 17.5, y: 0 };
    gk.pos = { x: HALF_LEN - 6.0, y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 98;
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: HALF_LEN - 14.0, y: 0 };
    sim.state.ball.vel = { x: 24, y: 0 };
    sim.state.ball.z = 0.25;
    sim.state.ball.vz = 0;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);
    const before = { ...sim.state.ball.pos };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.events.some((e) => e.type === 'save')).toBe(false);
    expect(dist2(sim.state.ball.pos, before)).toBeLessThan(0.05);
    expect((sim as unknown as { shotLive: boolean }).shotLive).toBe(true);
  });

  it('lets the goalkeeper dive at the feet of a close dribbler', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 2.7, y: 0.4 };
    attacker.vel = { x: 2, y: 0 };
    gk.pos = { x: HALF_LEN - 1.2, y: 0.1 };
    gk.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.z = 0;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.state.ball.ownerIdx).not.toBe(attacker.idx);
    expect(sim.state.ball.lastTouchTeam).toBe(1);
    expect(gk.anim).toBe('smother');
    expect((gk as unknown as { diveKind?: string | null }).diveKind).toBe('smother');
    expect(sim.events.some((e) => e.type === 'save')).toBe(true);
  });

  it('lets the goalkeeper smother when an attacker tries to round him one-on-one', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 4.1, y: 2.2 };
    attacker.vel = { x: 2.5, y: 1.4 };
    gk.pos = { x: HALF_LEN - 1.4, y: 0.9 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 82;
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.z = 0;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.state.ball.ownerIdx).not.toBe(attacker.idx);
    expect(gk.anim).toBe('smother');
    expect((gk as unknown as { diveKind?: string | null }).diveKind).toBe('smother');
    expect(sim.events.some((e) => e.type === 'save')).toBe(true);
  });

  it('does not let a beaten goalkeeper smother from behind after the attacker has gone past him', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 1.6, y: 0.45 };
    attacker.vel = { x: 1.4, y: 0 };
    gk.pos = { x: HALF_LEN - 2.8, y: 0.25 };
    gk.vel = { x: 0.4, y: 0 };
    gk.attrs.keeping = 95;
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.z = 0;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.state.ball.ownerIdx).toBe(attacker.idx);
    expect(gk.anim).not.toBe('smother');
    expect(sim.events.some((e) => e.type === 'save')).toBe(false);
  });

  it('commits to a feet-first smother during a live diagonal one-on-one', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 12.5, y: 4.8 };
    attacker.vel = { x: 3.2, y: 1.1 };
    attacker.attrs = { ...attacker.attrs, pace: 90, shoot: 80 };
    gk.pos = { x: HALF_LEN - 1.0, y: 0.2 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 88;
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.z = 0;

    let smotherTick = -1;
    for (let i = 0; i < Math.round(1.8 / DT); i++) {
      sim.step([{ ...idleWithSwitch, moveX: 1, moveY: 0.38, sprint: true }, { ...NULL_INPUT }]);
      if (gk.anim === 'smother') {
        smotherTick = i;
        break;
      }
    }

    expect(smotherTick).toBeGreaterThanOrEqual(0);
    expect(attacker.pos.x).toBeLessThan(HALF_LEN - 1.5);
    expect(sim.state.ball.ownerIdx).not.toBe(attacker.idx);
    expect((gk as unknown as { diveKind?: string | null }).diveKind).toBe('smother');
  });

  it('makes strong goalkeepers commit earlier to feet-first one-on-one smothers', () => {
    const run = (keeping: number) => {
      const sim = new MatchSim(makeCfg());
      sim.state.phase = 'play';
      const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
      const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
      attacker.pos = { x: HALF_LEN - 5.35, y: 0.55 };
      attacker.vel = { x: 2.8, y: 0.15 };
      gk.pos = { x: HALF_LEN - 1.2, y: 0.15 };
      gk.vel = { x: 0, y: 0 };
      gk.attrs.keeping = keeping;
      sim.state.ball.ownerIdx = attacker.idx;
      sim.state.ball.pos = { ...attacker.pos };
      sim.state.ball.z = 0;

      (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

      return {
        ownerIdx: sim.state.ball.ownerIdx,
        gkIdx: gk.idx,
        held: sim.state.ball.held,
        lastTouchTeam: sim.state.ball.lastTouchTeam,
        anim: gk.anim,
        save: sim.events.some((e) => e.type === 'save'),
      };
    };

    const weak = run(35);
    const strong = run(92);

    expect(weak.ownerIdx).not.toBe(-1);
    // the strong keeper commits to the smother and now GATHERS the ball (collapses on it)
    // rather than shovelling it loose, so it ends up held by him, not squirting away
    expect(strong.ownerIdx).toBe(strong.gkIdx);
    expect(strong.held).toBe(true);
    expect(strong.lastTouchTeam).toBe(1);
    expect(strong.anim).toBe('smother');
    expect(strong.save).toBe(true);
  });

  it('holds routine saves far more reliably for a better keeper (rare spills for the elite)', () => {
    // Fresh sim per seed so the elite and the poor keeper face the SAME shot and the SAME
    // RNG — the only difference is the keeping rating, so this isolates handling.
    function holdRate(keeping: number) {
      let held = 0, saves = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const sim = new MatchSim(makeCfg({ seed: seed * 131 }));
        const st = sim.state;
        st.phase = 'play';
        const gk = st.players.find((p) => p.team === 1 && p.isGK)!;
        gk.attrs = { ...gk.attrs, keeping };
        const dir = st.attackDir[0]; // team 0 attacks this goal; team 1's keeper defends it
        const goalX = dir * HALF_LEN;
        gk.pos = { x: goalX - dir * 0.9, y: 0 }; gk.vel = { x: 0, y: 0 };
        for (const p of st.players) {
          if (p === gk) continue;
          p.pos = { x: -dir * (HALF_LEN - 6), y: p.idx % 2 ? 22 : -22 };
          p.vel = { x: 0, y: 0 };
        }
        // a firm but routine shot, slight spread so he has to set behind it (a real save)
        st.ball.pos = { x: goalX - dir * 9, y: 0 };
        st.ball.vel = { x: dir * 18, y: ((seed % 7) - 3) * 0.7 };
        st.ball.z = 0.4; st.ball.vz = 0; st.ball.ownerIdx = -1;
        (sim as unknown as { shotLive: boolean }).shotLive = true;
        let res = 'miss';
        for (let i = 0; i < 35; i++) {
          sim.step(idle);
          const b = st.ball;
          if (b.held && b.ownerIdx === gk.idx) { res = 'held'; break; }
          if (st.score[0] > 0) { res = 'goal'; break; }
          if (b.lastKicker === gk.idx && b.ownerIdx === -1 && Math.sign(b.vel.x) === -Math.sign(dir)) { res = 'spill'; break; }
        }
        if (res === 'held') { held++; saves++; } else if (res === 'spill') { saves++; }
      }
      return saves > 0 ? held / saves : 0;
    }
    const elite = holdRate(96);
    const poor = holdRate(40);
    expect(elite).toBeGreaterThan(0.7); // an elite keeper clings on to the vast majority
    expect(elite).toBeGreaterThan(poor + 0.2); // and spills markedly less than a poor one
  });

  it('lets an advanced goalkeeper stop a central one-on-one before the attacker runs through him', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 11.0, y: 0.35 };
    attacker.vel = { x: 3.0, y: 0.1 };
    attacker.attrs = { ...attacker.attrs, pace: 88, shoot: 80 };
    gk.pos = { x: HALF_LEN - 6.55, y: 0.05 };
    gk.vel = { x: -0.4, y: 0 };
    gk.attrs.keeping = 82;
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { ...attacker.pos };
    sim.state.ball.z = 0;

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.state.ball.ownerIdx).not.toBe(attacker.idx);
    expect(sim.state.ball.lastTouchTeam).toBe(1);
    expect(gk.anim).toBe('smother');
    expect((gk as unknown as { diveKind?: string | null }).diveKind).toBe('smother');
    expect(sim.events.some((e) => e.type === 'save' && e.team === 1)).toBe(true);
  });

  it('makes near-post shots from tight angles a goalkeeper save instead of an easy finish', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    shooter.pos = { x: HALF_LEN - 8.5, y: GOAL_HALF_WIDTH + 4.2 };
    shooter.attrs = { ...shooter.attrs, shoot: 78 };
    gk.pos = { x: HALF_LEN - 1.1, y: GOAL_HALF_WIDTH * 0.82 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 84;
    sim.state.ball.ownerIdx = -1;
    const targetY = GOAL_HALF_WIDTH * 0.86;
    const angle = Math.atan2(targetY - shooter.pos.y, HALF_LEN - shooter.pos.x);
    sim.state.ball.pos = {
      x: shooter.pos.x + Math.cos(angle) * 2,
      y: shooter.pos.y + Math.sin(angle) * 2,
    };
    sim.state.ball.vel = { x: Math.cos(angle) * 26, y: Math.sin(angle) * 26 };
    sim.state.ball.z = 0.15;
    sim.state.ball.vz = 0.1;
    sim.state.ball.lastKicker = shooter.idx;
    sim.state.ball.lastTouchTeam = 0;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { shotLiveSince: number }).shotLiveSince = sim.state.tick - Math.round(1 / DT);
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: () => 0,
      range: (a, b) => (a + b) / 2,
    };

    let sawSave = false;
    for (let i = 0; i < Math.round(0.35 / DT); i++) {
      (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();
      sawSave ||= sim.events.some((e) => e.type === 'save');
      sim.step(idle);
      sawSave ||= sim.events.some((e) => e.type === 'save');
    }

    expect(sawSave).toBe(true);
    expect(sim.state.score[0]).toBe(0);
  });

  it('does not let a goalkeeper close-down teleport a loose ball from metres away', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const attacker = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    attacker.pos = { x: HALF_LEN - 2.7, y: 0.4 };
    attacker.vel = { x: 2, y: 0 };
    gk.pos = { x: HALF_LEN - 1.2, y: 0.1 };
    gk.vel = { x: 0, y: 0 };
    sim.state.ball.ownerIdx = attacker.idx;
    sim.state.ball.pos = { x: HALF_LEN - 6.4, y: 0.4 };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.z = 0;
    const before = { ...sim.state.ball.pos };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.events.some((e) => e.type === 'save')).toBe(false);
    expect(dist2(sim.state.ball.pos, before)).toBeLessThan(0.05);
    expect(sim.state.ball.ownerIdx).toBe(attacker.idx);
  });

  it('does not teleport the ball sideways when a goalkeeper catches near the byline', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    gk.pos = { x: -HALF_LEN + 1.0, y: 6.4 };
    gk.vel = { x: 0, y: 0 };
    gk.attrs.keeping = 100;
    sim.state.ball.pos = { x: -HALF_LEN - 0.1, y: 6.4 };
    sim.state.ball.vel = { x: -1, y: -27 };
    sim.state.ball.z = 0.2;
    sim.state.ball.vz = 0;
    sim.state.ball.ownerIdx = -1;
    (sim as unknown as { shotLive: boolean }).shotLive = true;
    // the ball is already in flight, so the keeper's reflex window has elapsed
    (sim as unknown as { shotLivePrev: boolean }).shotLivePrev = true;
    (sim as unknown as { rng: { next: () => number; range: (a: number, b: number) => number } }).rng = {
      next: () => 0,
      range: (a: number, b: number) => (a + b) / 2,
    };
    const before = { ...sim.state.ball.pos };

    (sim as unknown as { goalkeeperLogic: () => void }).goalkeeperLogic();

    expect(sim.events.some((e) => e.type === 'save')).toBe(true);
    expect(dist2(sim.state.ball.pos, before)).toBeLessThan(2.2);
    expect(sim.state.ball.ownerIdx).toBe(gk.idx);
  });

  it('awards the goal at the line but lets the ball carry into the net', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    sim.state.players.forEach((p, i) => { p.pos = { x: -35 + i, y: i % 2 ? 24 : -24 }; });
    const scorer = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = scorer.idx;
    sim.state.ball.pos = { x: HALF_LEN - 0.06, y: 0 };
    sim.state.ball.vel = { x: 10, y: 0 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;

    sim.step(idle);
    expect(sim.state.phase).toBe('goalCelebration');
    expect(sim.state.score[0]).toBe(1);

    stepMany(sim, Math.round(0.35 / DT), idle);

    expect(sim.state.ball.pos.x).toBeGreaterThan(HALF_LEN + 0.6);
    expect(sim.state.ball.pos.x).toBeLessThanOrEqual(HALF_LEN + GOAL_DEPTH + 0.25);
  });

  it('keeps a scored ball inside the side and back net during the celebration', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'goalCelebration';
    sim.state.ball.ownerIdx = -1;
    sim.state.ball.pos = { x: HALF_LEN + GOAL_DEPTH + 0.7, y: GOAL_HALF_WIDTH + 0.85 };
    sim.state.ball.vel = { x: 8, y: 7 };
    sim.state.ball.z = 0.35;
    sim.state.ball.vz = 0;
    (sim as unknown as { scoredGoalSide: number }).scoredGoalSide = 1;

    (sim as unknown as { settleBallInGoalNet: () => void }).settleBallInGoalNet();

    expect(sim.state.ball.pos.x).toBeLessThanOrEqual(HALF_LEN + GOAL_DEPTH);
    expect(sim.state.ball.pos.y).toBeLessThanOrEqual(GOAL_HALF_WIDTH - 0.18);
    expect(sim.state.ball.vel.x).toBeLessThanOrEqual(0);
    expect(sim.state.ball.vel.y).toBeLessThanOrEqual(0);
  });
});

describe('fixtures + table', () => {
  it('round robin: 42 rounds, each team plays 42 games, 21 home-ish', () => {
    const rounds = roundRobin(22);
    expect(rounds.length).toBe(42);
    const played = new Array(22).fill(0);
    const home = new Array(22).fill(0);
    const meetings = new Map<string, number>();
    for (const r of rounds) {
      expect(r.length).toBe(11);
      const seen = new Set<number>();
      for (const [h, a] of r) {
        expect(seen.has(h)).toBe(false);
        expect(seen.has(a)).toBe(false);
        seen.add(h); seen.add(a);
        played[h]++; played[a]++; home[h]++;
        const key = `${h}-${a}`;
        meetings.set(key, (meetings.get(key) ?? 0) + 1);
      }
    }
    expect(played.every((p) => p === 42)).toBe(true);
    expect(home.every((h) => h === 21)).toBe(true);
    // every ordered pair exactly once
    expect(meetings.size).toBe(22 * 21);
  });

  it('table sorts by points then GD', () => {
    const fixtures: [number, number][][] = [[[0, 1], [2, 3]]];
    const results = new Map<string, [number, number]>([
      ['0:0', [3, 0]], ['0:1', [1, 1]],
    ]);
    const table = computeTable(4, results, fixtures);
    expect(table[0].team).toBe(0);
    expect(table[0].points).toBe(3);
    expect(table[1].points).toBe(1);
  });
});

describe('stat sim', () => {
  it('produces plausible scores and knockout always has a winner', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const [h, a] = simulateFixture(85, 60, rng);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(10);
      expect(a).toBeGreaterThanOrEqual(0);
    }
    for (let i = 0; i < 50; i++) {
      const k = simulateKnockout(70, 70, rng);
      expect(k.winner === 0 || k.winner === 1).toBe(true);
    }
  });
});

describe('transfers', () => {
  it('values stars higher and respects budget/squad limits', () => {
    const star = { name: 'Star', pos: 'FW' as const, age: 25, pace: 90, pass: 85, shoot: 92, tackle: 50, keeping: 10 };
    const journeyman = { name: 'Plain', pos: 'FW' as const, age: 33, pace: 55, pass: 55, shoot: 58, tackle: 40, keeping: 10 };
    expect(playerValue(star)).toBeGreaterThan(playerValue(journeyman) * 4);
    expect(clubBudget(90)).toBeGreaterThan(clubBudget(60));

    const squads: Record<string, any[]> = {
      a: TEAMS[0].players.map((p) => ({ ...p })),
      b: TEAMS[1].players.map((p) => ({ ...p })),
    };
    const target = squads.b[10];
    const cost = playerValue(target);
    const newBudget = buyPlayer(squads, 'a', { teamId: 'b', player: target }, cost + 100);
    expect(newBudget).toBe(100);
    // squads now start at a full 26, so a buy takes the buyer to the one-player headroom cap.
    expect(squads.a.length).toBe(MAX_SQUAD);
    expect(squads.b.length).toBe(25);
    expect(buyPlayer(squads, 'a', { teamId: 'b', player: squads.b[0] }, 0)).toBeNull();

    const rng = new Rng(7);
    const sellBudget = sellPlayer(squads, 'a', 18, 0, rng);
    expect(sellBudget).toBeGreaterThan(0);
    expect(squads.a.length).toBe(26);
  });

  it('negotiates transfer offers through counters before acceptance', async () => {
    const transfers = await import('../../game/transfers');
    const squads: Record<string, any[]> = {
      a: TEAMS[0].players.map((p) => ({ ...p })),
      b: TEAMS[1].players.map((p) => ({ ...p })),
    };
    const target = squads.b[9];
    const ask = transfers.askingPrice(squads.b, target);
    const low = transfers.negotiateBuyPlayer(
      squads,
      'a',
      { teamId: 'b', player: target },
      ask * 2,
      Math.round(ask * 0.7),
      new Rng(3),
    );
    expect(low.status).toBe('counter');
    expect(low.counterOffer).toBeGreaterThan(Math.round(ask * 0.7));
    expect(squads.a.some((p) => p.name === target.name)).toBe(false);

    const accepted = transfers.negotiateBuyPlayer(
      squads,
      'a',
      { teamId: 'b', player: target },
      ask * 2,
      low.counterOffer!,
      new Rng(4),
      low.round,
    );
    expect(accepted.status).toBe('accepted');
    expect(squads.a.some((p) => p.name === target.name)).toBe(true);
    expect(accepted.newBudget).toBe(ask * 2 - low.counterOffer!);
  });
});

describe('career', () => {
  it('league career plays through all 126 rounds', () => {
    // double round-robin over all 64 nations -> (64-1)*2 = 126 rounds
    const c = newCareer('league', 0, 99);
    expect(c.calendar.length).toBe(126);
    let guard = 0;
    while (!c.finished && guard < 140) {
      const fx = userFixture(c);
      expect(fx).toBeTruthy();
      advance(c, [2, 1]);
      guard++;
    }
    expect(c.finished).toBe(true);
    const table = leagueTable(c);
    expect(table[0].points).toBeGreaterThan(40);
    const you = table.find((r) => r.team === 0)!;
    expect(you.won).toBe(126);
  });

  it('cup career produces a winner and tracks elimination', () => {
    const c = newCareer('cup', 3, 123);
    let guard = 0;
    while (!c.finished && guard < 10) {
      const fx = userFixture(c);
      if (fx) advance(c, [0, 1]); // user loses -> eliminated
      else advance(c);
      guard++;
    }
    expect(c.finished).toBe(true);
    const final = c.cupRounds[c.cupRounds.length - 1];
    expect(final.ties.length).toBe(1);
    expect(final.ties[0].winner === 0 || final.ties[0].winner === 1).toBe(true);
  });

  it('season career interleaves league, cup and windows', () => {
    const c = newCareer('season', 5, 77);
    const kinds = c.calendar.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'league').length).toBe(126);
    expect(kinds.filter((k) => k === 'cup').length).toBe(6);
    expect(kinds.filter((k) => k === 'window').length).toBe(2);
    expect(c.budget).toBeGreaterThan(0);
    // run the whole thing simulating user wins
    let guard = 0;
    while (!c.finished && guard < 150) {
      const ev = currentEvent(c)!;
      if (ev.kind !== 'window' && userFixture(c)) advance(c, [1, 0], true);
      else advance(c);
      guard++;
    }
    expect(c.finished).toBe(true);
  });

  it('tracks board expectations, training plan and player development state', () => {
    const c = newCareer('season', 0, 321);
    expect(c.board.expectation).toMatch(/finish/i);
    expect(c.training.focus).toBe('balanced');
    expect(Object.keys(c.playerStates).length).toBeGreaterThan(10);

    setTrainingPlan(c, { focus: 'attacking', intensity: 'hard' });
    const teamId = TEAMS[c.userTeam].id;
    const forward = c.squads[teamId].find((p) => p.pos === 'FW')!;
    const before = forward.shoot;

    applyTrainingWeek(c, new Rng(99));

    expect(forward.shoot).toBeGreaterThanOrEqual(before);
    expect(c.training.focus).toBe('attacking');
    expect(c.news.some((n) => /training/i.test(n))).toBe(true);
  });

  it('migrates older saved careers with career-mode defaults', () => {
    const c = newCareer('season', 1, 222);
    delete (c as any).training;
    delete (c as any).board;
    delete (c as any).playerStates;
    delete (c as any).negotiations;

    ensureCareerSystems(c);

    expect(c.training.focus).toBe('balanced');
    expect(c.board.confidence).toBeGreaterThan(0);
    expect(c.negotiations).toEqual([]);
    expect(Object.keys(c.playerStates).length).toBeGreaterThan(10);
  });
});

describe('weather', () => {
  const weathers = ['normal', 'sunny', 'rain', 'snow', 'ice'] as const;
  it('completes matches under every weather condition', () => {
    for (const weather of weathers) {
      const sim = new MatchSim({ ...makeCfg({ halfLengthSec: 30 }), weather });
      let guard = 0;
      while (sim.state.phase !== 'finished' && guard++ < 60 * 60 * 8) sim.step(idle);
      expect(sim.state.phase).toBe('finished');
    }
  }, 30000);

  it('stays deterministic with weather effects active', () => {
    const run = () => {
      const sim = new MatchSim({ ...makeCfg({ halfLengthSec: 30, seed: 777 }), weather: 'ice' });
      for (let i = 0; i < 60 * 20; i++) sim.step(idle);
      return JSON.stringify([sim.state.score, sim.state.ball.pos]);
    };
    expect(run()).toBe(run());
  });
});

describe('set pieces and aerials', () => {
  const press = (over: Partial<PadInput>): PadInput => ({ ...NULL_INPUT, ...over });

  function setupRestart(phase: 'corner' | 'freeKick', restartPos: { x: number; y: number }) {
    const cfg = makeCfg({ halfLengthSec: 120, seed: 31 });
    cfg.teams[0] = { ...cfg.teams[0], controller: 'human' };
    const sim = new MatchSim(cfg);
    const st = sim.state;
    st.phase = phase;
    st.restartTeam = 0;
    st.restartPos = { ...restartPos };
    st.restartTimer = 0.01;
    st.ball.pos = { ...restartPos };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.z = 0;
    // park a taker on the spot
    const taker = st.players.find((p) => p.team === 0 && !p.isGK)!;
    taker.pos = { x: restartPos.x - 1, y: restartPos.y };
    taker.vel = { x: 0, y: 0 };
    return sim;
  }

  it('holding pass at a corner produces a lofted delivery, tapping keeps it flat', () => {
    const lofted = setupRestart('corner', { x: 52.1, y: 33.6 });
    for (let i = 0; i < 40; i++) lofted.step([press({ pass: true }), { ...NULL_INPUT }]);
    let guard = 0;
    while (lofted.state.phase !== 'play' && guard++ < 30) lofted.step([press({}), { ...NULL_INPUT }]);
    expect(lofted.state.phase).toBe('play');
    const loftedVz = lofted.state.ball.vz;

    const driven = setupRestart('corner', { x: 52.1, y: 33.6 });
    for (let i = 0; i < 5; i++) driven.step([press({ pass: true }), { ...NULL_INPUT }]);
    guard = 0;
    while (driven.state.phase !== 'play' && guard++ < 30) driven.step([press({}), { ...NULL_INPUT }]);
    expect(driven.state.phase).toBe('play');
    expect(loftedVz).toBeGreaterThan(driven.state.ball.vz + 1.5);
  });

  it('a charged free kick in range is a real shot at goal', () => {
    const sim = setupRestart('freeKick', { x: 25, y: 4 });
    for (let i = 0; i < 30; i++) sim.step([press({ shoot: true }), { ...NULL_INPUT }]);
    let sawShot = false;
    let guard = 0;
    while (sim.state.phase !== 'play' && guard++ < 30) {
      sim.step([press({}), { ...NULL_INPUT }]);
      if (sim.events.some((e) => e.type === 'shot')) sawShot = true;
    }
    expect(sim.state.phase).toBe('play');
    expect(sawShot).toBe(true);
    expect(sim.state.ball.vel.x).toBeGreaterThan(12); // towards the +x goal
    expect(sim.state.ball.vz).toBeGreaterThan(1); // climbing over the wall
  });

it('charged free-kick shots clear the defensive wall', () => {
    const sim = setupRestart('freeKick', { x: 29, y: 3 });
    for (let i = 0; i < 30; i++) sim.step([press({ shoot: true }), { ...NULL_INPUT }]);
    let guard = 0;
    while (String(sim.state.phase) !== 'play' && guard++ < 10) sim.step([press({}), { ...NULL_INPUT }]);
    expect(String(sim.state.phase)).toBe('play');
    // walk the flight to the wall line (9.15m beyond the spot) and check height
    const wallX = 29 + 9.15;
    guard = 0;
    while (sim.state.ball.pos.x < wallX && guard++ < 90) sim.step(idle);
    expect(sim.state.ball.pos.x).toBeGreaterThanOrEqual(wallX);
    expect(sim.state.ball.z).toBeGreaterThan(1.65); // sails over the bodies
  });

  it('lets a well-hit direct free kick dip under the bar and score in a favourable lane', () => {
    const sim = setupRestart('freeKick', { x: HALF_LEN - 23, y: 0 });
    const taker = (sim as unknown as { findTaker: (team: 0 | 1) => SimPlayer | null }).findTaker(0)!;
    taker.attrs = { ...taker.attrs, shoot: 99 };
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.sentOff = true;
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -30 - i, y: i % 2 ? 24 : -24 }; });

    for (let i = 0; i < 30; i++) sim.step([press({ shoot: true, moveY: 0.72 }), { ...NULL_INPUT }]);
    let guard = 0;
    while (sim.state.phase !== 'play' && guard++ < 30) sim.step([press({ moveY: 0.72 }), { ...NULL_INPUT }]);
    while (sim.state.phase === 'play' && guard++ < 220) sim.step(idle);

    expect(sim.state.score[0]).toBe(1);
    expect(sim.events.some((e) => e.type === 'goal')).toBe(true);
  });

  it('AI heads loose airborne balls', () => {
    const sim = new MatchSim(makeCfg({ halfLengthSec: 120, seed: 5 }));
    const st = sim.state;
    st.phase = 'play';
    st.restartTimer = 0;
    // drop a hanging ball onto an outfielder in open play
    let sawHeader = false;
    for (let attempt = 0; attempt < 40 && !sawHeader; attempt++) {
      const target = st.players.find((p) => !p.isGK && p.team === 1)!;
      st.ball.ownerIdx = -1;
      st.ball.pos = { x: target.pos.x, y: target.pos.y };
      st.ball.z = 1.85;
      st.ball.vz = 0.2;
      st.ball.vel = { x: 0, y: 0 };
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'header')) sawHeader = true;
    }
    expect(sawHeader).toBe(true);
  });

  it('AI never heads a loose ball below genuine header height', () => {
    const sim = new MatchSim(makeCfg({ halfLengthSec: 120, seed: 5 }));
    const st = sim.state;
    st.phase = 'play';
    st.restartTimer = 0;
    // chest-height hanging ball: must be controlled or volleyed, never headed
    let sawHeader = false;
    for (let attempt = 0; attempt < 40 && !sawHeader; attempt++) {
      const target = st.players.find((p) => !p.isGK && p.team === 1)!;
      st.ball.ownerIdx = -1;
      st.ball.pos = { x: target.pos.x, y: target.pos.y };
      st.ball.z = 1.5;
      st.ball.vz = 0;
      st.ball.vel = { x: 0, y: 0 };
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'header')) sawHeader = true;
    }
    expect(sawHeader).toBe(false);
  });

  it('AI lets a climbing ball rise instead of jumping at it', () => {
    const sim = new MatchSim(makeCfg({ halfLengthSec: 120, seed: 5 }));
    const st = sim.state;
    st.phase = 'play';
    st.restartTimer = 0;
    let sawHeader = false;
    for (let attempt = 0; attempt < 40 && !sawHeader; attempt++) {
      const target = st.players.find((p) => !p.isGK && p.team === 1)!;
      st.ball.ownerIdx = -1;
      st.ball.pos = { x: target.pos.x, y: target.pos.y };
      st.ball.z = 1.7;
      st.ball.vz = 1.4; // still rising off a bounce
      st.ball.vel = { x: 0, y: 0 };
      sim.step(idle);
      if (sim.events.some((e) => e.type === 'header')) sawHeader = true;
    }
    expect(sawHeader).toBe(false);
  });

  // park a human-controlled player in an empty corner of the pitch with a
  // loose ball hanging next to him
  function setupLooseAirBall(z: number, vz = 0, gap = 1.2) {
    const sim = new MatchSim(makeHumanCfg());
    const st = sim.state;
    st.phase = 'play';
    st.restartTimer = 0;
    const p = st.players.find((q) => q.team === 0 && !q.isGK)!;
    p.pos = { x: -20, y: -20 };
    p.vel = { x: 0, y: 0 };
    for (const q of st.players) {
      if (q !== p) {
        q.pos = { x: 40, y: ((q.idx % 22) - 11) * 2.5 };
        q.vel = { x: 0, y: 0 };
      }
    }
    st.controlledIdx[0] = p.idx;
    st.ball.ownerIdx = -1;
    st.ball.pos = { x: p.pos.x + gap, y: p.pos.y };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.z = z;
    st.ball.vz = vz;
    return { sim, st, p };
  }

  it('a first-time kick at chest height is a volley, not a header', () => {
    const { sim, st, p } = setupLooseAirBall(1.5);
    sim.step([press({ shoot: true }), { ...NULL_INPUT }]);
    // re-pin the ball so the release sees exactly chest height
    st.ball.pos = { x: p.pos.x + 1.2, y: p.pos.y };
    st.ball.z = 1.5;
    st.ball.vz = 0;
    sim.step([press({}), { ...NULL_INPUT }]);
    expect(sim.events.some((e) => e.type === 'header')).toBe(false);
    expect(sim.events.some((e) => e.type === 'kick')).toBe(true);
  });

  it('a first-time kick at head height is a header', () => {
    const { sim, st, p } = setupLooseAirBall(1.7);
    sim.step([press({ shoot: true }), { ...NULL_INPUT }]);
    st.ball.pos = { x: p.pos.x + 1.2, y: p.pos.y };
    st.ball.z = 1.7;
    st.ball.vz = 0;
    sim.step([press({}), { ...NULL_INPUT }]);
    expect(sim.events.some((e) => e.type === 'header')).toBe(true);
  });

  it('releasing shoot under a ball sailing overhead plays nothing', () => {
    const { sim, st } = setupLooseAirBall(2.2, 3, 1.0);
    sim.step([press({ shoot: true }), { ...NULL_INPUT }]);
    for (let i = 0; i < 5; i++) sim.step([press({ shoot: true }), { ...NULL_INPUT }]);
    expect(st.ball.z).toBeGreaterThan(2.35);
    sim.step([press({}), { ...NULL_INPUT }]);
    expect(sim.events.some((e) => e.type === 'kick' || e.type === 'header' || e.type === 'shot')).toBe(false);
  });

  it('releasing pass under a ball sailing overhead plays nothing', () => {
    const { sim, st } = setupLooseAirBall(2.2, 3, 1.0);
    sim.step([press({ pass: true }), { ...NULL_INPUT }]);
    for (let i = 0; i < 5; i++) sim.step([press({ pass: true }), { ...NULL_INPUT }]);
    expect(st.ball.z).toBeGreaterThan(2.35);
    sim.step([press({}), { ...NULL_INPUT }]);
    expect(sim.events.some((e) => e.type === 'kick' || e.type === 'header' || e.type === 'pass')).toBe(false);
  });

  it('AI corners loft high enough to be headed', () => {
    const cfg = makeCfg({ halfLengthSec: 120, seed: 7 });
    const sim = new MatchSim(cfg);
    const st = sim.state;
    st.phase = 'corner';
    st.restartTeam = 0;
    st.restartPos = { x: 52.1, y: 33.6 };
    st.restartTimer = 0.01;
    st.ball.pos = { x: 52.1, y: 33.6 };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.z = 0;
    const taker = st.players.find((q) => q.team === 0 && !q.isGK)!;
    taker.pos = { x: 51.1, y: 33.6 };
    taker.vel = { x: 0, y: 0 };
    let apex = 0;
    for (let i = 0; i < 240; i++) {
      sim.step(idle);
      if (st.ball.z > apex) apex = st.ball.z;
    }
    expect(apex).toBeGreaterThanOrEqual(1.7);
  });
});


describe('gameplay flow improvements', () => {
  it('keeper holds an easy catch and releases it as a pass within a few seconds', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const shooter = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    const gk = sim.state.players.find((p) => p.team === 1 && p.isGK)!;
    gk.attrs = { ...gk.attrs, keeping: 92 };
    // nobody else near the shooting lane: a body deflection would change the script
    for (const p of sim.state.players) {
      if (p !== shooter && p !== gk) p.pos = { x: -40, y: (p.idx % 11) * 3 - 15 };
    }
    // slow shot straight at the keeper — shooter far enough back that he
    // can't re-trap the ball himself (control radius is ~1m)
    shooter.pos = { x: HALF_LEN - 12, y: 0 };
    gk.pos = { x: HALF_LEN - 0.9, y: 0 };
    sim.state.ball.pos = { x: HALF_LEN - 7, y: 0 };
    sim.state.ball.vel = { x: 10, y: 0 };
    sim.state.ball.z = 0.4;
    sim.state.ball.lastTouchTeam = 0;
    sim.state.ball.lastKicker = shooter.idx;
    (sim as unknown as { shotLive: boolean }).shotLive = true;

    let held = false;
    for (let i = 0; i < 240 && !held; i++) {
      sim.step([{ ...NULL_INPUT }, { ...NULL_INPUT }]);
      held = sim.state.ball.held === true && sim.state.ball.ownerIdx === gk.idx;
    }
    expect(held).toBe(true);

    // and within four more seconds he has distributed it again
    let released = false;
    for (let i = 0; i < 240 && !released; i++) {
      sim.step([{ ...NULL_INPUT }, { ...NULL_INPUT }]);
      released = sim.state.ball.ownerIdx !== gk.idx && !sim.state.ball.held;
    }
    expect(released).toBe(true);
  });

  it('clears a held goalkeeper shoot-button punt well beyond the box', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    gk.pos = { x: -HALF_LEN + 3, y: 0 };
    gk.facing = 0;
    sim.state.ball.ownerIdx = gk.idx;
    sim.state.ball.pos = { ...gk.pos };
    sim.state.ball.held = true;
    sim.state.players
      .filter((p) => p.team === 0 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -HALF_LEN + 18 + i * 1.2, y: i % 2 ? 8 : -8 }; });

    (sim as unknown as { gkBigKick: (owner: SimPlayer, inp: PadInput) => void }).gkBigKick(gk, {
      ...NULL_INPUT,
      shoot: true,
      moveX: 1,
    });

    expect(sim.state.ball.vel.x).toBeGreaterThan(27);
    expect((sim as unknown as { livePassTargetIdx: number }).livePassTargetIdx).toBe(-1);
  });

  it('lets a held goalkeeper hold pass for a long ball over the press', () => {
    const sim = new MatchSim(makeHumanCfg());
    sim.state.phase = 'play';
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    const target = sim.state.players.find((p) => p.team === 0 && !p.isGK && p.attrs.pos === 'FW')!;
    gk.pos = { x: -HALF_LEN + 3, y: 0 };
    gk.facing = 0;
    target.pos = { x: 8, y: 4 };
    target.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -HALF_LEN + 20 + (i % 3), y: -12 + i * 2.4 }; });
    sim.state.controlledIdx[0] = gk.idx;
    sim.state.ball.ownerIdx = gk.idx;
    sim.state.ball.pos = { ...gk.pos };
    sim.state.ball.vel = { x: 0, y: 0 };
    sim.state.ball.held = true;

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    stepMany(sim, Math.round(0.25 / DT), [{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.held).toBe(false);
    expect(sim.state.ball.vel.x).toBeGreaterThan(25);
    expect(sim.state.ball.vz).toBeGreaterThan(5);
    expect((sim as unknown as { livePassTargetIdx: number }).livePassTargetIdx).toBe(target.idx);
  });

  it('lets a held goal-kick pass launch beyond the first press', () => {
    const sim = new MatchSim(makeHumanCfg());
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    const target = sim.state.players.find((p) => p.team === 0 && !p.isGK && p.attrs.pos === 'FW')!;
    sim.state.phase = 'goalKick';
    sim.state.restartTeam = 0;
    sim.state.restartTimer = 0;
    sim.state.restartPos = { x: -HALF_LEN + 6, y: 0 };
    sim.state.ball.pos = { ...sim.state.restartPos };
    gk.pos = { x: -HALF_LEN + 5, y: 0 };
    target.pos = { x: 10, y: -4 };
    target.vel = { x: 0, y: 0 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -HALF_LEN + 22 + (i % 4), y: -16 + i * 3 }; });

    sim.step([{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    stepMany(sim, Math.round(0.25 / DT), [{ ...idleWithSwitch, pass: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, pass: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(sim.state.ball.vel.x).toBeGreaterThan(25);
    expect(sim.state.ball.vz).toBeGreaterThan(5);
    expect((sim as unknown as { livePassTargetIdx: number }).livePassTargetIdx).toBe(target.idx);
  });

  it('lets a goal-kick shoot press clear over teams squeezing the box', () => {
    const sim = new MatchSim(makeHumanCfg());
    const gk = sim.state.players.find((p) => p.team === 0 && p.isGK)!;
    sim.state.phase = 'goalKick';
    sim.state.restartTeam = 0;
    sim.state.restartTimer = 0;
    sim.state.restartPos = { x: -HALF_LEN + 6, y: 0 };
    sim.state.ball.pos = { ...sim.state.restartPos };
    gk.pos = { x: -HALF_LEN + 5, y: 0 };
    sim.state.players
      .filter((p) => p.team === 1 && !p.isGK)
      .forEach((p, i) => { p.pos = { x: -HALF_LEN + 20 + (i % 3), y: -12 + i * 2.4 }; });

    sim.step([{ ...idleWithSwitch, shoot: true, moveX: 1 }, { ...NULL_INPUT }]);
    sim.step([{ ...idleWithSwitch, shoot: false, moveX: 1 }, { ...NULL_INPUT }]);

    expect(sim.state.phase).toBe('play');
    expect(sim.state.ball.ownerIdx).toBe(-1);
    expect(sim.state.ball.vel.x).toBeGreaterThan(28);
    expect(sim.state.ball.vz).toBeGreaterThan(6);
  });

  it('guides the intended receiver of a long pass toward the ball', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const passer = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'DF')!;
    const receiver = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    passer.pos = { x: -30, y: 0 };
    receiver.pos = { x: 18, y: 6 };
    receiver.vel = { x: 0, y: 0 };
    sim.state.ball.pos = { x: -30, y: 0 };
    sim.state.ball.ownerIdx = passer.idx;
    // a 45m lofted ball aimed ahead of the receiver
    (sim as unknown as { kickBall: (p: SimPlayer, aim: { x: number; y: number }, speed: number, loft: number, t: number) => void })
      .kickBall(passer, { x: 16, y: 7 }, 24, 0.45, receiver.idx);

    const target = (sim as unknown as { aiTarget: (p: SimPlayer) => { x: number; y: number } }).aiTarget(receiver);
    // the receiver runs at the flight of the ball, not back to formation
    const formation = (sim as unknown as { formationTarget: (p: SimPlayer) => { x: number; y: number } }).formationTarget(receiver);
    expect(dist2(target, formation)).toBeGreaterThan(3);
    expect(Math.abs(target.y - 7)).toBeLessThan(8);
  });

  it('makes long lofted passes settle near the receiving point instead of skidding on', () => {
    const sim = new MatchSim(makeCfg());
    const harness = sim as unknown as {
      speedForReach: (distance: number, loft: number) => number;
      simulateKick: (speed: number, loft: number) => { carry: number; stop: number; reach: number };
    };

    const speed = harness.speedForReach(45, 0.45);
    const profile = harness.simulateKick(speed, 0.45);

    expect(Math.abs(profile.reach - 45)).toBeLessThan(1.8);
    expect(profile.stop - profile.reach).toBeLessThan(13);
  });

  it('keeps a marker goal-side of a runner who breaks beyond the defensive line', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    // team 1 defends +x goal (attackDir[1] = -1)
    const marker = sim.state.players.find((p) => p.team === 1 && p.attrs.pos === 'DF')!;
    const runner = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'FW')!;
    const carrier = sim.state.players.find((p) => p.team === 0 && p.attrs.pos === 'MF')!;
    carrier.pos = { x: 10, y: -10 };
    runner.pos = { x: HALF_LEN - 14, y: 4 }; // well beyond any sensible line
    marker.pos = { x: HALF_LEN - 18, y: 4 };
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };

    const spot = (sim as unknown as { markingSpot: (p: SimPlayer, t: SimPlayer, d: number) => { x: number; y: number } })
      .markingSpot(marker, runner, 1);
    // goal-side of the runner himself, not pinned back at the line
    expect(spot.x).toBeGreaterThan(runner.pos.x + 0.5);
  });

  it('steps the defensive line up toward halfway when the ball is far away', () => {
    const sim = new MatchSim(makeCfg());
    sim.state.phase = 'play';
    const carrier = sim.state.players.find((p) => p.team === 0 && !p.isGK)!;
    carrier.pos = { x: -30, y: 0 }; // deep in team 0's own half
    sim.state.ball.ownerIdx = carrier.idx;
    sim.state.ball.pos = { ...carrier.pos };
    // team 1 defends +x: line progress should be shallow (pushed up), nowhere
    // near the old 16m camp
    const lineX = (sim as unknown as { defensiveLineX: (team: 0 | 1) => number }).defensiveLineX(1);
    expect(lineX).toBeLessThan(8);
  });
});

describe('penalty scoring', () => {
  function firstShootoutAttempt(seed: number): number {
    const sim = new MatchSim(makeCfg({ cupTie: true, seed }));
    (sim as unknown as { beginPenalties: () => void }).beginPenalties();
    for (let i = 0; i < 60 * 8; i++) {
      sim.step(idle);
      const scored = sim.state.penalties?.scores[0][0];
      if (typeof scored === 'number') return scored;
    }
    throw new Error(`shoot-out attempt did not resolve for seed ${seed}`);
  }

  it('shoot-out penalties are tense rather than automatic goals', () => {
    let scored = 0;
    const attempts = 120;
    for (let seed = 1; seed <= attempts; seed++) scored += firstShootoutAttempt(seed);

    expect(scored).toBeGreaterThanOrEqual(88);
    expect(scored).toBeLessThanOrEqual(104);
  });

  it('in-match penalties are scoreable (keeper pre-commits, cannot read the ball)', () => {
    let scored = 0;
    const attempts = 10;
    for (let seed = 1; seed <= attempts; seed++) {
      const sim = new MatchSim(makeCfg({ seed }));
      const dir = sim.state.attackDir[0];
      sim.state.phase = 'penaltyKick';
      sim.state.restartTeam = 0;
      sim.state.restartPos = { x: dir * (HALF_LEN - PENALTY_SPOT), y: 0 };
      sim.state.restartTimer = 0.2;
      sim.state.ball.pos = { ...sim.state.restartPos };
      const before = sim.state.score[0];
      for (let i = 0; i < 60 * 6; i++) {
        sim.step([{ ...NULL_INPUT }, { ...NULL_INPUT }]);
        if (sim.state.score[0] > before) break;
        // saved/cleared and back in open play long enough = not scored
        const ph: string = sim.state.phase;
        if (ph === 'goalKick' || ph === 'corner' || ph === 'throwIn') break;
      }
      if (sim.state.score[0] > before) scored++;
    }
    // keeper guesses a corner: a healthy majority should go in
    expect(scored).toBeGreaterThanOrEqual(4);
  });
});
