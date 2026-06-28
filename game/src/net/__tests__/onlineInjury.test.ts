import { describe, it, expect } from 'vitest';
import {
  snapshotToRenderState,
  updateGuestInjuredSet,
  type GuestInjuredSet,
  type Snapshot,
} from '../online';
import type { MatchState, SimEvent } from '../../sim/types';

// ---------------------------------------------------------------------------
// The guest never receives `injuredOff` in the snapshot tuple — it's host-only
// sim state. The guest reconstructs it for RENDER from the 'injury' / 'sub' event
// stream, accumulated in a caller-owned set that snapshotToRenderState stamps back
// onto the rebuilt players. These tests drive that reconstruction directly with a
// minimal render template (snapshotToRenderState touches only a known subset of
// MatchState fields, so a hand-built stub stands in for a full sim state).
// ---------------------------------------------------------------------------

function makeTemplate(playerCount: number): MatchState {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    idx: i,
    team: i < playerCount / 2 ? 0 : 1,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: 0,
    anim: 'idle',
    sentOff: false,
    control: false,
    downTimer: 0,
    injuredOff: false,
  }));
  return {
    players,
    ball: { pos: { x: 0, y: 0 }, z: 0, ownerIdx: -1, held: false },
    restartPos: { x: 0, y: 0 },
    restartTimer: 0,
    restartTeam: 0,
    attackDir: [1, -1],
    substitutionsUsed: [0, 0],
    goals: [],
    penaltyAim: 0,
    penalties: null,
    score: [0, 0],
  } as unknown as MatchState;
}

function makeSnapshot(playerCount: number, ev: SimEvent[]): Snapshot {
  return {
    k: 'snap',
    tick: 0,
    phase: 'play',
    half: 1,
    clock: 0,
    score: [0, 0],
    winner: -1,
    ex: 0,
    ball: [0, 0, 0],
    restart: [0, 0, 0, 0],
    attack: [1, -1],
    owner: -1,
    players: Array.from({ length: playerCount }, () => [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number]),
    ctl: [-1, -1],
    rt: 0,
    subs: [0, 0],
    goals: [],
    penAim: 0,
    pens: null,
    ev,
  };
}

describe('guest-side injury reconstruction', () => {
  it('lights the marker for the named player after an injury event and clears it on the sub', () => {
    const injured: GuestInjuredSet = new Set();
    const template = makeTemplate(4); // 2 v 2: idx 0,1 team 0; idx 2,3 team 1

    // injury to team 1 — 'injury' event carries the on-pitch slot index (2)
    const injuryEv: SimEvent[] = [{ type: 'injury', team: 1, player: 2 }];
    updateGuestInjuredSet(injured, injuryEv);
    let state = snapshotToRenderState(makeSnapshot(4, injuryEv), null, 1, template, injured);
    expect(state.players[2].injuredOff).toBe(true);
    // nobody else lit
    expect(state.players[0].injuredOff).toBe(false);
    expect(state.players[1].injuredOff).toBe(false);
    expect(state.players[3].injuredOff).toBe(false);

    // a frame with no events keeps the marker latched (persistent)
    state = snapshotToRenderState(makeSnapshot(4, []), null, 1, template, injured);
    expect(state.players[2].injuredOff).toBe(true);

    // the 'sub' event carries DIFFERENT index spaces:
    //   player (squad idx) = 17  ← the off-going player's 23-man squad index
    //   offPlayerIdx (on-pitch slot) = 2  ← same index space as 'injury'.player
    //   onSquadIdx = 11  ← the incoming sub's squad index
    // The old code keyed the delete on e.player (17) — a tautology-masked bug that
    // never matched the injuryKey(1, 2) and left the marker latched. The fix uses
    // e.offPlayerIdx (2) so ADD and DELETE are in the same index space.
    const subEv: SimEvent[] = [{ type: 'sub', team: 1, player: 17, onSquadIdx: 11, offPlayerIdx: 2 }];
    updateGuestInjuredSet(injured, subEv);
    state = snapshotToRenderState(makeSnapshot(4, subEv), null, 1, template, injured);
    expect(state.players[2].injuredOff).toBe(false);
  });

  it('keys injuries by team so the same idx on the other team is independent', () => {
    const injured: GuestInjuredSet = new Set();
    updateGuestInjuredSet(injured, [{ type: 'injury', team: 0, player: 1 }]);
    const template = makeTemplate(4);
    const state = snapshotToRenderState(makeSnapshot(4, []), null, 1, template, injured);
    // team 0 idx 1 lit; team 1 players untouched
    expect(state.players[1].injuredOff).toBe(true);
    expect(state.players[3].injuredOff).toBe(false);
  });

  it('a fresh match (new set) starts with no marker — no leak across matches', () => {
    // match A: a player gets injured and is left lit in that match's set
    const setA: GuestInjuredSet = new Set();
    updateGuestInjuredSet(setA, [{ type: 'injury', team: 0, player: 0 }]);
    const stateA = snapshotToRenderState(makeSnapshot(4, []), null, 1, makeTemplate(4), setA);
    expect(stateA.players[0].injuredOff).toBe(true);

    // match B constructs a brand-new set (as a fresh MatchRunner does) — clean slate
    const setB: GuestInjuredSet = new Set();
    const stateB = snapshotToRenderState(makeSnapshot(4, []), null, 1, makeTemplate(4), setB);
    for (const p of stateB.players) expect(p.injuredOff).toBe(false);
  });

  it('without a guest set the rebuild leaves injuredOff untouched (host/offline path)', () => {
    const template = makeTemplate(4);
    const state = snapshotToRenderState(makeSnapshot(4, []), null, 1, template);
    for (const p of state.players) expect(p.injuredOff).toBe(false);
  });
});
