/**
 * Off-ball positioning regressions. These guard four gameplay fixes that were
 * driven by measuring real AI matches:
 *   1. Free-kick takers don't get a scrum of team-mates jammed onto them.
 *   2. At a penalty the box is empty bar the keeper (no defender beside the post).
 *   3. When a team attacks, its back line steps up and holds a compact line
 *      instead of camping on its own box edge while the ball is up the pitch.
 *   4. The block holds its shape (no clustering/bunching) through the churn.
 * All four come from one root cause family: shape that keyed off the INSTANT
 * carrier collapsed every time a pass was in flight. See blockPush in matchSim.
 */
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../matchSim';
import { autoLineup } from '../formations';
import { TEAMS } from '../../data/teams';
import type { MatchConfig, PadInput } from '../types';
import { HALF_LEN, PENALTY_BOX_DEPTH, PENALTY_BOX_HALF_WIDTH } from '../constants';

function cfg(seed: number): MatchConfig {
  const a = TEAMS[12], b = TEAMS[9];
  return {
    teams: [
      { data: a, lineup: { formation: '4-4-2', starters: autoLineup(a.players, '4-4-2') }, kit: a.colors.home, controller: 'ai' },
      { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 90,
    difficulty: 1,
    cupTie: false,
    seed,
  };
}

const speed = (p: { vel: { x: number; y: number } }) => Math.hypot(p.vel.x, p.vel.y);

describe('off-ball positioning', () => {
  it('holds a compact attacking line, clears the penalty box, and never crowds a restart taker', () => {
    let fkSettled = 0, fkCrowd = 0; // team-mate within 2.2m of a settled FK taker
    let penDefInBoxMax = 0; // defenders inside the box at a settled penalty
    let penGkOffLineMax = 0, penSettledSeen = 0; // defending keeper's distance off his goal line at a settled penalty
    let atkFrames = 0, defProgSum = 0, deepDefFrames = 0; // back-line depth when attacking
    let playTicks = 0, clusterPairSum = 0;

    // Phase B's behaviour overhaul (onside-holding forwards, defender de-bunch,
    // wide wingers) shifted match dynamics so the rare penalty incident no longer
    // fires within seeds 1..20 — penSettledSeen went to 0 (a coverage gap, NOT a
    // quality regression: when a penalty IS sampled the keeper still holds his line
    // at ~0.9m, well inside the <3m bar). Widen the battery to 1..40 to sample the
    // scenario again (penalties land on seeds 24 & 35). The quality assertions below
    // are unchanged.
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new MatchSim(cfg(seed));
      const inp: PadInput = { moveX: 0, moveY: 0, pass: false, shoot: false, sprint: false, switchPlayer: false };
      let guard = 0;
      while (sim.state.phase !== 'finished' && guard++ < 90 * 60 * 2) {
        sim.step([{ ...inp }, { ...inp }]);
        const st = sim.state;
        const ball = st.ball;
        const players = st.players;

        // restart taker is the kicking-side outfielder nearest the spot. A player
        // still down from the foul lies near the spot but can't take it and isn't
        // mobbing anyone — exclude him so he's not mistaken for the taker or a crowder.
        const restAtk = players.filter((p) =>
          p.team === st.restartTeam && !p.isGK && !p.sentOff && !(p.downTimer && p.downTimer > 0));
        let taker = restAtk[0]; let best = Infinity;
        for (const p of restAtk) {
          const d = Math.hypot(p.pos.x - st.restartPos.x, p.pos.y - st.restartPos.y);
          if (d < best) { best = d; taker = p; }
        }
        const takerSettled = taker
          && Math.hypot(taker.pos.x - st.restartPos.x, taker.pos.y - st.restartPos.y) < 2.5
          && speed(taker) < 0.8;

        if (st.phase === 'freeKick' && takerSettled) {
          fkSettled++;
          for (const p of restAtk) {
            if (p === taker) continue;
            if (Math.hypot(p.pos.x - taker.pos.x, p.pos.y - taker.pos.y) < 2.2) { fkCrowd++; break; }
          }
        }

        if (st.phase === 'penaltyKick' && takerSettled) {
          const defTeam = (1 - st.restartTeam) as 0 | 1;
          const goalLineX = st.attackDir[st.restartTeam] * HALF_LEN;
          let defInBox = 0;
          for (const p of players) {
            if (p.isGK || p.sentOff || p === taker) continue;
            if (p.team !== defTeam) continue;
            if (Math.abs(p.pos.x - goalLineX) < PENALTY_BOX_DEPTH && Math.abs(p.pos.y) < PENALTY_BOX_HALF_WIDTH) defInBox++;
          }
          if (defInBox > penDefInBoxMax) penDefInBoxMax = defInBox;
          // the defending keeper must hold his line, not rush out at the ball on the spot
          const gk = players.find((p) => p.team === defTeam && p.isGK && !p.sentOff);
          if (gk) {
            penSettledSeen++;
            const offLine = Math.abs(gk.pos.x - goalLineX);
            if (offLine > penGkOffLineMax) penGkOffLineMax = offLine;
          }
        }

        if (st.phase === 'play') {
          playTicks++;
          for (let i = 0; i < players.length; i++) {
            const a = players[i]; if (a.sentOff) continue;
            for (let j = i + 1; j < players.length; j++) {
              const b = players[j]; if (b.sentOff || b.team !== a.team) continue;
              if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 1.5) clusterPairSum++;
            }
          }
          if (ball.ownerIdx >= 0) {
            const owner = players[ball.ownerIdx];
            if (owner && !owner.isGK) {
              const dir = st.attackDir[owner.team];
              if (ball.pos.x * dir > 12) { // ball well into the attacking half
                const dfs = players.filter((p) => p.team === owner.team && p.attrs.pos === 'DF' && !p.sentOff);
                if (dfs.length) {
                  atkFrames++;
                  const progs = dfs.map((p) => p.pos.x * dir);
                  defProgSum += progs.reduce((s, v) => s + v, 0) / progs.length;
                  if (progs.filter((v) => v < -10).length >= 2) deepDefFrames++;
                }
              }
            }
          }
        }
      }
    }

    const fkCrowdFrac = fkCrowd / Math.max(1, fkSettled);
    const avgDefProg = defProgSum / Math.max(1, atkFrames);
    const deepDefFrac = deepDefFrames / Math.max(1, atkFrames);
    const clusterPairs = clusterPairSum / Math.max(1, playTicks);

    // 1. taker is not mobbed by team-mates (was ~5% with sustained jams; now ~0)
    expect(fkCrowdFrac).toBeLessThan(0.04);
    // 2. nobody is left standing in the box at a penalty bar the keeper (was up to 6)
    expect(penDefInBoxMax).toBeLessThanOrEqual(1);
    // 2b. the defending keeper holds his goal line at a penalty — he must NOT rush out
    //     and stand in front of the ball (the taker on the spot was tripping the keeper's
    //     central-threat rush-out, marching him ~11m off his line). On the line he sits
    //     ~0.9m in front of the goal frame; allow a small cushion.
    expect(penSettledSeen).toBeGreaterThan(0);
    expect(penGkOffLineMax).toBeLessThan(3);
    // 3. when attacking, the back line steps up out of its own half. It averaged
    //    ~ -19m (deep in its own half, near the box edge) before the fix and ~ -6m
    //    after — roughly the halfway line. Guard a clear step-up with margin for
    //    the noise of 10 AI matches, plus a cap on "two defenders camped deep".
    expect(avgDefProg).toBeGreaterThan(-12);
    expect(deepDefFrac).toBeLessThan(0.7);
    // 4. the block stays spread — no bunching
    expect(clusterPairs).toBeLessThan(1.0);
  }, 300000);

  it('keeps a winger wide to show for the pass when his flank is not being driven', () => {
    const inp: PadInput = { moveX: 0, moveY: 0, pass: false, shoot: false, sprint: false, switchPlayer: false };
    // hold the carrier central+advanced (full-back has NOT gone down the wing) and
    // measure the same-side winger's average width once shape has settled. Average
    // a window of frames so the odd forward run doesn't skew a single snapshot.
    const widths: number[] = [];
    let signOk = true;
    for (const [ai, bi, seed] of [[0, 1, 1234], [12, 9, 7], [3, 8, 42]] as const) {
      const a = TEAMS[ai], b = TEAMS[bi];
      const sim = new MatchSim({
        teams: [
          { data: a, lineup: { formation: '4-4-2', starters: autoLineup(a.players, '4-4-2') }, kit: a.colors.home, controller: 'ai' },
          { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
        ],
        halfLengthSec: 60, difficulty: 1, cupTie: false, seed,
      });
      sim.state.phase = 'play';
      const t0 = sim.state.players.filter((p) => p.team === 0);
      const dir = sim.state.attackDir[0];
      const rb = [...t0].filter((p) => p.attrs.pos === 'DF').sort((x, y) => y.slot.y - x.slot.y)[0];
      // the widest attacker on that flank — a winger (now correctly slotted by position,
      // so he may be a coarse FW inside-forward, not just a coarse MF wide-mid).
      const rm = [...t0].filter((p) => !p.isGK && (p.attrs.pos === 'MF' || p.attrs.pos === 'FW')).sort((x, y) => y.slot.y - x.slot.y)[0];
      const sumStart = 100;
      for (let i = 0; i < sumStart + 60; i++) {
        rb.pos = { x: dir * 20, y: 4 }; // pinned central, in the attacking half
        sim.state.ball.ownerIdx = rb.idx;
        sim.state.ball.held = false;
        sim.state.ball.pos = { x: rb.pos.x, y: rb.pos.y };
        sim.state.ball.vel = { x: 0, y: 0 };
        sim.state.ball.z = 0;
        sim.step([{ ...inp }, { ...inp }]);
        if (i >= sumStart) {
          widths.push(rm.pos.y * Math.sign(rm.slot.y)); // signed onto his own side
          if (Math.sign(rm.pos.y) !== Math.sign(rm.slot.y)) signOk = false;
        }
      }
    }
    const avgWidth = widths.reduce((s, v) => s + v, 0) / widths.length;
    // the wide attacker holds the flank channel (~16m) rather than tucking into the
    // half-space as a spectator (a central mid sits ~5m). Inside-forwards correctly
    // sit a touch narrower than an old-school touchline winger, hence ~16 not ~20.
    expect(signOk).toBe(true);
    expect(avgWidth).toBeGreaterThan(13);
  });
});
