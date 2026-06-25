import { AudioEngine } from '../engine/audio';
import { CommentaryEngine } from '../engine/commentary';
import type { GameAssets } from '../engine/assets';
import { InputManager } from '../engine/input';
import { MatchRenderer, type RenderCameraMode } from '../engine/matchRenderer';
import { FORMATION_IDS, normalizeTactics, overallRating } from '../sim/formations';
import { DT, GOAL_HALF_WIDTH, HALF_LEN, HALF_WID, PENALTY_SPOT } from '../sim/constants';
import { MatchSim } from '../sim/matchSim';
import { isBreakPhase } from '../sim/phase';
import {
  ONLINE_PAUSE_MS, pauseResumeDue, pauseSecondsLeft, type OnlinePauseState,
} from './onlinePause';
import type { KitColors, MatchConfig, MatchState, PadInput, PlayerAttrs, SimEvent, SimPlayer, TeamTactics } from '../sim/types';
import { NULL_INPUT } from '../sim/types';
import { Hud } from '../ui/hud';
import { GoalReplayController } from './replay';
import type { PitchBoardCreative } from '../engine/stadium';
import {
  buildExitPresentationState,
  buildSubstitutionPresentationSceneState,
  buildHydrationBreakState,
  buildTrophyCelebrationState,
  buildMatchdayGraphicText,
  buildWalkoutPresentationState,
  type ExitPresentationKind,
} from './presentation';
import type { SubstitutionMenuOpts, PauseMenuView, PauseStatusView } from '../ui/screens';
import {
  encodeSnapshot, snapshotToRenderState, type Snapshot,
} from '../net/online';
import type { NetTransport } from '../net/transport';
import type { AdOpportunity } from './ads';

export interface MatchOutcome {
  score: [number, number];
  winner: -1 | 0 | 1;
  momentum?: [number, number];
  /** set when the match ended by forfeit, for the result-screen note */
  reason?: string;
  /** the goal log, so career modes can credit a Be-A-Pro avatar for goals they
   *  actually scored (player = scorer name; ownGoal flags own goals; assist = the
   *  team-mate who set it up). */
  scorers?: { team: 0 | 1; player: string; minute: number; ownGoal?: boolean; assist?: string }[];
}

interface RunnerOpts {
  cfg: MatchConfig;
  kits: [KitColors, KitColors];
  assets: GameAssets;
  input: InputManager;
  audio: AudioEngine;
  hud: Hud;
  canvas: HTMLCanvasElement;
  net?: { session: NetTransport; role: 'host' | 'guest' };
  adBoardCreatives?: PitchBoardCreative[];
  localTeam: 0 | 1;
  skipIntro?: boolean;
  onEnd: (outcome: MatchOutcome) => void;
  onAbort: () => void;
  onPauseMenu: (view: PauseMenuView) => void;
  /** live update of the online-pause countdown + ready state (null = hide) */
  onPauseStatus?: (status: PauseStatusView | null) => void;
  onSubstitutionMenu: (opts: SubstitutionMenuOpts) => void;
  onAdOpportunity?: (opportunity: AdOpportunity) => void;
  hidePauseMenu: () => void;
}

interface PendingSubstitution {
  team: 0 | 1;
  offPlayerIdx: number;
  onSquadIdx: number;
  offName: string;
  onName: string;
  outgoing: SimPlayer;
}

interface SubstitutionPresentationChange {
  playerIdx: number;
  outgoing: SimPlayer;
}

export function shouldSkipMatchPresentation(opts: { skipIntro?: boolean; startTimeSec?: number }): boolean {
  return !!opts.skipIntro || opts.startTimeSec !== undefined;
}

export function presentationFrameDelta(rawDt: number): number {
  return Math.min(1, Math.max(0, rawDt));
}

export function presentationPyroEnabled(cfg: Pick<MatchConfig, 'era'>): boolean {
  return cfg.era?.fireworks ?? true;
}

/**
 * Split a team's squad into the substitution menu's "on the pitch" and "bench"
 * lists. A sent-off player is out of the match entirely: he's dropped from the
 * on-pitch list (so a red card shows ten, not eleven) and is not benchable (he
 * can't return). A player already subbed off is likewise gone for good.
 */
export function buildSubstitutionRoster(
  players: SimPlayer[],
  team: 0 | 1,
  lineupStarters: number[],
  squadPlayers: PlayerAttrs[],
  subbedOff: number[],
  subbedOn: number[] = [],
): { starters: SubstitutionMenuOpts['starters']; bench: SubstitutionMenuOpts['bench'] } {
  const order = new Map(lineupStarters.map((squadIdx, slotIdx) => [squadIdx, slotIdx]));
  const active = players
    .filter((p) => p.team === team && !p.sentOff)
    .sort((a, b) => (order.get(a.squadIdx) ?? a.idx) - (order.get(b.squadIdx) ?? b.idx));
  const activeSquads = new Set(active.map((p) => p.squadIdx));
  const subbedOnSet = new Set(subbedOn);
  const starters = active.map((p) => ({
    playerIdx: p.idx,
    squadIdx: p.squadIdx,
    pos: p.attrs.pos,
    name: p.attrs.name,
    overall: overallRating(p.attrs),
    energy: p.stamina,
    staminaCeiling: p.staminaCeiling,
    yellowCards: p.yellowCards,
    subbedOn: subbedOnSet.has(p.squadIdx),
  }));
  const subbed = new Set(subbedOff);
  const sentOffSquads = new Set(
    players.filter((p) => p.team === team && p.sentOff).map((p) => p.squadIdx),
  );
  const bench = squadPlayers
    .map((p, squadIdx) => ({ squadIdx, pos: p.pos, name: p.name, overall: overallRating(p), energy: 1, staminaCeiling: 1 }))
    .filter((p) => !activeSquads.has(p.squadIdx) && !subbed.has(p.squadIdx) && !sentOffSquads.has(p.squadIdx));
  return { starters, bench };
}

export function celebrationTeamForConfig(
  cfg: Pick<MatchConfig, 'celebrationTeam' | 'celebrationWin' | 'trophyWin'>,
  winner: -1 | 0 | 1,
): 0 | 1 | null {
  if (winner === 0 || winner === 1) return winner;
  if (cfg.celebrationWin && (cfg.celebrationTeam === 0 || cfg.celebrationTeam === 1)) return cfg.celebrationTeam;
  return null;
}

export function exitPresentationModeForConfig(
  kind: ExitPresentationKind,
  cfg: Pick<MatchConfig, 'celebrationTeam' | 'celebrationWin' | 'trophyWin'>,
  winner: -1 | 0 | 1,
): NonNullable<RenderCameraMode['presentation']> {
  if (kind === 'halfTime') return 'halfTimeExit';
  const celebratingTeam = celebrationTeamForConfig(cfg, winner);
  if (celebratingTeam === null) return 'fullTimeExit';
  if (cfg.trophyWin) return 'trophyLift';
  if (cfg.celebrationWin) return 'winnerCelebration';
  return 'fullTimeExit';
}

/** Owns the live match loop: fixed-step sim (or snapshot playback), render, HUD, audio. */
export class MatchRunner {
  private sim: MatchSim | null = null;
  private renderer: MatchRenderer;
  private opts: RunnerOpts;
  private commentary: CommentaryEngine;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private paused = false;
  private ended = false;
  // the match has played to its natural finish (full-time whistle seen). After
  // this a disconnect is NOT a forfeit — it ends on the real score.
  private reachedFullTime = false;
  private finalScore: [number, number] | null = null;
  // synchronized online kick-off: the host holds the first sim step until the
  // guest's walk-out is done (or a fallback deadline), so both kick off together
  private kickoffArmed = false;
  private guestReadyToKick = false;
  private kickReadySent = false;
  private kickoffDeadline = 0;
  // online synchronized pause (host-authoritative)
  private onlinePausePending = false;
  private onlinePause: OnlinePauseState | null = null;
  private lastPauseSecond = -1;
  private shootHeldAt = -1;
  private remoteInput: PadInput = { ...NULL_INPUT };
  private snapPrev: Snapshot | null = null;
  private snapCur: Snapshot | null = null;
  private snapTime = 0;
  // guest watchdog: if the host's snapshot stream never even begins, the guest
  // would otherwise sit forever on a blank pre-match scene (the WebRTC keepalive
  // only warms the signalling socket, it doesn't detect a stalled data channel).
  private guestNoSnapMs = 0;
  private guestSim: MatchSim | null = null;
  private guestState: MatchState | null = null;
  private goalReplay = new GoalReplayController();
  private readonly walkoutDuration = 6;
  private walkoutTimer = this.walkoutDuration;
  private exitPresentation: { kind: ExitPresentationKind; timer: number; duration: number } | null = null;
  private pendingSubstitutions: PendingSubstitution[] = [];
  private substitutionPresentation: { timer: number; duration: number; changes: SubstitutionPresentationChange[] } | null = null;
  private hydrationBreakPresentation: { timer: number; duration: number } | null = null;
  private aimChargeSince = -1;
  private fullTimeCommentaryStarted = false;

  constructor(opts: RunnerOpts) {
    this.opts = opts;
    // Direct launches from story/prematch and matches joined in progress have
    // already handled the setup, so drop straight into live play.
    const skipPresentation = shouldSkipMatchPresentation({
      skipIntro: opts.skipIntro,
      startTimeSec: opts.cfg.startTimeSec,
    });
    if (skipPresentation) this.walkoutTimer = 0;
    this.renderer = new MatchRenderer(opts.canvas, opts.assets);
    this.commentary = new CommentaryEngine(opts.assets);
    this.renderer.setup(opts.cfg, opts.kits, { adBoardCreatives: opts.adBoardCreatives });
    opts.hud.setTeams(
      opts.cfg.teams[0].data.short,
      opts.cfg.teams[1].data.short,
      opts.kits[0].shirt,
      opts.kits[1].shirt,
    );
    opts.hud.show(true);
    opts.hud.showMatchdayGraphic(
      !skipPresentation,
      buildMatchdayGraphicText(opts.cfg),
      opts.cfg.stadiumName ?? opts.cfg.teams[0].data.stadium,
    );
    opts.input.showTouch(true);

    const isGuest = opts.net?.role === 'guest';
    if (!isGuest) {
      this.sim = new MatchSim(opts.cfg);
    } else {
      // guest renders snapshots into a template state cloned from a local sim construction
      this.guestSim = new MatchSim(opts.cfg);
      this.guestState = this.guestSim.state;
    }

    if (opts.net) {
      opts.net.session.onMessage = (m) => {
        if (m.k === 'inp') this.remoteInput = m.i;
        else if (m.k === 'sub') {
          // mirror the peer's already-validated sub (force past the phase/cap gate)
          const s = this.sim ?? this.guestSim;
          if (s) {
            const outgoing = this.clonePlayer(s.state.players[m.offPlayerIdx]);
            if (s.substitute(m.team, m.offPlayerIdx, m.onSquadIdx, true) && outgoing) {
              this.startSubstitutionPresentation(m.offPlayerIdx, outgoing);
              this.opts.hud.subBanner(this.opts.cfg.teams[m.team]?.data.short ?? '', m.offName, m.onName);
            }
          }
        } else if (m.k === 'swap') {
          const s = this.sim ?? this.guestSim;
          if (s) s.swapPositions(m.team, m.playerIdxA, m.playerIdxB);
        } else if (m.k === 'formation') {
          const s = this.sim ?? this.guestSim;
          if (s) s.changeFormation(m.team, m.formation);
        } else if (m.k === 'tactics') {
          const s = this.sim ?? this.guestSim;
          if (s) s.changeTactics(m.team, m.tactics);
        } else if (m.k === 'pause') {
          this.onRemotePause(m.paused);
        } else if (m.k === 'pauseReq') {
          this.onRemotePauseRequest();
        } else if (m.k === 'resume') {
          this.onRemoteResume();
        } else if (m.k === 'kickReady') {
          this.guestReadyToKick = true;
        }
        else if (m.k === 'snap') {
          this.snapPrev = this.snapCur;
          this.snapCur = m;
          this.snapTime = 0;
          if (m.ev.length) {
            if (this.guestState) {
              const eventState = snapshotToRenderState(m, this.snapPrev, 1, this.guestState);
              this.guestState = eventState;
              this.goalReplay.record(eventState);
              this.goalReplay.startFromGoal(eventState, m.ev);
              const commentaryEvents = this.commentaryEvents(m.ev);
              if (commentaryEvents.length) this.commentary.handleEvents(commentaryEvents, eventState, opts.cfg);
              this.startExitPresentation(m.ev);
            }
            opts.audio.handleEvents(m.ev, { crowdTeam: 0 });
            opts.hud.handleEvents(m.ev);
            if (m.ev.some((e) => e.type === 'goal')) {
              this.renderer.goalShake();
              // the host shows the TV score graphic in its own loop; the guest
              // renders from snapshots, so trigger it here too (the snapshot
              // carries the running goals + score)
              this.opts.hud.showScoreGraphic(m.goals, m.score, 'GOAL', 0);
            }
            if (m.ev.some((e) => e.type === 'fullTime' || e.type === 'matchEnd')) {
              this.reachedFullTime = true;
              this.finalScore = [m.score[0], m.score[1]];
            }
            if (m.ev.some((e) => e.type === 'matchEnd') && !this.exitPresentation) this.finishFromSnapshot(m);
          }
        } else if (m.k === 'bye') {
          this.opponentLeft();
        }
      };
      opts.net.session.onClose = () => this.opponentLeft();
    }

    opts.input.onPause = () => this.togglePause();
    opts.audio.stopMenuMusic();
    opts.audio.startCrowd();
    if (!skipPresentation) this.commentary.startMatch(opts.cfg);
    // the on-pitch control hint is gone — controls are shown on a dedicated
    // pre-match screen instead.
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const rawDt = Math.max(0, (now - this.last) / 1000);
      const dt = Math.min(0.1, rawDt);
      const presentationDt = presentationFrameDelta(rawDt);
      this.last = now;
      if (this.paused) {
        if (this.onlinePause) this.tickOnlinePause(now);
        return;
      }

      if (this.opts.net?.role === 'guest') {
        this.guestFrame(dt, presentationDt);
        return;
      }
      this.hostFrame(dt, presentationDt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private hostFrame(dt: number, presentationDt = dt) {
    const sim = this.sim!;
    if (this.renderWalkoutPresentation(presentationDt, sim.state)) return;
    // synchronized kick-off: our walk-out is done — hold the first sim step until
    // the guest's walk-out finishes too (or a fallback deadline), streaming the
    // frozen kick-off scene meanwhile so both kick off together.
    if (this.opts.net && this.isHostRole && !this.kickoffArmed && this.walkoutTimer <= 0) {
      if (this.kickoffDeadline === 0) this.kickoffDeadline = performance.now() + 7000;
      if (this.guestReadyToKick || performance.now() >= this.kickoffDeadline) {
        this.kickoffArmed = true;
        this.last = performance.now(); // reset the clock so the hold isn't fast-forwarded
        this.acc = 0;
      } else {
        this.opts.net.session.send(encodeSnapshot(sim.state, []));
        this.opts.hud.update(sim.state, this.opts.cfg.halfLengthSec, 0);
        this.renderer.render(sim.state, dt, this.cameraModeForState(sim.state));
        return;
      }
    }
    if (this.renderExitPresentation(presentationDt, sim.state)) return;
    if (this.renderSubstitutionPresentation(presentationDt, sim.state)) return;
    if (this.renderHydrationBreakPresentation(presentationDt, sim.state)) return;

    const replayFrame = this.goalReplay.update(dt);
    if (replayFrame) {
      this.opts.hud.setReplay(true);
      this.opts.hud.update(sim.state, this.opts.cfg.halfLengthSec, 0);
      this.opts.audio.updateCrowd(sim.state.excitement, dt, sim.state.score[0] - sim.state.score[1]);
      this.renderer.render(replayFrame.state, dt, replayFrame.camera);
      if (replayFrame.done) sim.state.restartTimer = Math.min(sim.state.restartTimer, 0.9);
      return;
    }
    this.opts.hud.setReplay(false);

    this.acc += dt;
    // touch buttons read PASS/SHOOT in possession, SWITCH/TACKLE out of it;
    // at restarts (goal kicks, corners, free kicks, throws) the taking team
    // is the one in possession
    const lt = this.opts.localTeam;
    const ballOwner = sim.state.ball.ownerIdx >= 0 ? sim.state.players[sim.state.ball.ownerIdx] : null;
    const attacking = sim.state.phase !== 'play'
      ? sim.state.restartTeam === lt
      : ballOwner ? ballOwner.team === lt : sim.state.ball.lastTouchTeam === lt;
    this.opts.input.setTouchContext(attacking);
    const local = this.remapInputForCamera(this.opts.input.getInput(), sim.state);
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      this.acc -= DT;
      steps++;
      const inputs: [PadInput, PadInput] =
        this.opts.localTeam === 0 ? [local, this.remoteInput] : [this.remoteInput, local];
      sim.step(inputs);
      this.goalReplay.record(sim.state);
      if (sim.events.length) {
        this.goalReplay.startFromGoal(sim.state, sim.events);
        const commentaryEvents = this.commentaryEvents(sim.events);
        if (commentaryEvents.length) this.commentary.handleEvents(commentaryEvents, sim.state, this.opts.cfg);
        this.opts.audio.handleEvents(sim.events, { crowdTeam: 0 });
        this.opts.hud.handleEvents(sim.events);
        if (sim.events.some((e) => e.type === 'goal')) {
          this.renderer.goalShake();
          // TV score graphic with the running score + scorers/times. holdMs <= 0
          // keeps it up (through the replay) until the kick-off is actually taken
          // (phase returns to 'play'), gated each frame in hud.update.
          this.opts.hud.showScoreGraphic(sim.state.goals, sim.state.score, 'GOAL', 0);
        }
        if (sim.events.some((e) => e.type === 'fullTime' || e.type === 'matchEnd')) {
          this.reachedFullTime = true;
          this.finalScore = [sim.state.score[0], sim.state.score[1]];
        }
      }
      // net: broadcast the snapshot BEFORE any exit-presentation break, so the
      // guest always receives the half/full-time/matchEnd events — without this
      // the guest never sees the HT/FT graphics and, missing matchEnd, falls into
      // a false forfeit when the host closes the connection.
      if (this.opts.net && (sim.state.tick % 3 === 0 || sim.events.length)) {
        this.opts.net.session.send(encodeSnapshot(sim.state, sim.events));
      }
      if (sim.events.length && this.startExitPresentation(sim.events)) break;
      if (sim.events.some((e) => e.type === 'hydrationBreak') && this.startHydrationBreak()) break;
      if (sim.state.phase === 'finished' && !this.ended && !this.exitPresentation) {
        this.finish({ score: [sim.state.score[0], sim.state.score[1]], winner: sim.state.winner, momentum: [sim.state.momentum[0], sim.state.momentum[1]], scorers: sim.state.goals });
        return;
      }
    }
    // a queued online pause fires the moment the host reaches a stoppage
    if (this.onlinePausePending) this.maybeActivateOnlinePause();
    // substitutions set while the ball was live are applied at the next stoppage
    if (this.pendingSubstitutions.length) this.commitPendingSubstitutions();
    if (this.renderExitPresentation(presentationDt, sim.state)) return;

    // shot power HUD
    const inputNow = local;
    if (inputNow.shoot && this.shootHeldAt < 0) this.shootHeldAt = performance.now();
    if (!inputNow.shoot) this.shootHeldAt = -1;
    const powerFrac = this.shootHeldAt >= 0 ? Math.min(1, (performance.now() - this.shootHeldAt) / 1000) : 0;

    this.renderer.setAimIndicator(this.computeAimIndicator(sim.state, local));
    this.opts.hud.update(sim.state, this.opts.cfg.halfLengthSec, powerFrac);
    this.opts.audio.updateCrowd(sim.state.excitement, dt, sim.state.score[0] - sim.state.score[1]);
    this.commentary.update(dt, sim.state, this.opts.cfg);
    this.renderer.render(sim.state, dt, this.cameraModeForState(sim.state));
  }

  private guestFrame(dt: number, presentationDt = dt) {
    // never received a single snapshot — the match never started on the host's
    // side. Don't strand the guest on a frozen scene; treat it like a dropped
    // opponent after a generous grace period (only counts before the first snap,
    // so it can never fire mid-match).
    if (!this.snapCur && !this.ended) {
      this.guestNoSnapMs += dt * 1000;
      if (this.guestNoSnapMs > 20000) { this.opponentLeft(); return; }
    }
    const presentationState = this.guestState ?? this.guestSim?.state;
    if (presentationState && this.renderWalkoutPresentation(presentationDt, presentationState)) return;
    // our walk-out is done (or there was none) — tell the host so the kick-off
    // syncs. Sent once; the host holds its first step until it arrives.
    if (this.opts.net && !this.kickReadySent) {
      this.kickReadySent = true;
      this.opts.net.session.send({ k: 'kickReady' });
    }
    if (presentationState && this.renderExitPresentation(presentationDt, presentationState)) return;
    if (presentationState && this.renderSubstitutionPresentation(presentationDt, presentationState)) return;

    const replayFrame = this.goalReplay.update(dt);
    if (replayFrame) {
      this.opts.hud.setReplay(true);
      if (this.guestState) this.opts.hud.update(this.guestState, this.opts.cfg.halfLengthSec, 0);
      this.opts.audio.updateCrowd(replayFrame.state.excitement, dt, replayFrame.state.score[0] - replayFrame.state.score[1]);
      this.renderer.render(replayFrame.state, dt, replayFrame.camera);
      return;
    }
    this.opts.hud.setReplay(false);

    // stream input up at ~30Hz
    this.snapTime += dt;
    if ((performance.now() / 33 | 0) % 1 === 0) {
      const sendState = this.guestState ?? this.guestSim?.state ?? null;
      const raw = this.opts.input.getInput();
      this.opts.net!.session.send({ k: 'inp', i: sendState ? this.remapInputForCamera(raw, sendState) : raw });
    }
    if (this.snapCur && this.guestState) {
      const alpha = Math.min(1, this.snapTime / (3 * DT));
      const state = snapshotToRenderState(this.snapCur, this.snapPrev, alpha, this.guestState);
      const gOwner = state.ball.ownerIdx >= 0 ? state.players[state.ball.ownerIdx] : null;
      const gAttacking = state.phase !== 'play'
        ? state.restartTeam === this.opts.localTeam
        : gOwner ? gOwner.team === this.opts.localTeam : state.ball.lastTouchTeam === this.opts.localTeam;
      this.opts.input.setTouchContext(gAttacking);
      const guestInput = this.remapInputForCamera(this.opts.input.getInput(), state);
      this.renderer.setAimIndicator(this.computeAimIndicator(state, guestInput));
      this.guestState = state;
      this.goalReplay.record(state);
      this.opts.hud.update(state, this.opts.cfg.halfLengthSec, 0);
      this.opts.audio.updateCrowd(state.excitement, dt, state.score[0] - state.score[1]);
      this.commentary.update(dt, state, this.opts.cfg);
      this.renderer.render(state, dt, this.cameraModeForState(state));
    }
  }

  private finishFromSnapshot(snap: Snapshot) {
    if (this.ended) return;
    const winner = snap.score[0] > snap.score[1] ? 0 : snap.score[1] > snap.score[0] ? 1 : -1;
    this.finish({ score: snap.score, winner: winner as -1 | 0 | 1 });
  }

  private renderWalkoutPresentation(dt: number, state: MatchState): boolean {
    if (this.walkoutTimer <= 0 || this.ended) return false;
    this.opts.hud.setReplay(false);
    const progress = 1 - this.walkoutTimer / this.walkoutDuration;
    const renderState = buildWalkoutPresentationState(state, progress);
    this.opts.hud.update(state, this.opts.cfg.halfLengthSec, 0);
    this.opts.audio.updateCrowd(Math.max(0.5, state.excitement), dt, state.score[0] - state.score[1]);
    this.renderer.render(renderState, dt, { presentation: 'walkout', pyro: presentationPyroEnabled(this.opts.cfg) });
    this.walkoutTimer = Math.max(0, this.walkoutTimer - dt);
    if (this.walkoutTimer <= 0) this.opts.hud.showMatchdayGraphic(false);
    return true;
  }

  private renderExitPresentation(dt: number, state: MatchState): boolean {
    const scene = this.exitPresentation;
    if (!scene || this.ended) return false;
    this.opts.hud.setReplay(false);
    const progress = 1 - scene.timer / scene.duration;
    const presentation = exitPresentationModeForConfig(scene.kind, this.opts.cfg, state.winner);
    const celebratingTeam = celebrationTeamForConfig(this.opts.cfg, state.winner);
    const isCelebration = presentation === 'trophyLift' || presentation === 'winnerCelebration';
    const presentationState = isCelebration && celebratingTeam !== null && state.winner !== celebratingTeam
      ? { ...state, winner: celebratingTeam }
      : state;
    const renderState = isCelebration
      ? buildTrophyCelebrationState(presentationState, progress)
      : buildExitPresentationState(state, progress, scene.kind);
    this.opts.hud.update(state, this.opts.cfg.halfLengthSec, 0);
    this.opts.audio.updateCrowd(scene.kind === 'fullTime' ? Math.max(0.62, state.excitement) : Math.max(0.45, state.excitement), dt);
    this.renderer.render(renderState, dt, {
      presentation,
      pyro: presentationPyroEnabled(this.opts.cfg),
    });

    scene.timer = Math.max(0, scene.timer - dt);
    // only the full-time scene waits for the commentary to wrap up; at half
    // time we cut back to the pitch instead of staring at players in the tunnel
    const waitForCommentary = scene.kind === 'fullTime';
    if (scene.timer > 0 || (waitForCommentary && !this.commentary.isIdle())) return true;
    this.opts.hud.showMatchdayGraphic(false);

    this.exitPresentation = null;
    if (scene.kind === 'fullTime') {
      this.finish({ score: [state.score[0], state.score[1]], winner: state.winner, momentum: [state.momentum[0], state.momentum[1]], scorers: state.goals });
      return true;
    }

    state.restartTimer = Math.min(state.restartTimer, 0.18);
    return true;
  }

  private renderSubstitutionPresentation(dt: number, state: MatchState): boolean {
    const scene = this.substitutionPresentation;
    if (!scene || this.ended) return false;
    this.opts.hud.setReplay(false);
    const progress = 1 - scene.timer / scene.duration;
    const renderState = buildSubstitutionPresentationSceneState(state, progress, scene.changes);
    this.opts.hud.update(state, this.opts.cfg.halfLengthSec, 0);
    this.opts.audio.updateCrowd(Math.max(0.42, state.excitement), dt, state.score[0] - state.score[1]);
    this.renderer.render(renderState, dt, {
      presentation: 'substitution',
      presentationFocus: this.substitutionPresentationFocus(state),
    });
    scene.timer = Math.max(0, scene.timer - dt);
    if (scene.timer <= 0) this.substitutionPresentation = null;
    return true;
  }

  private substitutionPresentationFocus(state: MatchState): { x: number; y: number } {
    const scene = this.substitutionPresentation;
    void state;
    if (!scene || scene.changes.length === 0) return { x: 0, y: -HALF_WID - 4 };
    return { x: 0, y: -HALF_WID - 4 };
  }

  /** Begin the international-cup drinks break: the run-out HUD shows "HYDRATION
   *  BREAK" while both teams jog to a touchline huddle and back. Returns true so
   *  the caller pauses the sim for the duration. */
  private startHydrationBreak(): boolean {
    if (this.hydrationBreakPresentation || this.ended) return false;
    const duration = 5.2;
    this.hydrationBreakPresentation = { timer: duration, duration };
    this.opts.hud.showMatchdayGraphic(true, 'HYDRATION BREAK', 'Drinks break');
    return true;
  }

  private renderHydrationBreakPresentation(dt: number, state: MatchState): boolean {
    const scene = this.hydrationBreakPresentation;
    if (!scene || this.ended) return false;
    this.opts.hud.setReplay(false);
    const progress = 1 - scene.timer / scene.duration;
    const renderState = buildHydrationBreakState(state, progress);
    this.opts.hud.update(state, this.opts.cfg.halfLengthSec, 0);
    this.opts.audio.updateCrowd(Math.max(0.35, state.excitement * 0.6), dt, state.score[0] - state.score[1]);
    this.renderer.render(renderState, dt, {
      presentation: 'substitution',
      presentationFocus: { x: 0, y: -HALF_WID - 2 },
    });
    scene.timer = Math.max(0, scene.timer - dt);
    if (scene.timer <= 0) {
      this.hydrationBreakPresentation = null;
      this.opts.hud.showMatchdayGraphic(false);
    }
    return true;
  }

  private startExitPresentation(events: SimEvent[]): boolean {
    const full = events.some((e) => e.type === 'fullTime' || e.type === 'matchEnd');
    const half = events.some((e) => e.type === 'halfTime');
    if (!full && !half) return false;
    const kind: ExitPresentationKind = full ? 'fullTime' : 'halfTime';
    if (this.exitPresentation?.kind === kind) return true;
    const state = this.sim?.state ?? this.guestState;
    const presentation = state ? exitPresentationModeForConfig(kind, this.opts.cfg, state.winner) : kind === 'halfTime' ? 'halfTimeExit' : 'fullTimeExit';
    const winnerCelebration = presentation === 'trophyLift' || presentation === 'winnerCelebration';
    // trophy/major-result celebrations linger; a normal full time is shorter
    const duration = kind === 'halfTime' ? 5.0 : winnerCelebration ? 9.5 : 6.2;
    this.exitPresentation = { kind, timer: duration, duration };
    if (kind === 'halfTime') {
      this.opts.onAdOpportunity?.({ surface: 'break', placementId: 'half_time_break', reason: 'half_time' });
    }
    if (presentation === 'trophyLift' && state) {
      this.opts.hud.showMatchdayGraphic(
        true,
        `${this.opts.cfg.teams[state!.winner as 0 | 1].data.name.toUpperCase()} — CHAMPIONS`,
        'CHAMPIONS',
      );
    } else if (presentation === 'winnerCelebration' && state) {
      const celebratingTeam = celebrationTeamForConfig(this.opts.cfg, state.winner);
      if (celebratingTeam !== null) {
        this.opts.hud.showMatchdayGraphic(
          true,
          `${this.opts.cfg.teams[celebratingTeam].data.name.toUpperCase()} — HISTORY MADE`,
          'HISTORY MADE',
        );
      }
    } else if (state) {
      // the broadcast score graphic (score + scorers/times) at half time and full time
      this.opts.hud.showScoreGraphic(state.goals, state.score, kind === 'fullTime' ? 'FULL TIME' : 'HALF TIME', duration * 1000);
    }
    return true;
  }

  private commentaryEvents(events: SimEvent[]): SimEvent[] {
    if (events.some((e) => e.type === 'fullTime')) {
      this.fullTimeCommentaryStarted = true;
      return events;
    }
    if (!events.some((e) => e.type === 'matchEnd')) return events;
    if (!this.fullTimeCommentaryStarted) {
      this.fullTimeCommentaryStarted = true;
      return events;
    }
    return events.filter((e) => e.type !== 'matchEnd');
  }

  /**
   * With the behind-the-ball camera live, the stick is screen-relative: up
   * pushes away from the camera. Reduces to the identity for the overhead view.
   */
  private remapInputForCamera(input: PadInput, state: MatchState): PadInput {
    if (!this.cameraModeForState(state).setPiece) return input;
    if (!input.moveX && !input.moveY) return input;
    // Derive the basis from the restart GEOMETRY, not the live render camera.
    // The render camera eases into the set-piece framing over ~0.3s and is read a
    // frame stale (and jittered by goal shake), so the old basis pointed the wrong
    // way while the player was lining up — "up" went off-axis. This is correct on
    // the very first frame and immune to lerp/shake.
    const f = this.setPieceForward(state);
    const r = { x: -f.y, y: f.x };
    return {
      ...input,
      moveX: r.x * input.moveX + f.x * -input.moveY,
      moveY: r.y * input.moveX + f.y * -input.moveY,
    };
  }

  /**
   * The camera's ground-forward for each behind-the-player restart, computed
   * deterministically from the restart spot + attack direction so it mirrors the
   * framing in matchRenderer exactly (corner/goalKick/freeKick/penaltyKick).
   * Throw-ins keep the overhead camera, so they don't reach here (identity remap).
   */
  private setPieceForward(state: MatchState): { x: number; y: number } {
    const r = state.restartPos;
    const atk = state.attackDir[state.restartTeam] || 1;
    let fx: number, fy: number;
    if (state.phase === 'corner') {
      const sx = Math.sign(r.x || atk);
      const sy = Math.sign(r.y || 1);
      fx = -sx * 24; fy = -sy * 21;
    } else if (state.phase === 'goalKick') {
      const sx = Math.sign(r.x || atk);
      fx = -sx * 33; fy = -5;
    } else {
      // freeKick / penaltyKick: look along the ball→goal line
      fx = atk * HALF_LEN - r.x;
      fy = -r.y;
    }
    const len = Math.hypot(fx, fy) || 1;
    return { x: fx / len, y: fy / len };
  }

  /** aim arrow while lining up a charged set piece (corner / throw / free kick) */
  private computeAimIndicator(
    state: MatchState,
    input: PadInput,
  ): { x: number; y: number; dirX: number; dirY: number; charge: number } | null {
    const charged = state.phase === 'corner' || state.phase === 'throwIn'
      || state.phase === 'freeKick' || state.phase === 'goalKick';
    if (!charged || state.restartTeam !== this.opts.localTeam) {
      this.aimChargeSince = -1;
      return null;
    }
    const held = input.pass || input.shoot;
    if (held && this.aimChargeSince < 0) this.aimChargeSince = performance.now();
    if (!held) this.aimChargeSince = -1;
    const charge = this.aimChargeSince >= 0 ? Math.min(1, (performance.now() - this.aimChargeSince) / 1000) : 0;
    const origin = state.ball.pos;
    const atkDir = state.attackDir[this.opts.localTeam] || 1;
    // charging a free-kick SHOT: the arrow mirrors what the sim will do —
    // in range it goes at the goal mouth (stick slides the aim across the
    // frame); out of range it is a lofted launch towards the box
    if (state.phase === 'freeKick' && input.shoot) {
      const distanceToGoal = HALF_LEN - origin.x * atkDir;
      const canShoot = distanceToGoal <= 32 && distanceToGoal > 7 && Math.abs(origin.y) < 26;
      const tx = canShoot ? atkDir * HALF_LEN : atkDir * (HALF_LEN - PENALTY_SPOT);
      const ty = canShoot
        ? Math.max(-GOAL_HALF_WIDTH * 0.94, Math.min(GOAL_HALF_WIDTH * 0.94, input.moveY * GOAL_HALF_WIDTH * 0.92))
        : Math.max(-10, Math.min(10, input.moveY * 9));
      const gx = tx - origin.x;
      const gy = ty - origin.y;
      const gd = Math.hypot(gx, gy) || 1;
      return { x: origin.x, y: origin.y, dirX: gx / gd, dirY: gy / gd, charge };
    }
    let dx = input.moveX;
    let dy = input.moveY;
    const mag = Math.hypot(dx, dy);
    if (mag > 0.15) {
      dx /= mag; dy /= mag;
    } else {
      // default delivery line per set piece
      let tx: number;
      let ty: number;
      const atk = atkDir;
      if (state.phase === 'corner') {
        tx = Math.sign(origin.x || 1) * (HALF_LEN - PENALTY_SPOT);
        ty = 0;
      } else if (state.phase === 'throwIn') {
        tx = origin.x + atk * 6;
        ty = origin.y * 0.4;
      } else if (state.phase === 'goalKick') {
        tx = origin.x + atk * 30;
        ty = origin.y * 0.5;
      } else {
        tx = atk * HALF_LEN;
        ty = 0;
      }
      const d = Math.hypot(tx - origin.x, ty - origin.y) || 1;
      dx = (tx - origin.x) / d;
      dy = (ty - origin.y) / d;
    }
    return { x: origin.x, y: origin.y, dirX: dx, dirY: dy, charge };
  }

  private cameraModeForState(state: MatchState): RenderCameraMode {
    // throw-ins keep the normal overhead camera; the cinematic angle suits
    // corners, free kicks and penalties
    const setPiece = state.restartTimer <= 0.72 && (
      state.phase === 'corner'
      || state.phase === 'goalKick'
      || state.phase === 'freeKick'
      || state.phase === 'penaltyKick'
    );
    const mode: RenderCameraMode = setPiece ? { setPiece: true } : {};
    // Player Career Be-A-Pro: follow the avatar player with the camera.
    const fp = this.sim?.cfg.focusPlayer;
    if (fp) {
      const player = state.players.find((p) => p.team === fp.team && p.squadIdx === fp.squadIdx);
      if (player) mode.focusPlayerIdx = player.idx;
    }
    return mode;
  }

  private get isHostRole(): boolean {
    return this.opts.net?.role !== 'guest';
  }

  /** The app was backgrounded (tab hidden / phone locked / app switched away).
   *  Pause so the clock + audio stop and, online, the opponent sees a synchronized
   *  pause instead of us freezing or playing on with stale input. The connection is
   *  kept open — only actually CLOSING the app drops it (then it forfeits as before). */
  onAppHidden() {
    if (this.ended || this.paused || this.onlinePause || this.onlinePausePending) return;
    this.togglePause();
  }

  // The pause button. Offline pauses instantly; online queues a synchronized
  // pause that fires at the next stoppage (item 5).
  private togglePause() {
    if (this.ended || this.paused || this.onlinePausePending) return;
    if (!this.opts.net) {
      this.paused = true;
      this.showPauseMenu();
      return;
    }
    this.requestOnlinePause();
  }

  // ---- offline pause -------------------------------------------------------
  private showPauseMenu() {
    this.opts.onPauseMenu({
      online: false,
      onResume: () => this.resumeOfflinePause(),
      onQuit: () => this.quitMatch(),
      onSubstitutions: () => this.openSubstitutionMenu(),
    });
  }

  private resumeOfflinePause() {
    this.paused = false;
    this.last = performance.now();
    this.opts.hidePauseMenu();
    this.commitPendingSubstitutions();
  }

  // ---- online synchronized pause (item 5) ----------------------------------
  /** A local pause request. The host queues it; the guest asks the host. */
  private requestOnlinePause() {
    if (this.onlinePause || this.onlinePausePending) return;
    this.onlinePausePending = true;
    this.opts.hud.banner('PAUSE — at the next stoppage', 1800);
    if (this.isHostRole) this.maybeActivateOnlinePause();
    else this.opts.net?.session.send({ k: 'pauseReq' });
  }

  /** Host received the guest's pause request. */
  private onRemotePauseRequest() {
    if (!this.isHostRole || this.onlinePause) return;
    this.onlinePausePending = true;
    this.opts.hud.banner('PAUSE requested — at the next stoppage', 1800);
    this.maybeActivateOnlinePause();
  }

  /** Host: activate a queued pause once the ball is at a stoppage. */
  private maybeActivateOnlinePause() {
    if (!this.isHostRole || !this.onlinePausePending || this.onlinePause) return;
    // never freeze a running cutscene (half-time tunnel, goal celebration,
    // walk-out) — defer until the presentation finishes and we're at a live break
    if (this.exitPresentation || this.walkoutTimer > 0) return;
    if (!this.sim || !isBreakPhase(this.sim.state.phase)) return;
    this.onlinePausePending = false;
    this.onlinePause = { deadline: performance.now() + ONLINE_PAUSE_MS, hostReady: false, guestReady: false };
    this.paused = true;
    this.lastPauseSecond = -1;
    this.opts.net?.session.send({ k: 'pause', paused: true });
    this.showOnlinePauseMenu();
  }

  /** Guest: the host pushed the authoritative pause state. */
  private onRemotePause(paused: boolean) {
    if (this.isHostRole) return; // host owns its own state
    if (paused) {
      if (this.onlinePause) return;
      this.onlinePausePending = false;
      this.onlinePause = { deadline: performance.now() + ONLINE_PAUSE_MS, hostReady: false, guestReady: false };
      this.paused = true;
      this.lastPauseSecond = -1;
      this.showOnlinePauseMenu();
    } else {
      this.endOnlinePauseLocally();
    }
  }

  private showOnlinePauseMenu() {
    this.opts.onPauseMenu({
      online: true,
      onResume: () => this.markLocalReady(),
      onQuit: () => this.quitMatch(),
      onSubstitutions: () => this.openSubstitutionMenu(),
    });
  }

  private showCurrentPauseMenu() {
    if (this.onlinePause) this.showOnlinePauseMenu();
    else this.showPauseMenu();
  }

  /** A resume tap: mark this side ready (and tell the peer so their UI updates);
   *  the host arbitrates the actual resume. */
  private markLocalReady() {
    const op = this.onlinePause;
    if (!op) return;
    if (this.isHostRole) op.hostReady = true;
    else op.guestReady = true;
    this.opts.net?.session.send({ k: 'resume' });
    this.lastPauseSecond = -1; // force a status refresh
  }

  /** The peer signalled they are ready to resume — record THEIR readiness. */
  private onRemoteResume() {
    const op = this.onlinePause;
    if (!op) return;
    if (this.isHostRole) op.guestReady = true;
    else op.hostReady = true;
    this.lastPauseSecond = -1;
  }

  /** Runs every frame while an online pause is active. */
  private tickOnlinePause(now: number) {
    const op = this.onlinePause;
    if (!op) return;
    if (this.isHostRole) {
      if (pauseResumeDue(op, now)) { this.resumeOnlinePause(); return; }
    } else if (now >= op.deadline) {
      // failsafe: if we somehow lost the host, the 40s cap still frees us
      this.endOnlinePauseLocally();
      return;
    }
    const secs = pauseSecondsLeft(op, now);
    if (secs !== this.lastPauseSecond) {
      this.lastPauseSecond = secs;
      const youReady = this.isHostRole ? op.hostReady : op.guestReady;
      const oppReady = this.isHostRole ? op.guestReady : op.hostReady;
      this.opts.onPauseStatus?.({ seconds: secs, youReady, oppReady });
    }
  }

  /** Host ends the pause (both ready, or 40s up) and tells the guest. */
  private resumeOnlinePause() {
    if (!this.onlinePause) return;
    this.opts.net?.session.send({ k: 'pause', paused: false });
    this.endOnlinePauseLocally();
  }

  private endOnlinePauseLocally() {
    if (!this.onlinePause) return;
    this.onlinePause = null;
    this.onlinePausePending = false;
    this.paused = false;
    this.last = performance.now();
    this.opts.onPauseStatus?.(null);
    this.opts.hidePauseMenu();
    this.commitPendingSubstitutions();
    // the player may have been in the sub submenu — make the resume explicit
    if (!this.ended) this.opts.hud.banner('▶ PLAY RESUMES', 1400);
  }

  /** QUIT from the pause menu. Online = forfeit; offline = back to menu. */
  private quitMatch() {
    if (this.opts.net) {
      try { this.opts.net.session.send({ k: 'bye' }); } catch { /* ignore */ }
      this.finishByForfeit('loss');
    } else {
      this.abort('');
    }
  }

  private openSubstitutionMenu(message = '', initialTab: 'team' | 'formation' | 'tactics' = 'team') {
    const sim = this.sim ?? this.guestSim;
    if (!sim) return;
    const team = this.opts.localTeam;
    const teamCfg = this.opts.cfg.teams[team];
    const { starters, bench } = buildSubstitutionRoster(
      sim.state.players,
      team,
      teamCfg.lineup.starters,
      teamCfg.data.players,
      sim.state.subbedOff[team],
      sim.state.subbedOn[team],
    );
    const atBreak = isBreakPhase(sim.state.phase);
    const pendingForTeam = this.pendingSubstitutions.filter((s) => s.team === team);
    const usedOrQueued = sim.state.substitutionsUsed[team] + pendingForTeam.length;
    // during an online pause the countdown must remain visible inside the sub
    // submenu (it reuses the #pause-timer node so updatePauseStatus keeps ticking)
    const onlinePauseSeconds = this.onlinePause
      ? pauseSecondsLeft(this.onlinePause, performance.now())
      : undefined;
    this.opts.onSubstitutionMenu({
      teamName: teamCfg.data.short,
      used: usedOrQueued,
      max: sim.maxSubstitutions(),
      atBreak,
      onlinePauseSeconds,
      starters,
      bench,
      formation: teamCfg.lineup.formation,
      tactics: normalizeTactics(teamCfg.lineup.tactics, teamCfg.lineup.formation),
      formations: FORMATION_IDS,
      initialTab,
      message,
      queued: pendingForTeam.map((s) => ({ offPlayerIdx: s.offPlayerIdx, onSquadIdx: s.onSquadIdx, offName: s.offName, onName: s.onName })),
      onSub: (offPlayerIdx, onSquadIdx) => {
        const offName = starters.find((s) => s.playerIdx === offPlayerIdx)?.name ?? '';
        const onName = bench.find((b) => b.squadIdx === onSquadIdx)?.name ?? '';
        const reason = this.queueSubstitution(team, offPlayerIdx, onSquadIdx, offName, onName, starters, bench, atBreak, sim);
        this.openSubstitutionMenu(reason, 'team');
      },
      onSwap: (playerIdxA, playerIdxB) => {
        const nameA = starters.find((s) => s.playerIdx === playerIdxA)?.name ?? '';
        const nameB = starters.find((s) => s.playerIdx === playerIdxB)?.name ?? '';
        const ok = sim.swapPositions(team, playerIdxA, playerIdxB);
        if (ok && this.opts.net) this.opts.net.session.send({ k: 'swap', team, playerIdxA, playerIdxB });
        this.openSubstitutionMenu(ok ? `${nameA} and ${nameB} have switched positions.` : 'Those players can’t switch positions.', 'team');
      },
      onCancelQueued: (offPlayerIdx) => {
        this.cancelQueuedSubstitution(offPlayerIdx);
        this.openSubstitutionMenu('Queued change cancelled.', 'team');
      },
      onFormationChange: (formation) => {
        const ok = sim.changeFormation(team, formation);
        if (ok && this.opts.net) this.opts.net.session.send({ k: 'formation', team, formation });
        this.openSubstitutionMenu(ok ? `Formation changed to ${formation}.` : 'That formation is not available.', 'formation');
      },
      onTacticsChange: (tactics: TeamTactics) => {
        const ok = sim.changeTactics(team, tactics);
        if (ok && this.opts.net) this.opts.net.session.send({ k: 'tactics', team, tactics });
        this.openSubstitutionMenu(ok ? 'Tactics updated.' : 'Those tactics are not available.', 'tactics');
      },
      onBack: () => this.showCurrentPauseMenu(),
    });
  }

  private queueSubstitution(
    team: 0 | 1,
    offPlayerIdx: number,
    onSquadIdx: number,
    offName: string,
    onName: string,
    starters: SubstitutionMenuOpts['starters'],
    bench: SubstitutionMenuOpts['bench'],
    atBreak: boolean,
    sim: MatchSim,
  ): string {
    const pendingForTeam = this.pendingSubstitutions.filter((s) => s.team === team);
    if (sim.state.substitutionsUsed[team] + pendingForTeam.length >= sim.maxSubstitutions()) {
      return `All ${sim.maxSubstitutions()} substitutions have been used.`;
    }
    if (pendingForTeam.some((s) => s.offPlayerIdx === offPlayerIdx)) {
      return 'That player is already queued to come off.';
    }
    if (pendingForTeam.some((s) => s.onSquadIdx === onSquadIdx)) {
      return 'That substitute is already queued to come on.';
    }
    const off = starters.find((s) => s.playerIdx === offPlayerIdx);
    const incoming = bench.find((b) => b.squadIdx === onSquadIdx);
    const outgoing = this.clonePlayer(sim.state.players[offPlayerIdx]);
    if (!off || !incoming || !outgoing || outgoing.team !== team) return 'That substitution is not available.';
    if ((off.pos === 'GK') !== (incoming.pos === 'GK')) return 'Goalkeepers can only be replaced by goalkeepers.';
    this.pendingSubstitutions.push({ team, offPlayerIdx, onSquadIdx, offName, onName, outgoing });
    return atBreak
      ? `${onName} for ${offName} queued. It will be made when play resumes.`
      : `${onName} for ${offName} queued. It will be made at the next stoppage.`;
  }

  /** Cancel a queued (not-yet-made) substitution — e.g. the wrong player was picked. */
  private cancelQueuedSubstitution(offPlayerIdx: number): void {
    const i = this.pendingSubstitutions.findIndex((s) => s.offPlayerIdx === offPlayerIdx);
    if (i >= 0) this.pendingSubstitutions.splice(i, 1);
  }

  private commitPendingSubstitutions() {
    const sim = this.sim ?? this.guestSim;
    if (!sim || this.pendingSubstitutions.length === 0) return;
    // queued subs are only made at a stoppage — never mid-play. A sub set while the
    // ball is live waits here until the next break (handled by the match loop).
    if (!isBreakPhase(sim.state.phase)) return;
    const queued = this.pendingSubstitutions.splice(0);
    for (const sub of queued) {
      const outgoing = this.clonePlayer(sim.state.players[sub.offPlayerIdx]) ?? sub.outgoing;
      const ok = sim.substitute(sub.team, sub.offPlayerIdx, sub.onSquadIdx);
      if (!ok) continue;
      this.startSubstitutionPresentation(sub.offPlayerIdx, outgoing);
      this.opts.hud.subBanner(this.opts.cfg.teams[sub.team]?.data.short ?? '', sub.offName, sub.onName);
      if (this.opts.net) {
        this.opts.net.session.send({
          k: 'sub',
          team: sub.team,
          offPlayerIdx: sub.offPlayerIdx,
          onSquadIdx: sub.onSquadIdx,
          offName: sub.offName,
          onName: sub.onName,
        });
      }
    }
  }

  private startSubstitutionPresentation(playerIdx: number, outgoing: SimPlayer) {
    const duration = 2.15;
    const change = { playerIdx, outgoing };
    if (this.substitutionPresentation) {
      this.substitutionPresentation.changes.push(change);
      this.substitutionPresentation.timer = duration;
      this.substitutionPresentation.duration = duration;
      return;
    }
    this.substitutionPresentation = { timer: duration, duration, changes: [change] };
  }

  private clonePlayer(p: SimPlayer | undefined): SimPlayer | null {
    if (!p) return null;
    return {
      ...p,
      attrs: { ...p.attrs },
      slot: { ...p.slot },
      pos: { ...p.pos },
      vel: { ...p.vel },
    };
  }

  private finish(outcome: MatchOutcome) {
    this.ended = true;
    this.opts.onAdOpportunity?.({ surface: 'break', placementId: 'post_match_break', reason: outcome.reason ?? 'full_time' });
    this.teardown();
    this.opts.onEnd(outcome);
  }

  /** End an online match by forfeit: the non-forfeiting side wins 3–0. */
  private finishByForfeit(side: 'win' | 'loss') {
    if (this.ended) return;
    const lt = this.opts.localTeam;
    const winnerTeam: 0 | 1 = side === 'win' ? lt : (lt === 0 ? 1 : 0);
    const score: [number, number] = winnerTeam === 0 ? [3, 0] : [0, 3];
    this.opts.onPauseStatus?.(null);
    this.opts.hidePauseMenu();
    this.finish({
      score,
      winner: winnerTeam,
      reason: side === 'win' ? 'Opponent forfeited — you win' : 'You forfeited the match',
    });
  }

  /** The opponent's connection dropped (bye or transport close). Before
   *  full-time that is a forfeit in our favour; AFTER the final whistle it is
   *  just the normal post-match teardown, so we end on the real score. */
  private opponentLeft() {
    if (this.ended) return;
    if (this.reachedFullTime && this.finalScore) {
      const [a, b] = this.finalScore;
      this.finish({ score: [a, b], winner: a > b ? 0 : b > a ? 1 : -1 });
      return;
    }
    this.finishByForfeit('win');
  }

  abort(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.teardown();
    if (reason) console.warn('match aborted:', reason);
    this.opts.onAbort();
  }

  private teardown() {
    cancelAnimationFrame(this.raf);
    // drop any in-flight online-pause state so nothing lingers after the match
    this.onlinePause = null;
    this.onlinePausePending = false;
    this.opts.onPauseStatus?.(null);
    this.opts.hud.show(false);
    this.opts.hud.setReplay(false);
    this.opts.hud.showMatchdayGraphic(false);
    this.opts.input.showTouch(false);
    this.opts.audio.stopCrowd();
    this.commentary.stop();
    this.goalReplay.clear();
    this.renderer.dispose();
    this.opts.input.onPause = null;
    if (this.opts.net) {
      this.opts.net.session.onMessage = null;
      this.opts.net.session.onClose = null;
    }
  }
}
