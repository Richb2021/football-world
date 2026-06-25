import Peer, { type DataConnection } from 'peerjs';
import type { FormationId, GoalLogEntry, Lineup, MatchState, PadInput, SimEvent, TeamData, TeamTactics } from '../sim/types';

/** A custom squad (Stars club) carried over the wire so the opponent can build
 *  the match without a TEAMS index. TeamData/Lineup are plain JSON. */
export interface SerializedTeam {
  data: TeamData;
  lineup: Lineup;
  playerForm?: Record<number, number>;
}

/**
 * Host-authoritative online play over WebRTC (PeerJS public broker).
 * Host runs the sim; guest streams inputs up and renders snapshots.
 */

export interface NetConfig {
  leagueId?: string;
  teamA: number; // index into TEAMS (-1 when customA is a Stars club)
  teamB: number;
  lineups: [Lineup, Lineup];
  /** a custom Stars squad for side A/B instead of a national team */
  customA?: SerializedTeam;
  customB?: SerializedTeam;
  seed: number;
  halfLengthSec: number;
  difficulty: 0 | 1 | 2 | 3;
}

export interface Snapshot {
  k: 'snap';
  tick: number;
  phase: MatchState['phase'];
  half: number;
  clock: number;
  score: [number, number];
  winner: -1 | 0 | 1;
  ex: number;
  ball: [number, number, number]; // x, y, z
  restart: [number, number, number, 0 | 1]; // x, y, timer, team
  attack: [number, number];
  owner: number;
  /** keeper holding the caught ball in hand */
  held?: boolean;
  players: [number, number, number, number, number, number][]; // x, y, facing, animCode, sentOff, downTimer
  ctl: [number, number];
  rt: 0 | 1;
  subs: [number, number];
  goals: GoalLogEntry[];
  penAim: number;
  pens: { st: [number[], number[]]; t: 0 | 1; aim: number } | null;
  ev: SimEvent[];
}

export type NetMsg =
  | { k: 'cfg'; cfg: NetConfig }
  | { k: 'ready'; teamIdx: number; lineup: Lineup; custom?: SerializedTeam }
  | { k: 'start'; cfg: NetConfig }
  | Snapshot
  | { k: 'inp'; i: PadInput }
  | { k: 'sub'; team: 0 | 1; offPlayerIdx: number; onSquadIdx: number; offName: string; onName: string }
  | { k: 'swap'; team: 0 | 1; playerIdxA: number; playerIdxB: number }
  | { k: 'formation'; team: 0 | 1; formation: FormationId }
  | { k: 'tactics'; team: 0 | 1; tactics: TeamTactics }
  | { k: 'pause'; paused: boolean }
  | { k: 'pauseReq' }
  | { k: 'resume' }
  | { k: 'kickReady' }
  | { k: 'bye' };

const ANIMS = ['idle', 'run', 'sprint', 'slide', 'celebrate', 'throw', 'dive', 'header', 'kick', 'smother', 'gkthrow', 'tackle', 'fall'] as const;
const PREFIX = 'sl93-room-';

export function encodeSnapshot(state: MatchState, events: SimEvent[]): Snapshot {
  return {
    k: 'snap',
    tick: state.tick,
    phase: state.phase,
    half: state.half,
    clock: state.clock,
    score: [state.score[0], state.score[1]],
    winner: state.winner,
    ex: state.excitement,
    ball: [round2(state.ball.pos.x), round2(state.ball.pos.y), round2(state.ball.z)],
    restart: [round2(state.restartPos.x), round2(state.restartPos.y), round2(state.restartTimer), state.restartTeam],
    attack: [state.attackDir[0], state.attackDir[1]],
    owner: state.ball.ownerIdx,
    held: state.ball.held || undefined,
    players: state.players.map((p) => [
      round2(p.pos.x), round2(p.pos.y), Math.round(p.facing * 100) / 100, ANIMS.indexOf(p.anim), p.sentOff ? 1 : 0,
      round2(p.downTimer ?? 0),
    ]),
    ctl: [state.controlledIdx[0], state.controlledIdx[1]],
    rt: state.restartTeam,
    subs: [state.substitutionsUsed[0], state.substitutionsUsed[1]],
    goals: state.goals.slice(-8),
    penAim: round2(state.penaltyAim),
    pens: state.penalties ? { st: state.penalties.scores, t: state.penalties.shooterTeam, aim: round2(state.penalties.aim) } : null,
    ev: events,
  };
}

/** Build a renderable MatchState-shaped object from a snapshot (guest side). */
export function snapshotToRenderState(s: Snapshot, prev: Snapshot | null, alpha: number, template: MatchState): MatchState {
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const from = prev ?? s;
  template.phase = s.phase;
  template.half = s.half as MatchState['half'];
  template.clock = s.clock;
  template.score = s.score;
  template.winner = s.winner ?? -1;
  template.excitement = s.ex;
  if (s.restart) {
    template.restartPos.x = s.restart[0];
    template.restartPos.y = s.restart[1];
    template.restartTimer = s.restart[2];
    template.restartTeam = s.restart[3];
  }
  if (s.attack) template.attackDir = [s.attack[0], s.attack[1]];
  template.substitutionsUsed = s.subs;
  template.goals = s.goals;
  template.penaltyAim = s.penAim;
  template.restartTeam = s.rt;
  template.ball.ownerIdx = s.owner;
  template.ball.held = s.held === true;
  template.ball.pos.x = lerp(from.ball[0], s.ball[0]);
  template.ball.pos.y = lerp(from.ball[1], s.ball[1]);
  template.ball.z = lerp(from.ball[2], s.ball[2]);
  for (let i = 0; i < template.players.length; i++) {
    const p = template.players[i];
    const a = from.players[i] ?? s.players[i];
    const b = s.players[i];
    p.pos.x = lerp(a[0], b[0]);
    p.pos.y = lerp(a[1], b[1]);
    p.facing = b[2];
    p.anim = ANIMS[b[3]] ?? 'idle';
    p.sentOff = !!b[4];
    p.downTimer = b[5] ?? 0;
    p.control = i === s.ctl[0] || i === s.ctl[1];
    // approximate velocity for renderer animation speed
    p.vel.x = (b[0] - a[0]) * 20;
    p.vel.y = (b[1] - a[1]) * 20;
  }
  if (s.pens && template.penalties) {
    template.penalties.scores = s.pens.st;
    template.penalties.shooterTeam = s.pens.t;
    template.penalties.aim = s.pens.aim;
  } else if (s.pens) {
    template.penalties = {
      shooterTeam: s.pens.t, round: 0, scores: s.pens.st, stage: 'aim', timer: 0, aim: s.pens.aim, dive: 0, winner: -1,
    };
  }
  return template;
}

export class NetSession {
  peer: Peer;
  conn: DataConnection | null = null;
  isHost: boolean;
  code: string;
  onMessage: ((m: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  private closed = false;

  private constructor(peer: Peer, isHost: boolean, code: string) {
    this.peer = peer;
    this.isHost = isHost;
    this.code = code;
  }

  static host(onOpen: (code: string) => void, onPeerJoin: () => void): Promise<NetSession> {
    const code = makeCode();
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code);
      const session = new NetSession(peer, true, code);
      peer.on('open', () => {
        onOpen(code);
        resolve(session);
      });
      peer.on('error', (e) => reject(e));
      peer.on('connection', (conn) => {
        if (session.conn) { conn.close(); return; } // one guest only
        session.attach(conn);
        conn.on('open', () => onPeerJoin());
      });
    });
  }

  static join(code: string): Promise<NetSession> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: false });
        const session = new NetSession(peer, false, code);
        const timeout = setTimeout(() => reject(new Error('Could not reach host — check the code')), 12000);
        conn.on('open', () => {
          clearTimeout(timeout);
          session.attach(conn);
          resolve(session);
        });
        conn.on('error', (e) => { clearTimeout(timeout); reject(e); });
      });
      peer.on('error', (e) => reject(e));
    });
  }

  private attach(conn: DataConnection) {
    this.conn = conn;
    conn.on('data', (d) => this.onMessage?.(d as NetMsg));
    conn.on('close', () => { if (!this.closed) this.onClose?.(); });
    conn.on('error', () => { if (!this.closed) this.onClose?.(); });
  }

  send(m: NetMsg) {
    try {
      if (this.conn?.open) this.conn.send(m);
    } catch (e) {
      console.warn('net send failed', e);
    }
  }

  close() {
    this.closed = true;
    try { this.send({ k: 'bye' }); } catch {}
    try { this.conn?.close(); } catch {}
    try { this.peer.destroy(); } catch {}
  }
}

function makeCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
