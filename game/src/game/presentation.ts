import { HALF_LEN, HALF_WID } from '../sim/constants';
import type { MatchConfig, MatchState, SimPhase, SimPlayer } from '../sim/types';

export type ExitPresentationKind = 'halfTime' | 'fullTime' | 'extraTimeBreak' | 'penalties';

export interface SubstitutionPresentationChange {
  playerIdx: number;
  outgoing?: SimPlayer;
}

export function buildMatchdayGraphicText(cfg: MatchConfig): string {
  return `${cfg.teams[0].data.name} VS ${cfg.teams[1].data.name}`;
}

// Both teams file out of the halfway-line tunnel in two columns (one per team),
// staying hidden inside the dark tunnel mouth until it is their turn to emerge.
export function buildWalkoutPresentationState(state: MatchState, progress: number): MatchState {
  const MOUTH_Y = -HALF_WID - 4;   // the tunnel exit onto the grass
  const DEEP_Y = -HALF_WID - 13;   // deep inside the dark tunnel (occluded)
  return cloneWithPlayers(state, (p, idx) => {
    const lane = idx % 11;                       // 0 = front of the line, out first
    const col = p.team === 0 ? -1.9 : 1.9;       // two side-by-side columns
    const ONTO_PITCH_Y = -HALF_WID + 6;          // walk straight forward to here first
    const FORWARD = 0.5;                          // fraction spent walking out before fanning
    const emergeStart = lane * 0.05;             // each man follows the one ahead
    const e = clamp01((progress - emergeStart) / 0.5);
    let pos: { x: number; y: number };
    let target: { x: number; y: number };
    if (progress < emergeStart) {
      // queued single-file in the dark tunnel, edging up toward the mouth
      const q = clamp01(progress / Math.max(0.0001, emergeStart));
      pos = { x: col, y: DEEP_Y + (MOUTH_Y - 1 - DEEP_Y) * q };
      target = { x: col, y: MOUTH_Y };
    } else if (e < FORWARD) {
      // out of the mouth, walking STRAIGHT FORWARD onto the pitch (column held)
      const e1 = smooth(e / FORWARD);
      pos = { x: col, y: lerp(MOUTH_Y, ONTO_PITCH_Y, e1) };
      target = { x: col, y: ONTO_PITCH_Y + 1 };
    } else {
      // reached the pitch — now break left/right to the kickoff position
      const e2 = smooth((e - FORWARD) / (1 - FORWARD));
      pos = { x: lerp(col, p.pos.x, e2), y: lerp(ONTO_PITCH_Y, p.pos.y, e2) };
      target = p.pos;
    }
    const dx = target.x - pos.x, dy = target.y - pos.y;
    const moving = Math.hypot(dx, dy) > 0.02;
    return {
      ...p,
      pos,
      vel: { x: dx * 4, y: dy * 4 },
      facing: moving ? Math.atan2(dy, dx) : Math.PI / 2,
      anim: 'run',
    };
  });
}

export function buildExitPresentationState(state: MatchState, progress: number, kind: ExitPresentationKind): MatchState {
  const t = smooth(clamp01(progress));
  return cloneWithPlayers(state, (p, idx) => {
    const lane = idx % 11;
    const target = {
      x: -23 + lane * 4.7 + (p.team === 0 ? -1.4 : 1.4),
      y: HALF_WID + 8 + (p.team === 0 ? 0 : 2.2),
    };
    const celebrating = kind === 'fullTime' && state.winner >= 0 && p.team === state.winner;
    return {
      ...p,
      pos: {
        x: lerp(p.pos.x, target.x, t),
        y: lerp(p.pos.y, target.y, t),
      },
      vel: {
        x: (target.x - p.pos.x) * 0.18,
        y: (target.y - p.pos.y) * 0.18,
      },
      facing: Math.atan2(target.y - p.pos.y, target.x - p.pos.x),
      anim: celebrating ? 'celebrate' : 'run',
    };
  }, kind);
}

export function buildSubstitutionPresentationState(
  state: MatchState,
  progress: number,
  playerIdx: number,
  outgoing?: SimPlayer,
): MatchState {
  return buildSubstitutionPresentationSceneState(state, progress, [{ playerIdx, outgoing }]);
}

export function buildSubstitutionPresentationSceneState(
  state: MatchState,
  progress: number,
  changes: SubstitutionPresentationChange[],
): MatchState {
  const visibleChanges = changes.filter((change) => !!state.players[change.playerIdx]);
  if (visibleChanges.length === 0) return state;
  const t = clamp01(progress);
  const changeByPlayer = new Map(visibleChanges.map((change, order) => [change.playerIdx, { ...change, order }]));
  const changedPlayers = new Set(visibleChanges.map((change) => change.playerIdx));
  const borrowedByPlayer = new Map<number, SubstitutionPresentationChange & { order: number }>();
  const usedBorrowed = new Set<number>();
  for (const [playerIdx, change] of changeByPlayer) {
    if (!change.outgoing) continue;
    const incoming = state.players[playerIdx];
    const borrowed = state.players.find((p) => (
      p.team === incoming.team
      && !p.isGK
      && !p.sentOff
      && !changedPlayers.has(p.idx)
      && !usedBorrowed.has(p.idx)
    )) ?? state.players.find((p) => (
      !p.sentOff
      && !changedPlayers.has(p.idx)
      && !usedBorrowed.has(p.idx)
    ));
    if (!borrowed) continue;
    usedBorrowed.add(borrowed.idx);
    borrowedByPlayer.set(borrowed.idx, change);
  }
  return cloneWithPlayers(state, (p, idx) => {
    const borrowed = borrowedByPlayer.get(idx);
    if (borrowed?.outgoing) return substitutionOutgoingRunner(p, borrowed.outgoing, t, borrowed.order, visibleChanges.length);
    const change = changeByPlayer.get(idx);
    if (change) return substitutionIncomingRunner(p, t, change.order, visibleChanges.length, !!change.outgoing);
    return hiddenSubstitutionScenePlayer(p, idx);
  });
}

// International-cup drinks break: each team jogs off to a huddle near the near
// touchline, gathers in a circle to take on water / talk, then jogs back onto the
// pitch to their positions. Progress 0..1 drives walk-out -> hold -> walk-back.
export function buildHydrationBreakState(state: MatchState, progress: number): MatchState {
  const t = clamp01(progress);
  const OUT = 0.36;   // walking out to the huddle
  const BACK = 0.72;  // start jogging back after the hold
  return cloneWithPlayers(state, (p, idx) => {
    const lane = idx % 11;
    // two huddles along the near touchline, one per team, well apart
    const center = { x: p.team === 0 ? -17 : 17, y: -HALF_WID + 7 };
    const ang = (lane / 11) * Math.PI * 2;
    const radius = 3.3 + (lane % 2) * 0.7;
    const huddle = { x: center.x + Math.cos(ang) * radius, y: center.y + Math.sin(ang) * radius * 0.66 };
    const home = { x: p.pos.x, y: p.pos.y }; // frozen on-pitch position the break began at
    let pos: { x: number; y: number };
    let target: { x: number; y: number };
    let anim: SimPlayer['anim'] = 'run';
    if (t < OUT) {
      const e = smooth(t / OUT);
      pos = { x: lerp(home.x, huddle.x, e), y: lerp(home.y, huddle.y, e) };
      target = huddle;
    } else if (t < BACK) {
      pos = huddle;
      target = center; // stand facing into the circle
      anim = 'idle';
    } else {
      const e = smooth((t - BACK) / (1 - BACK));
      pos = { x: lerp(huddle.x, home.x, e), y: lerp(huddle.y, home.y, e) };
      target = home;
    }
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const moving = anim === 'run';
    return {
      ...p,
      pos,
      vel: moving ? { x: dx * 3, y: dy * 3 } : { x: 0, y: 0 },
      // during the huddle everyone faces the centre of their circle
      facing: anim === 'idle'
        ? Math.atan2(center.y - pos.y, center.x - pos.x)
        : (Math.hypot(dx, dy) > 0.02 ? Math.atan2(dy, dx) : p.facing),
      control: false,
      anim,
    };
  });
}

function substitutionLaneOffset(order: number, count: number): number {
  return (order - (count - 1) / 2) * 3.2;
}

function hiddenSubstitutionScenePlayer(p: SimPlayer, idx: number): SimPlayer {
  return {
    ...p,
    pos: {
      x: -HALF_LEN - 7 - (idx % 11) * 0.25,
      y: -HALF_WID - 9 - Math.floor(idx / 11),
    },
    vel: { x: 0, y: 0 },
    anim: 'idle',
  };
}

function substitutionOutgoingRunner(slot: SimPlayer, outgoing: SimPlayer, progress: number, order: number, count: number): SimPlayer {
  const handoff = 0.55;
  if (progress >= handoff) return hiddenSubstitutionScenePlayer(slot, slot.idx);
  const offset = substitutionLaneOffset(order, count);
  const x = -1.15 + offset;
  const from = { x, y: -HALF_WID + 6 };
  const to = { x, y: -HALF_WID - 12 };
  const local = smooth(progress / handoff);
  const pos = { x: lerp(from.x, to.x, local), y: lerp(from.y, to.y, local) };
  const dx = to.x - pos.x;
  const dy = to.y - pos.y;
  return {
    ...outgoing,
    idx: slot.idx,
    pos,
    vel: { x: dx * 2.8, y: dy * 2.8 },
    facing: Math.atan2(dy, dx),
    control: false,
    anim: 'run',
  };
}

function substitutionIncomingRunner(incoming: SimPlayer, progress: number, order: number, count: number, waitForOutgoing: boolean): SimPlayer {
  const handoff = waitForOutgoing ? 0.55 : 0;
  const offset = substitutionLaneOffset(order, count);
  const wait = { x: 1.15 + offset, y: -HALF_WID - 4.25 };
  const to = { x: 1.15 + offset, y: -HALF_WID + 6 };
  if (progress < handoff) {
    return {
      ...incoming,
      pos: wait,
      vel: { x: 0, y: 0 },
      facing: Math.PI / 2,
      anim: 'idle',
    };
  }
  const local = smooth((progress - handoff) / Math.max(0.0001, 1 - handoff));
  const pos = { x: lerp(wait.x, to.x, local), y: lerp(wait.y, to.y, local) };
  const dx = to.x - pos.x;
  const dy = to.y - pos.y;
  return {
    ...incoming,
    pos,
    vel: { x: dx * 2.8, y: dy * 2.8 },
    facing: Math.atan2(dy, dx),
    anim: 'run',
  };
}

// The winners gather in a celebration around the trophy spot (near the centre,
// facing the camera); the beaten side trudges off toward the tunnel.
export function buildTrophyCelebrationState(state: MatchState, progress: number): MatchState {
  const t = smooth(clamp01(progress));
  const winner = state.winner;
  return cloneWithPlayers(state, (p, idx) => {
    const lane = idx % 11;
    if (winner >= 0 && p.team === winner) {
      const ang = (lane / 11) * Math.PI * 2;
      const radius = 4.5 + (lane % 3) * 1.7;
      const target = { x: Math.cos(ang) * radius, y: 6 + Math.sin(ang) * radius * 0.6 };
      return {
        ...p,
        pos: { x: lerp(p.pos.x, target.x, t), y: lerp(p.pos.y, target.y, t) },
        vel: { x: 0, y: 0 },
        facing: Math.atan2(6 - target.y, 0 - target.x), // face the trophy in the middle
        anim: 'celebrate',
      };
    }
    const target = { x: -24 + lane * 4.4, y: -HALF_WID - 6 };
    return {
      ...p,
      pos: { x: lerp(p.pos.x, target.x, t), y: lerp(p.pos.y, target.y, t) },
      vel: { x: (target.x - p.pos.x) * 0.16, y: (target.y - p.pos.y) * 0.16 },
      facing: Math.atan2(target.y - p.pos.y, target.x - p.pos.x),
      anim: 'run',
    };
  }, 'fullTime');
}

function cloneWithPlayers(
  state: MatchState,
  mapPlayer: (player: SimPlayer, idx: number) => SimPlayer,
  phase: SimPhase = state.phase,
): MatchState {
  return {
    ...state,
    phase,
    ball: { ...state.ball, pos: { ...state.ball.pos }, vel: { ...state.ball.vel }, kickDir: { ...state.ball.kickDir } },
    restartPos: { ...state.restartPos },
    score: [state.score[0], state.score[1]],
    attackDir: [state.attackDir[0], state.attackDir[1]],
    controlledIdx: [state.controlledIdx[0], state.controlledIdx[1]],
    substitutionsUsed: [state.substitutionsUsed[0], state.substitutionsUsed[1]],
    goals: state.goals.map((goal) => ({ ...goal })),
    players: state.players.map((p, idx) => mapPlayer({
      ...p,
      slot: { ...p.slot },
      pos: { ...p.pos },
      vel: { ...p.vel },
    }, idx)),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
