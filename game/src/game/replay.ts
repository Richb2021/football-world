import type { MatchState, SimEvent } from '../sim/types';
import { HALF_LEN } from '../sim/constants';

export interface ReplayCameraMode {
  replay: true;
  /** a fixed camera POSITION computed once when the replay starts — the renderer
   * holds it and only pans the look-at to follow the ball, so the replay never
   * jumps position or flips sides */
  pos: { x: number; y: number; z: number };
  fov: number;
}

export interface ReplayRenderFrame {
  state: MatchState;
  camera: ReplayCameraMode;
  done: boolean;
}

interface GoalReplayOpts {
  windowSec?: number;
  durationSec?: number;
  sampleRate?: number;
}

interface ActiveReplay {
  frames: MatchState[];
  elapsed: number;
  duration: number;
  camera: ReplayCameraMode;
}

export class GoalReplayController {
  private buffer: MatchState[] = [];
  private replay: ActiveReplay | null = null;
  private maxFrames: number;
  private durationSec: number;

  constructor(opts: GoalReplayOpts = {}) {
    const windowSec = opts.windowSec ?? 3.1;
    const sampleRate = opts.sampleRate ?? 60;
    this.maxFrames = Math.max(2, Math.round(windowSec * sampleRate));
    this.durationSec = opts.durationSec ?? 2.8;
  }

  get active(): boolean {
    return !!this.replay;
  }

  record(state: MatchState) {
    this.buffer.push(cloneState(state));
    if (this.buffer.length > this.maxFrames) this.buffer.splice(0, this.buffer.length - this.maxFrames);
  }

  startFromGoal(state: MatchState, events: SimEvent[]): boolean {
    const goal = events.find((e) => e.type === 'goal');
    if (!goal) return false;

    const frames = this.buffer.length ? this.buffer.slice() : [cloneState(state)];
    frames.push(cloneState(state));
    const scoringTeam = goal.team ?? 0;
    const attackDir = state.attackDir[scoringTeam] || 1;
    // Lock a single broadcast POSITION for the whole replay: behind & to one side
    // of the goal that was scored in, elevated. Computed ONCE here so the camera
    // never swings sides; the renderer pans this fixed camera to follow the ball.
    const goalX = attackDir * HALF_LEN;
    const side = attackDir > 0 ? -1 : 1;
    this.replay = {
      frames,
      elapsed: 0,
      duration: this.durationSec,
      camera: {
        replay: true,
        pos: { x: goalX + attackDir * 12, y: 10, z: side * 20 },
        fov: 32,
      },
    };
    return true;
  }

  update(dt: number): ReplayRenderFrame | null {
    if (!this.replay) return null;
    const replay = this.replay;
    replay.elapsed += Math.max(0, dt);
    const progress = Math.min(1, replay.elapsed / replay.duration);
    const frameIdx = Math.min(replay.frames.length - 1, Math.floor(progress * replay.frames.length));
    const done = replay.elapsed >= replay.duration;
    const frame = replay.frames[frameIdx] ?? replay.frames[replay.frames.length - 1];
    if (done) this.replay = null;
    return { state: frame, camera: replay.camera, done };
  }

  clear() {
    this.replay = null;
    this.buffer = [];
  }
}

function cloneState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}
