/** Diagnostic harness: hunt phantom goals/saves with random mashed inputs. */
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../matchSim';
import { autoLineup } from '../formations';
import { TEAMS } from '../../data/teams';
import type { MatchConfig, PadInput } from '../types';
import { Rng } from '../rng';

function cfg(seed: number): MatchConfig {
  const a = TEAMS[12], b = TEAMS[9];
  return {
    teams: [
      { data: a, lineup: { formation: '4-4-2', starters: autoLineup(a.players, '4-4-2') }, kit: a.colors.home, controller: 'human' },
      { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 60,
    difficulty: 1,
    cupTie: false,
    seed,
  };
}

describe('phantom event hunt', () => {
  it('scans matches with random inputs', async () => {
    let goals = 0, saves = 0, phantoms = 0, jumps = 0, saveGoalChains = 0;
    for (let seed = 1; seed <= 30; seed++) {
      // Yield to the event loop between seeds so this long synchronous scan does
      // not block the worker from answering vitest's task-update RPC under load.
      await new Promise((r) => setTimeout(r, 0));
      const sim = new MatchSim(cfg(seed));
      const rng = new Rng(seed * 7717);
      const inp: PadInput = { moveX: 0, moveY: 0, pass: false, shoot: false, sprint: false, switchPlayer: false };
      const ring: { x: number; y: number; phase: string }[] = [];
      let lastSaveTick = -9999;
      let guard = 0;
      while (sim.state.phase !== 'finished' && guard++ < 60 * 200) {
        // mash
        if (rng.next() < 0.05) { inp.moveX = Math.round(rng.range(-1, 1)); inp.moveY = Math.round(rng.range(-1, 1)); }
        if (rng.next() < 0.04) inp.pass = !inp.pass;
        if (rng.next() < 0.03) inp.shoot = !inp.shoot;
        if (rng.next() < 0.02) inp.sprint = !inp.sprint;
        sim.step([{ ...inp }, { moveX: 0, moveY: 0, pass: false, shoot: false, sprint: false, switchPlayer: false }]);
        const b = sim.state.ball;
        ring.push({ x: Math.round(b.pos.x * 10) / 10, y: Math.round(b.pos.y * 10) / 10, phase: sim.state.phase });
        if (ring.length > 30) ring.shift();
        if (ring.length >= 2) {
          const p = ring[ring.length - 2], c = ring[ring.length - 1];
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d > 3 && p.phase === 'play' && c.phase === 'play') {
            jumps++;
            if (jumps <= 5) console.log(`JUMP seed=${seed} t=${sim.state.tick} ${JSON.stringify(ring.slice(-4))}`);
          }
        }
        for (const e of sim.events) {
          if (e.type === 'save') { saves++; lastSaveTick = sim.state.tick; }
          if (e.type === 'goal') {
            goals++;
            const bx = sim.state.ball.pos.x, by = sim.state.ball.pos.y;
            if (Math.abs(bx) < 52.4 || Math.abs(by) > 4.2) {
              phantoms++;
              console.log(`PHANTOM GOAL seed=${seed} tick=${sim.state.tick} ball=(${bx.toFixed(1)},${by.toFixed(1)}) trail=${JSON.stringify(ring.slice(-8))}`);
            }
            if (sim.state.tick - lastSaveTick < 90) {
              saveGoalChains++;
              if (saveGoalChains <= 6) console.log(`SAVE->GOAL seed=${seed} dt=${sim.state.tick - lastSaveTick} ball=(${bx.toFixed(1)},${by.toFixed(1)}) trail=${JSON.stringify(ring.slice(-10))}`);
            }
          }
        }
      }
    }
    console.log(`SUMMARY goals=${goals} saves=${saves} phantoms=${phantoms} jumps=${jumps} saveGoalChains=${saveGoalChains}`);
    expect(phantoms).toBe(0); // goals must register at the goal mouth
    expect(jumps).toBe(0); // the ball must never teleport in open play
    expect(goals).toBeGreaterThan(30); // sanity: matches still produce goals
    // Active diving keepers and contact saves create legitimate rebound chances;
    // an avalanche relative to either goals or saves still means regression.
    expect(saveGoalChains).toBeLessThan(Math.max(10, goals * 0.16, saves * 0.16));
  }, 180000); // ~95-120s alone; can exceed 120s under full-suite CPU contention
});
