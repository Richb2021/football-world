import {
  AERIAL_REACH_Z, BALL_AIR_DRAG, BALL_GROUND_FRICTION, BALL_RADIUS, BALL_RESTITUTION, CENTER_CIRCLE_R, CONTROL_RADIUS, DT,
  HEADER_MAX_Z, HEADER_MIN_Z,
  GOAL_DEPTH, GOAL_HALF_WIDTH, GOAL_HEIGHT, GRAVITY, HALF_LEN, HALF_WID, PENALTY_SPOT,
  PLAYER_RADIUS, TOUCH_COOLDOWN,
  PENALTY_BOX_DEPTH, PENALTY_BOX_HALF_WIDTH,
} from './constants';
import { FORMATIONS, autoLineup, normalizeTactics, slotRole, positionFit } from './formations';
import {
  MATCH_MOMENTUM_MIN, MATCH_MOMENTUM_MAX, MATCH_MOMENTUM_ATTR_SCALE, BURST_WINDOW_MIN,
  clampMomentum, underdogFactor, eventMomentumDelta, substitutionMomentumLoss, type MomentumEventCtx,
} from './momentum';
import { rollInjury, injuryMatchesOut, INJURY_KNOCK_DIP, INJURY_KNOCK_SECONDS, type InjuryTier } from './injury';
import { isBreakPhase } from './phase';
import { Rng } from './rng';
import type {
  FormationId, MatchConfig, MatchState, PadInput, PenaltyState, PlayerPosition, SimBall, SimEvent, SimPhase, SimPlayer, TeamTactics, Vec2,
} from './types';
import { NULL_INPUT } from './types';


interface WeatherFx {
  ballFriction: number;
  accel: number;
  maxSpeed: number;
  passErr: number;
  gkCatch: number;
  slide: number;
}

const WEATHER_FX: Record<string, WeatherFx> = {
  normal: { ballFriction: 1, accel: 1, maxSpeed: 1, passErr: 1, gkCatch: 1, slide: 1 },
  sunny: { ballFriction: 0.95, accel: 1, maxSpeed: 1, passErr: 1, gkCatch: 1, slide: 1 },
  rain: { ballFriction: 0.78, accel: 0.92, maxSpeed: 1, passErr: 1.15, gkCatch: 0.85, slide: 1.18 },
  snow: { ballFriction: 1.35, accel: 0.88, maxSpeed: 0.94, passErr: 1.2, gkCatch: 0.95, slide: 1.05 },
  ice: { ballFriction: 0.62, accel: 0.55, maxSpeed: 0.97, passErr: 1.25, gkCatch: 0.9, slide: 1.4 },
};

/** Furthest a long restart / keeper punt / clearance will travel (carry+roll).
 * A big kick clears halfway and finds the front players; it does NOT sail the
 * length of the pitch to the opposition keeper or straight out of play. */
const MAX_LONG_KICK_RANGE = 64;
const LONG_AERIAL_MIN_LOFT = 0.3;
const LONG_AERIAL_MIN_SPEED = 18;
const LONG_AERIAL_SKID_SECONDS = 4.2;
const LONG_AERIAL_FRICTION_MULT = 1.45;
const LONG_AERIAL_GROUND_DRAG = 0.92;
const LONG_AERIAL_BOUNCE_DAMP = 0.72;
const LONG_AERIAL_RESTITUTION = 0.36;
/** Substitutions permitted per team per match (modern 5-sub rule). */
export const MAX_SUBSTITUTIONS = 5;

interface PressAssignments {
  primary: SimPlayer | null;
  secondary: SimPlayer | null;
  tertiary?: SimPlayer | null;
  dangerousReceiver?: SimPlayer | null;
}

type TeamTacticalState =
  | 'buildUp'
  | 'fastBreak'
  | 'settledAttack'
  | 'highPress'
  | 'midBlock'
  | 'lowBlock'
  | 'emergencyDefend';

type PlayerRole =
  | 'keeper'
  | 'overlapFullBack'
  | 'defensiveFullBack'
  | 'coverCentreBack'
  | 'stopperCentreBack'
  | 'holdingMidfielder'
  | 'playmaker'
  | 'wideMidfielder'
  | 'boxToBoxMidfielder'
  | 'wideForward'
  | 'poacher'
  | 'targetForward';

interface TeamMentality {
  risk: number;
  tempo: number;
  lineBias: number;
  pressLimit: number;
  supportWidth: number;
}

interface FirstTouchOutcome {
  loose: boolean;
  push: number;
}

interface BallFrameStart {
  pos: Vec2;
  z: number;
}

interface PlayerDecisionProfile {
  passUrgency: number;
  carryBias: number;
  shootAggression: number;
  wideCarry: number;
  defensiveScreen: number;
  pressBias: number;
}

interface TeamTacticProfile {
  width: number;
  switchPlay: number;
  centralOverload: number;
  defensiveCover: number;
  pivotDepth: number;
  directness: number;
}

const DEFAULT_TACTIC_PROFILE: TeamTacticProfile = {
  width: 0.5,
  switchPlay: 0.45,
  centralOverload: 0.45,
  defensiveCover: 0.45,
  pivotDepth: 0.45,
  directness: 0.5,
};

const FORMATION_TACTIC_PROFILES: Partial<Record<string, TeamTacticProfile>> = {
  '2-3-5': { width: 0.9, switchPlay: 0.62, centralOverload: 0.34, defensiveCover: 0.24, pivotDepth: 0.28, directness: 0.82 },
  'w-m': { width: 0.72, switchPlay: 0.54, centralOverload: 0.52, defensiveCover: 0.46, pivotDepth: 0.45, directness: 0.64 },
  '4-2-4': { width: 0.86, switchPlay: 0.7, centralOverload: 0.4, defensiveCover: 0.36, pivotDepth: 0.38, directness: 0.76 },
  '4-2-2-2': { width: 0.52, switchPlay: 0.42, centralOverload: 0.78, defensiveCover: 0.56, pivotDepth: 0.68, directness: 0.55 },
  '4-3-2-1': { width: 0.42, switchPlay: 0.38, centralOverload: 0.82, defensiveCover: 0.64, pivotDepth: 0.72, directness: 0.48 },
  '4-4-2': { width: 0.58, switchPlay: 0.52, centralOverload: 0.42, defensiveCover: 0.5, pivotDepth: 0.42, directness: 0.58 },
  '4-3-3': { width: 0.84, switchPlay: 0.78, centralOverload: 0.45, defensiveCover: 0.44, pivotDepth: 0.45, directness: 0.68 },
  '5-3-2': { width: 0.62, switchPlay: 0.5, centralOverload: 0.48, defensiveCover: 0.82, pivotDepth: 0.58, directness: 0.56 },
  '4-5-1': { width: 0.68, switchPlay: 0.58, centralOverload: 0.58, defensiveCover: 0.68, pivotDepth: 0.62, directness: 0.42 },
  '3-5-2': { width: 0.78, switchPlay: 0.68, centralOverload: 0.56, defensiveCover: 0.58, pivotDepth: 0.52, directness: 0.58 },
  '4-2-3-1': { width: 0.7, switchPlay: 0.64, centralOverload: 0.66, defensiveCover: 0.64, pivotDepth: 0.82, directness: 0.48 },
  '4-1-4-1': { width: 0.64, switchPlay: 0.54, centralOverload: 0.58, defensiveCover: 0.76, pivotDepth: 0.76, directness: 0.42 },
  '4-3-1-2': { width: 0.38, switchPlay: 0.36, centralOverload: 0.84, defensiveCover: 0.54, pivotDepth: 0.55, directness: 0.5 },
  '4-4-1-1': { width: 0.58, switchPlay: 0.5, centralOverload: 0.6, defensiveCover: 0.56, pivotDepth: 0.48, directness: 0.5 },
  '3-4-3': { width: 0.86, switchPlay: 0.76, centralOverload: 0.44, defensiveCover: 0.48, pivotDepth: 0.42, directness: 0.74 },
  '3-4-1-2': { width: 0.62, switchPlay: 0.5, centralOverload: 0.76, defensiveCover: 0.54, pivotDepth: 0.5, directness: 0.56 },
  '3-4-2-1': { width: 0.74, switchPlay: 0.62, centralOverload: 0.7, defensiveCover: 0.56, pivotDepth: 0.58, directness: 0.52 },
  '3-1-4-2': { width: 0.68, switchPlay: 0.58, centralOverload: 0.62, defensiveCover: 0.62, pivotDepth: 0.68, directness: 0.54 },
  '5-4-1': { width: 0.58, switchPlay: 0.46, centralOverload: 0.54, defensiveCover: 0.9, pivotDepth: 0.72, directness: 0.4 },
};

const TEAM_MENTALITY_BASE: Record<TeamTacticalState, TeamMentality> = {
  buildUp: { risk: 0.88, tempo: 0.9, lineBias: -0.8, pressLimit: 1, supportWidth: 0.95 },
  fastBreak: { risk: 1.3, tempo: 1.28, lineBias: 3.2, pressLimit: 2, supportWidth: 1.24 },
  settledAttack: { risk: 1.02, tempo: 1, lineBias: 1.4, pressLimit: 2, supportWidth: 1.05 },
  highPress: { risk: 1.22, tempo: 1.16, lineBias: 6.0, pressLimit: 3, supportWidth: 1.1 },
  midBlock: { risk: 1, tempo: 1, lineBias: 0, pressLimit: 2, supportWidth: 1 },
  lowBlock: { risk: 0.78, tempo: 0.86, lineBias: -4.2, pressLimit: 1, supportWidth: 0.88 },
  emergencyDefend: { risk: 0.68, tempo: 0.95, lineBias: -1.4, pressLimit: 2, supportWidth: 0.86 },
};

const ROLE_DECISION_BASE: Record<PlayerRole, PlayerDecisionProfile> = {
  keeper: { passUrgency: 0.58, carryBias: 0.08, shootAggression: 0.02, wideCarry: 0.05, defensiveScreen: 0.05, pressBias: 0.02 },
  overlapFullBack: { passUrgency: 0.5, carryBias: 0.64, shootAggression: 0.18, wideCarry: 0.76, defensiveScreen: 0.35, pressBias: 0.5 },
  defensiveFullBack: { passUrgency: 0.44, carryBias: 0.42, shootAggression: 0.1, wideCarry: 0.48, defensiveScreen: 0.5, pressBias: 0.54 },
  coverCentreBack: { passUrgency: 0.42, carryBias: 0.34, shootAggression: 0.06, wideCarry: 0.08, defensiveScreen: 0.62, pressBias: 0.36 },
  stopperCentreBack: { passUrgency: 0.36, carryBias: 0.24, shootAggression: 0.05, wideCarry: 0.06, defensiveScreen: 0.7, pressBias: 0.44 },
  holdingMidfielder: { passUrgency: 0.56, carryBias: 0.28, shootAggression: 0.12, wideCarry: 0.12, defensiveScreen: 0.84, pressBias: 0.3 },
  playmaker: { passUrgency: 0.82, carryBias: 0.34, shootAggression: 0.32, wideCarry: 0.18, defensiveScreen: 0.38, pressBias: 0.28 },
  wideMidfielder: { passUrgency: 0.56, carryBias: 0.58, shootAggression: 0.3, wideCarry: 0.72, defensiveScreen: 0.34, pressBias: 0.48 },
  boxToBoxMidfielder: { passUrgency: 0.52, carryBias: 0.52, shootAggression: 0.34, wideCarry: 0.28, defensiveScreen: 0.5, pressBias: 0.54 },
  wideForward: { passUrgency: 0.46, carryBias: 0.7, shootAggression: 0.62, wideCarry: 0.82, defensiveScreen: 0.16, pressBias: 0.42 },
  poacher: { passUrgency: 0.34, carryBias: 0.38, shootAggression: 0.88, wideCarry: 0.1, defensiveScreen: 0.08, pressBias: 0.22 },
  targetForward: { passUrgency: 0.42, carryBias: 0.42, shootAggression: 0.66, wideCarry: 0.16, defensiveScreen: 0.12, pressBias: 0.28 },
};

const DIFFICULTY = [
  { reaction: 0.55, keeper: 0.72 },
  { reaction: 0.38, keeper: 0.85 },
  { reaction: 0.24, keeper: 0.92 },
  { reaction: 0.14, keeper: 0.96 },
];

const len = (x: number, y: number) => Math.hypot(x, y);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** how much better-placed an auto-switch candidate must be before control hands
 * over — stops the controlled player flickering during quick passing moves */
const SWITCH_BIAS = 1.6;

interface HumanCtl {
  shootHeldSince: number; // tick when shoot press started, -1 idle
  passHeldSince: number; // tick when pass press started, -1 idle
  aftertouchUntil: number; // tick until which stick steers the last kick
  passTargetIdx: number;
  manualSwitchUntil: number;
  /** next tick the auto-switch is allowed to fire again (cooldown after a swap) */
  autoSwitchAt: number;
  /** tick until which the freshly-controlled player ignores stick input, so a
   * handover doesn't fling him out of position ("pull-out") */
  controlSettleUntil: number;
  /** set-piece power charge: button held at a corner/throw/free kick */
  restartChargeBtn: 'pass' | 'shoot' | null;
  restartChargeSince: number;
}

interface PassChoice {
  aim: Vec2;
  targetIdx: number;
  aerial: boolean;
}

interface PendingOffside {
  defendingTeam: 0 | 1;
  passerIdx: number;
  /** every team-mate in an offside position the instant the ball was played
   * forward; whichever of them touches it first is flagged offside */
  offsideIdxs: number[];
  expires: number;
}

export class MatchSim {
  state: MatchState;
  events: SimEvent[] = [];
  readonly cfg: MatchConfig;
  private rng: Rng;
  private diff;
  /** stoppage time for the current half in seconds; -1 until regulation time elapses */
  private addedTimeSec = -1;
  /** once regulation + stoppage is up, true while we wait for a neutral moment to blow the whistle */
  private awaitingHalfEnd = false;
  /** the tick we started waiting for the half-end whistle, so the clock can crawl during the
   * wait (it looks better than racing minutes past full time) with a real-time backstop */
  private halfEndArmTick = -1;
  /** international-cup drinks break: true once past the half's midpoint, waiting for a dead ball */
  private awaitingHydration = false;
  /** which halves have already had their hydration break (so it fires once each) */
  private hydrationBreakHalves = new Set<number>();
  private prevInputs: [PadInput, PadInput] = [{ ...NULL_INPUT }, { ...NULL_INPUT }];
  private humans: [HumanCtl, HumanCtl] = [
    { shootHeldSince: -1, passHeldSince: -1, aftertouchUntil: -1, passTargetIdx: -1, manualSwitchUntil: -1, autoSwitchAt: 0, controlSettleUntil: 0, restartChargeBtn: null, restartChargeSince: -1 },
    { shootHeldSince: -1, passHeldSince: -1, aftertouchUntil: -1, passTargetIdx: -1, manualSwitchUntil: -1, autoSwitchAt: 0, controlSettleUntil: 0, restartChargeBtn: null, restartChargeSince: -1 },
  ];
  private aiDecideAt = new Map<number, number>(); // playerIdx -> next decision tick
  private shotLive = false; // a shot toward goal is in flight, GK may attempt one save
  private shotLivePrev = false;
  private shotLiveSince = -1; // tick a shot became live, for the keeper reaction window
  private lastSaveTick = -999; // tick of the last save, so the keeper keeps it short after one (sustained pressure)
  private livePassTargetIdx = -1;
  private livePassTargetUntil = -1;
  /** max ball speed at which the locked receiver can still magnetically take the
   * pass — scaled up for driven long balls so a 35m/s diagonal can still be
   * brought down by its target (short passes keep the tighter default). */
  private livePassMaxReceiveSpeed = 28.5;
  /** the live pass was lofted (cross / long ball) — lets the locked receiver take
   * it at chest/header height as it drops, not only once it's at his feet. */
  private livePassLofted = false;
  /** Long aerial balls check up more realistically when they land instead of
   * skidding on like a shot along wet turf. */
  private longAerialSkidUntil = -1;
  /** corner the keeper pre-committed to for an in-match penalty (-1/0/1), null otherwise */
  private penaltyDiveGuess: number | null = null;
  private restartWaitTicks = 0;
  private celebrationTeam: 0 | 1 = 0;
  private scoredGoalSide = 1;
  private pendingOffside: PendingOffside | null = null;
  private wfx: WeatherFx = WEATHER_FX.normal;
  /** stamina-drain multiplier from pitch temperature (1 = mild, >1 in the heat) */
  private heatStaminaMul = 1;
  /** Hidden per-match referee personality (never shown). foulBias <1 lets play
   * flow / >1 whistles more; cardBias scales bookings; accuracy <1 makes the odd
   * missed or phantom call; homeBias tilts decisions toward the home side (team 0). */
  private referee = { foulBias: 1, cardBias: 1, accuracy: 1, homeBias: 0 };
  /** separate RNG for referee-error rolls so they don't shift the main sim sequence */
  private refRng = new Rng(0);
  /** per-team sense of grievance with the referee — grows each time a clear call
   * goes against them (a foul of theirs missed, or a phantom one given against
   * them). When it's high and a decision finally goes their way, the crowd lets
   * out a wave of ironic, sarcastic applause. Reset once they get one. */
  private teamGrievance: [number, number] = [0, 0];
  /** per-team decaying "chance pressure" — drives the dominate-without-scoring frustration */
  private momentumPressure: [number, number] = [0, 0];
  /** a genuine one-on-one shot is in flight (latched at strike) and the team that struck it,
   * consumed once when the shot resolves to a non-goal (save/post/nearMiss/out). */
  private liveShotBigChance = false;
  private liveShotTeam: 0 | 1 | -1 = -1;
  /** match-minute of each team's most recent goal, for the two-quick-goals burst */
  private lastGoalMinute: [number, number] = [-99, -99];
  /** set in scoreGoal just before the goal event is emitted; read by momentumCtx */
  private pendingBurstGoal = false;
  /** match-minute of each team's most recent own red card (−1 = none); and how many
   * 10-minute "held firm" survival rewards have been paid since. */
  private redCardMinute: [number, number] = [-1, -1];
  private redCardRewardBlock: [number, number] = [0, 0];
  /** last match-minute the per-minute momentum context ran (so it fires once a minute) */
  private lastMomentumMinute = 0;
  /** last match-minute the non-contact injury check ran (monotonic gate like lastMomentumMinute) */
  private lastInjuryMinute = 0;
  /** off-ball runs in progress: playerIdx -> run target and expiry tick */
  private forwardRuns = new Map<number, { until: number; target: Vec2 }>();
  /** sticky marking assignments so defenders track a runner instead of flickering */
  private markAssignments = new Map<number, { targetIdx: number; until: number }>();
  /** who each player last received a pass from, to discourage sterile return passes */
  private recentReceivedFrom = new Map<number, { from: number; tick: number }>();
  /** last possession change, for transition (counter-attack) tempo */
  private lastTurnover: { tick: number; team: 0 | 1 } = { tick: -9999, team: 0 };
  private prevLastTouchTeam: 0 | 1 = 0;
  private prevLastKicker = -1;
  private lastTouchTick = 0;
  /** the last DIFFERENT kicker before the current one (a candidate assister), and the
   *  tick at which the current kicker took over from them */
  private lastAssisterIdx = -1;
  private lastAssisterTick = -99999;
  /** low-pass-filtered ball position used for team shape (line height, formation
   * shift) so the block glides with play instead of twitching on every touch */
  private smoothBall: Vec2 = { x: 0, y: 0 };
  /** per-team sticky back-line anchor, as a progress along that team's attack
   * direction. It climbs toward a compact line ~22m behind the smoothed ball
   * while the team is on the ball around/into the opponent half, and decays home
   * over ~1s once possession is genuinely lost. Without this, the back line keyed
   * off the INSTANTANEOUS carrier and collapsed 30m every time a pass was in
   * flight — so defenders sat on their own box edge all game while their team
   * attacked. -HALF_LEN means "no push, sit at the natural defensive line". */
  private blockPush: [number, number] = [-HALF_LEN, -HALF_LEN];
  /** smoothed off-ball AI steering target per player — damps high-frequency
   * target vibration while snapping to genuinely new decisions (see smoothAiAim) */
  private aiAim = new Map<number, Vec2>();
  /** committed "am I chasing this loose ball?" decision per player, so the chase
   * ranking can't flip-flop a man between chasing and holding shape every tick */
  private chaseCommit = new Map<number, { chase: boolean; until: number; ballTeam: 0 | 1 }>();
  /** short goalkeeper close-down commitment, so a keeper who steps out stays big
   * instead of snapping back to his line when the carrier hovers on a threshold */
  private gkRushCommit = new Map<number, { ownerIdx: number; target: Vec2; until: number }>();
  /** low-passed keeper steering target, so his read switching references near the decision
   * boundary (rush=attacker, line=ball, which a dribbler knocks ahead) can't twitch him */
  private gkTargetMemo = new Map<number, Vec2>();
  /** last tick each AI side made a substitution, so the CPU paces its changes */
  private aiLastSubTick: [number, number] = [-99999, -99999];
  /** sticky dribble-dodge side so the carrier commits to a way round a defender */
  private dodgeState = new Map<number, number>();
  /** sticky "open channel" Y per team so runs don't snap between gaps each tick */
  private openChannelMemo = new Map<0 | 1, { y: number; until: number }>();
  /** stable free-kick wall membership/order for the current dead ball */
  private wallCache: { posX: number; posY: number; team: 0 | 1; order: number[] } | null = null;
  /** smoothed shot-stopping line target so the keeper doesn't shimmy on a shot */
  private gkLineY: number | null = null;
  private gkSetY = 0; // the keeper's y when the current shot became live (his set anchor)
  private shotOpenness = 0.7; // 0..1 quality of the live shot's chance (space + finisher), captured at strike
  private shotStruckDist = 14; // distance to goal where the live shot was struck — long shots are lower-quality chances
  /** committed team tactical state per team, so a side's collective mentality
   * (press height, line, tempo) holds for a beat instead of flipping block to
   * block every time the ball drifts across a threshold */
  private tacticalStateMemo: Array<{ state: TeamTacticalState; until: number } | null> = [null, null];
  /** per-player current form (0-100), indexed by SimPlayer.idx; 50 is neutral */
  private formByIdx: number[] = [];

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    // Consistent baseline for everyone — the challenge comes from team/player
    // ATTRIBUTES, not a difficulty setting (which the game no longer exposes).
    this.diff = DIFFICULTY[1];
    this.wfx = WEATHER_FX[cfg.weather ?? 'normal'] ?? WEATHER_FX.normal;
    // hotter pitches tire players faster: ~+1.2% drain per °C above a mild 22°C
    // baseline (so a 36°C scorcher saps ~17% more). Omitted temperature = no heat.
    this.heatStaminaMul = 1 + Math.max(0, (cfg.temperature ?? 18) - 22) * 0.012;
    // pick this match's hidden referee. A triangular roll keeps most refs near
    // normal — the odd lenient/strict/biased one, never a game-ruining extreme.
    this.refRng = new Rng((cfg.seed ^ 0x9e3779b9) >>> 0);
    const mid = () => (this.refRng.next() + this.refRng.next()) / 2; // ~0.5-centred
    this.referee = {
      foulBias: 0.8 + mid() * 0.42,   // ~0.8 (lets play flow) .. ~1.22 (whistles more)
      cardBias: 0.82 + mid() * 0.46,  // ~0.82 .. ~1.28 bookings
      accuracy: 0.87 + mid() * 0.13,  // ~0.87 .. ~1.0; lower = more missed/phantom calls
      homeBias: mid() * 0.2,          // 0 .. ~0.2 tilt toward the home side
    };
    const players: SimPlayer[] = [];
    for (let t = 0 as 0 | 1; t <= 1; t++) {
      const team = cfg.teams[t];
      const slots = FORMATIONS[team.lineup.formation];
      team.lineup.starters.forEach((squadIdx, slotIdx) => {
        const attrs = team.data.players[squadIdx];
        this.formByIdx[players.length] = clamp(team.playerForm?.[squadIdx] ?? 50, 0, 100);
        players.push({
          idx: players.length,
          team: t,
          attrs,
          squadIdx,
          isGK: slotIdx === 0,
          slot: slots[slotIdx],
          pos: { x: 0, y: 0 },
          vel: { x: 0, y: 0 },
          facing: t === 0 ? 0 : Math.PI,
          stamina: 1,
          staminaCeiling: 1,
          control: false,
          yellowCards: 0,
          foulsCommitted: 0,
          sentOff: false,
          kickCooldown: 0,
          slideTimer: 0,
          diving: false,
          diveSide: 0,
          diveKind: null,
          anim: 'idle',
        });
      });
    }
    const initialMomentum: [number, number] = [
      clamp(cfg.initialMomentum?.[0] ?? 0, MATCH_MOMENTUM_MIN, MATCH_MOMENTUM_MAX),
      clamp(cfg.initialMomentum?.[1] ?? 0, MATCH_MOMENTUM_MIN, MATCH_MOMENTUM_MAX),
    ];
    this.state = {
      phase: cfg.startTimeSec !== undefined ? 'play' : 'kickoff',
      tick: 0,
      clock: cfg.startTimeSec ?? 0,
      half: cfg.startHalf ?? 1,
      score: cfg.startScore ? [...cfg.startScore] : [0, 0],
      goals: [],
      ball: {
        pos: { x: 0, y: 0 }, z: 0, vel: { x: 0, y: 0 }, vz: 0, spin: 0,
        kickDir: { x: 0, y: 0 },
        ownerIdx: -1, lastTouchTeam: 0, lastKicker: -1,
      },
      players,
      attackDir: [1, -1],
      restartTeam: 0,
      restartPos: { x: 0, y: 0 },
      restartTimer: cfg.startTimeSec !== undefined ? 0 : 1.2,
      controlledIdx: [-1, -1],
      substitutionsUsed: [0, 0],
      subbedOff: [[], []],
      subbedOn: [[], []],
      penalties: null,
      penaltyAim: 0,
      excitement: 0.3,
      momentum: initialMomentum,
      injuries: [],
      winner: -1,
    };
    this.placeForKickoff(0);
    if (cfg.startTimeSec === undefined) {
      this.events.push({ type: 'kickoff' });
    } else {
      // JOIN IN PROGRESS: a match that begins partway through doesn't restart
      // from the centre — players hold formation and the ball is already live,
      // handed to the chasing side (level → home) so play flows immediately.
      const st = this.state;
      st.phase = 'play';
      st.restartTimer = 0;
      st.restartTeam = 0;
      const chasing: 0 | 1 = st.score[0] < st.score[1] ? 0 : st.score[0] > st.score[1] ? 1 : 0;
      const onBall = st.players.find((p) => p.team === chasing && p.attrs.pos === 'MF' && !p.isGK)
        ?? st.players.find((p) => p.team === chasing && !p.isGK);
      if (onBall) {
        st.ball.pos = { x: onBall.pos.x, y: onBall.pos.y };
        st.ball.ownerIdx = onBall.idx;
        st.ball.lastTouchTeam = chasing;
        st.ball.lastKicker = onBall.idx;
      }
    }
    this.smoothBall = { ...this.state.ball.pos };
    this.blockPush = [-HALF_LEN, -HALF_LEN];
  }

  // ------------------------------------------------------------------ helpers

  maxSubstitutions(): number {
    return Math.max(0, Math.floor(this.cfg.era?.substitutionLimit ?? MAX_SUBSTITUTIONS));
  }

  private isLongAerialKick(speed: number, loft: number): boolean {
    return loft >= LONG_AERIAL_MIN_LOFT && speed >= LONG_AERIAL_MIN_SPEED;
  }

  private longAerialSkidActive(): boolean {
    return this.state.tick <= this.longAerialSkidUntil;
  }

  private clearLongAerialSkid(): void {
    this.longAerialSkidUntil = -1;
  }

  private groundBallSpeedAfterStep(speed: number, step: number, longAerialSkid: boolean): number {
    if (speed <= 0) return 0;
    const friction = BALL_GROUND_FRICTION * this.wfx.ballFriction * (longAerialSkid ? LONG_AERIAL_FRICTION_MULT : 1);
    const rollingDrag = longAerialSkid ? LONG_AERIAL_GROUND_DRAG : 0.4;
    return Math.max(0, speed - (friction + speed * rollingDrag) * step);
  }

  private bounceRestitution(longAerialSkid: boolean): number {
    return longAerialSkid ? LONG_AERIAL_RESTITUTION : BALL_RESTITUTION;
  }

  private momentumAttributeDelta(team: 0 | 1): number {
    return clampMomentum(this.state.momentum?.[team] ?? 0) * MATCH_MOMENTUM_ATTR_SCALE;
  }

  private effectiveAttr(p: SimPlayer, key: 'pace' | 'pass' | 'shoot' | 'tackle' | 'keeping'): number {
    // a player fielded out of his natural position executes his SKILLS worse — passing,
    // finishing, tackling, keeping — but his raw PACE is unaffected (a striker is still
    // quick at the back). In his own role the factor is exactly 1, so a normal lineup is
    // untouched; it only bites when you deliberately sub a man into the wrong slot.
    const knock = key !== 'pace' && p.knockTimer && p.knockTimer > 0 ? INJURY_KNOCK_DIP : 1;
    const fam = key === 'pace' ? 1 : this.positionFamiliarity(p);
    return clamp(p.attrs[key] * fam * knock + this.momentumAttributeDelta(p.team), 1, 100);
  }

  private famCache = new Map<number, { key: string; fam: number }>();

  /** How well a player's natural position suits the SLOT he is in: 1.0 in his own role,
   * down to ~0.6 when played somewhere alien (a striker at centre-back). Drives the
   * out-of-position skill penalty above. Cached until his slot/formation changes. */
  private positionFamiliarity(p: SimPlayer): number {
    const natural = p.attrs.position;
    if (!natural || p.isGK) return 1;
    const formation = this.cfg.teams[p.team].lineup.formation;
    const cacheKey = `${formation}:${p.slot.x},${p.slot.y}`;
    const cached = this.famCache.get(p.idx);
    if (cached && cached.key === cacheKey) return cached.fam;
    const role = this.slotRoleOf(p, formation);
    // a NATURAL interchange (full-back↔wing-back, winger↔wide-forward, central↔holding
    // mid — high positionFit) is treated as in-role, so ordinary lineups are untouched.
    // Only a genuine positional shift bites: a centre-back at full-back ~0.89, and a
    // truly alien slot (a striker at centre-back, fit ~0) bottoms out at ~0.62.
    const fit = positionFit(natural, role);
    const fam = natural === role || fit >= 70
      ? 1
      : clamp(0.62 + 0.38 * (fit / 70), 0.62, 1);
    this.famCache.set(p.idx, { key: cacheKey, fam });
    return fam;
  }

  /** The specific tactical role of the slot a player currently occupies (his home slot
   * is always one of the formation's slots, so match it back by position). */
  private slotRoleOf(p: SimPlayer, formation: FormationId): PlayerPosition {
    const slots = FORMATIONS[formation];
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const d = (slots[i].x - p.slot.x) ** 2 + (slots[i].y - p.slot.y) ** 2;
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    return slotRole(formation, bestIdx);
  }

  private applyMomentum(team: 0 | 1, swing: { self: number; opp: number }): void {
    const opp = (1 - team) as 0 | 1;
    this.state.momentum[team] = clampMomentum(this.state.momentum[team] + swing.self);
    this.state.momentum[opp] = clampMomentum(this.state.momentum[opp] + swing.opp);
  }

  /** Apply a rolled injury to a player: a knock dips his skills briefly (plays on); a
   * forced-off/serious takes him out of the game and records the career layoff. */
  private applyInjury(p: SimPlayer, tier: InjuryTier): void {
    if (tier === 'none' || p.injuredOff || p.sentOff) return;
    if (tier === 'knock') {
      p.knockTimer = Math.max(p.knockTimer ?? 0, INJURY_KNOCK_SECONDS);
      return;
    }
    p.injuredOff = true;
    const matchesOut = injuryMatchesOut(tier, () => this.rng.next());
    this.state.injuries.push({ team: p.team, name: p.attrs.name, matchesOut });
    this.emit({ type: 'injury', team: p.team, player: p.idx });
  }

  private applyEventMomentum(e: SimEvent): void {
    // A spurned genuine one-on-one (latched at strike) resolving to a non-goal swings
    // momentum to the defenders — explicit and immediate, on top of the slow pressure drip.
    if ((e.type === 'save' || e.type === 'post' || e.type === 'nearMiss' || e.type === 'out')
        && this.liveShotBigChance && this.liveShotTeam >= 0) {
      this.applyMomentum(this.liveShotTeam as 0 | 1, { self: -2.0, opp: 1.5 });
      this.liveShotBigChance = false;
      this.liveShotTeam = -1;
    }
    // 'post' carries no team; credit the last touch (the team that hit the woodwork).
    if (e.type === 'post') {
      const attacker = this.state.ball.lastTouchTeam;
      if (attacker === 0 || attacker === 1) {
        this.momentumPressure[attacker] += 1.0;
        this.applyMomentum(attacker, eventMomentumDelta('post', this.momentumCtx(attacker)));
      }
      return;
    }
    if (e.team === undefined) return;
    const team = e.team;
    const opp = (1 - team) as 0 | 1;
    // chance-pressure bookkeeping (drives frustration in updateMomentumContext).
    // NB a 'save' event's team is the DEFENDING side, so the chance belongs to opp.
    if (e.type === 'shot' || e.type === 'header') this.momentumPressure[team] += 0.6;
    else if (e.type === 'save') this.momentumPressure[opp] += 1.0;
    else if (e.type === 'goal') this.momentumPressure[team] = 0; // scorer is relieved
    if (e.type === 'redCard') {
      this.redCardMinute[team] = this.matchMinute();   // start/reset the survival clock
      this.redCardRewardBlock[team] = 0;
    } else if (e.type === 'goal' && this.redCardMinute[opp] >= 0) {
      // a man-down team that concedes restarts its survival clock
      this.redCardMinute[opp] = this.matchMinute();
      this.redCardRewardBlock[opp] = 0;
    }
    const ctx = this.momentumCtx(team);
    ctx.power = e.power ?? 0;
    ctx.danger = !!e.danger;
    this.applyMomentum(team, eventMomentumDelta(e.type, ctx));
  }

  /** Per-tick momentum context: decay toward neutral, plus the per-minute contextual
   * triggers. Cheap; the per-minute work is gated so it runs once each match-minute. */
  private updateMomentumContext(): void {
    const st = this.state;
    if (st.phase !== 'play') return;
    const minute = this.matchMinute();
    if (minute <= this.lastMomentumMinute) return;
    this.lastMomentumMinute = minute;
    for (const t of [0, 1] as const) {
      // decay toward 0 — half-life ≈ 5 match-minutes (0.87^5 ≈ 0.50)
      st.momentum[t] = clampMomentum(st.momentum[t] * 0.87);
      // pressure relaxes too
      this.momentumPressure[t] *= 0.78;
      const opp = (1 - t) as 0 | 1;
      const u = underdogFactor(this.cfg.teams[t].data.strength, this.cfg.teams[opp].data.strength);
      // a clear underdog that is not losing gains belief the longer it holds — bigger gap
      // and later in the game drip faster. Decay bounds the steady-state (~+1.5..2).
      if (u >= 0.3 && st.score[t] >= st.score[opp]) {
        st.momentum[t] = clampMomentum(st.momentum[t] + 0.12 * u * (1 + minute / 90));
      }
      // dominating but not scoring: high un-converted chance-pressure while level-or-behind
      // bleeds belief from the dominant side and lifts the side weathering it.
      if (this.momentumPressure[t] > 4 && st.score[t] <= st.score[opp]) {
        const frustration = Math.min(0.5, (this.momentumPressure[t] - 4) * 0.1);
        st.momentum[t] = clampMomentum(st.momentum[t] - frustration);
        st.momentum[opp] = clampMomentum(st.momentum[opp] + frustration * 0.5);
      }
      // backs to the wall: still a man down and held firm for another 10 minutes
      const menDown = st.players.filter((p) => p.team === t && p.sentOff).length;
      if (menDown > 0 && this.redCardMinute[t] >= 0) {
        const blocks = Math.floor((minute - this.redCardMinute[t]) / 10);
        if (blocks > this.redCardRewardBlock[t]) {
          this.redCardRewardBlock[t] = blocks;
          st.momentum[t] = clampMomentum(st.momentum[t] + 3 * Math.pow(0.7, blocks - 1));
        }
      }
    }
  }

  /** Once per match-minute: a tired outfielder late in the game can pull up with a
   * non-contact injury. Very rare. A forced-off one stops play so a sub is legal. */
  private checkNonContactInjuries(): void {
    const st = this.state;
    if (st.phase !== 'play') return;
    const minute = this.matchMinute();
    if (minute <= this.lastInjuryMinute || minute <= 60) return;
    this.lastInjuryMinute = minute;
    for (const p of st.players) {
      if (p.isGK || p.sentOff || p.injuredOff || p.stamina >= 0.35) continue;
      const tier = rollInjury({ contactSeverity: 0, fromBehind: false, nonContact: true, rng: () => this.rng.next() });
      if (tier === 'none') continue;
      if (tier === 'knock') { this.applyInjury(p, tier); continue; }
      this.applyInjury(p, tier);                 // forcedOff/serious → stop play so a sub is legal
      this.awardFreeKick(p.team, st.ball.pos, 'foul'); // drop-ball-style stoppage to the injured side
      break;                                     // at most one per minute
    }
  }

  /** Build the pure-function context for the event's team. */
  private momentumCtx(team: 0 | 1): MomentumEventCtx {
    const opp = (1 - team) as 0 | 1;
    return {
      minute: this.matchMinute(),
      scoreDiffAfter: this.state.score[team] - this.state.score[opp],
      momentumGap: this.state.momentum[team] - this.state.momentum[opp],
      underdog: underdogFactor(this.cfg.teams[team].data.strength, this.cfg.teams[opp].data.strength),
      power: 0,
      danger: false,
      burstGoal: this.pendingBurstGoal,
    };
  }

  changeFormation(team: 0 | 1, formation: FormationId): boolean {
    const slots = FORMATIONS[formation];
    if (!slots) return false;
    const active = this.state.players.filter((p) => p.team === team);
    if (active.length < 11) return false;
    const activeOrder = autoLineup(active.map((p) => p.attrs), formation);
    const ordered = activeOrder
      .map((idx) => active[idx])
      .filter((p): p is SimPlayer => !!p);
    for (const p of active) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    ordered.slice(0, 11).forEach((p, slotIdx) => {
      p.slot = slots[slotIdx];
      p.isGK = slotIdx === 0;
    });
    this.cfg.teams[team].lineup.formation = formation;
    this.cfg.teams[team].lineup.starters = ordered.slice(0, 11).map((p) => p.squadIdx);
    this.cfg.teams[team].lineup.tactics = normalizeTactics(this.cfg.teams[team].lineup.tactics, formation);
    this.aiAim.clear();
    this.chaseCommit.clear();
    this.gkRushCommit.clear();
    this.gkTargetMemo.clear();
    return true;
  }

  /** Swap two on-pitch outfield players' formation positions — they trade slots so
   * one drops into the other's role (e.g. a midfielder to the back line). Costs no
   * substitution. The goalkeeper cannot be shuffled into an outfield role. */
  swapPositions(team: 0 | 1, idxA: number, idxB: number): boolean {
    const st = this.state;
    if (idxA === idxB) return false;
    const a = st.players[idxA];
    const b = st.players[idxB];
    if (!a || !b || a.team !== team || b.team !== team) return false;
    if (a.isGK || b.isGK || a.sentOff || b.sentOff) return false;
    // trade home slots (clone so neither keeps a shared formation-slot reference)
    const sa = { x: a.slot.x, y: a.slot.y };
    a.slot = { x: b.slot.x, y: b.slot.y };
    b.slot = sa;
    // keep the lineup's slotIdx -> squadIdx mapping consistent with the new slots
    const starters = this.cfg.teams[team].lineup.starters;
    const ia = starters.indexOf(a.squadIdx);
    const ib = starters.indexOf(b.squadIdx);
    if (ia >= 0 && ib >= 0) { starters[ia] = b.squadIdx; starters[ib] = a.squadIdx; }
    // let them re-home cleanly to their new roles
    this.aiAim.delete(a.idx);
    this.aiAim.delete(b.idx);
    return true;
  }

  changeTactics(team: 0 | 1, tactics: TeamTactics): boolean {
    if (!this.cfg.teams[team]) return false;
    this.cfg.teams[team].lineup.tactics = normalizeTactics(tactics, this.cfg.teams[team].lineup.formation);
    this.state.momentum[team] = clampMomentum(this.state.momentum[team] * 0.55);
    this.aiAim.clear();
    this.tacticalStateMemo[team] = null;
    return true;
  }

  private emit(e: SimEvent) {
    this.applyEventMomentum(e);
    this.events.push(e);
  }

  private emitPass(passer: SimPlayer, targetIdx: number, power: number) {
    if (targetIdx < 0) return;
    const target = this.state.players[targetIdx];
    if (!target || target.team !== passer.team || target.sentOff) return;
    this.emit({ type: 'pass', team: passer.team, player: passer.idx, target: target.idx, power });
  }

  private attackSign(team: 0 | 1): number {
    return this.state.attackDir[team];
  }

  private ownGoalDir(team: 0 | 1): number {
    return -this.attackSign(team);
  }

  private teamTacticalState(team: 0 | 1): TeamTacticalState {
    // Attacking and emergency states must respond instantly (a counter or a
    // ball in our box can't wait), but the steady defensive blocks are held for
    // a beat so the side doesn't flip mentality the moment the ball nudges over
    // a line. We compute the raw state, then keep the previous block unless the
    // new read is an urgent one or the hold window has elapsed.
    const raw = this.computeTacticalState(team);
    const urgent = raw === 'fastBreak' || raw === 'settledAttack' || raw === 'buildUp' || raw === 'emergencyDefend';
    if (urgent) { this.tacticalStateMemo[team] = null; return raw; }
    const memo = this.tacticalStateMemo[team];
    if (memo && memo.until > this.state.tick) return memo.state;
    this.tacticalStateMemo[team] = { state: raw, until: this.state.tick + Math.round(0.7 / DT) };
    return raw;
  }

  private computeTacticalState(team: 0 | 1): TeamTacticalState {
    const owner = this.owner();
    const ball = this.state.ball;
    const sample = owner?.pos ?? ball.pos;
    const minute = this.matchMinute();
    const goalDiff = this.state.score[team] - this.state.score[1 - team];
    const identity = this.teamIdentity(team);

    if (owner?.team === team) {
      if (this.inTransition(team)) return 'fastBreak';
      const progress = owner.pos.x * this.attackSign(team);
      return progress < -HALF_LEN / 4 ? 'buildUp' : 'settledAttack';
    }

    // A chasing side throws caution aside from the hour mark; a genuinely
    // front-foot side will also press high while the game is level. The press
    // STATE stays situational (so the block can't camp on the ball) — a team's
    // character is expressed through mentality numbers, not by forcing a state.
    const wantsHighPress = (goalDiff < 0 && minute >= 60)
      || (identity.aggression > 0.5 && goalDiff === 0 && minute >= 55);

    if (!owner) {
      if (ball.lastTouchTeam === team && this.inTransition(team)) return 'fastBreak';
      if (goalDiff > 0 && minute >= 72) return 'lowBlock';
      if (wantsHighPress) return 'highPress';
      return 'midBlock';
    }

    const defensiveProgress = sample.x * this.ownGoalDir(team);
    if (defensiveProgress > HALF_LEN - 22) return 'emergencyDefend';
    if (goalDiff > 0 && minute >= 72) return 'lowBlock';
    if (wantsHighPress && defensiveProgress < HALF_LEN - 20) return 'highPress';
    if (defensiveProgress > HALF_LEN - 34) return 'lowBlock';
    return 'midBlock';
  }

  private teamMentality(team: 0 | 1): TeamMentality {
    const state = this.teamTacticalState(team);
    const base = TEAM_MENTALITY_BASE[state];
    const id = this.teamIdentity(team);
    const tactics = this.teamTactics(team);
    const mentalityRisk = tactics.mentality === 'attacking' ? 0.12 : tactics.mentality === 'defensive' ? -0.12 : 0;
    const mentalityTempo = tactics.mentality === 'attacking' ? 0.07 : tactics.mentality === 'defensive' ? -0.06 : 0;
    const pressAdjust = tactics.pressing === 'high' ? 1 : tactics.pressing === 'low' ? -1 : 0;
    const buildTempo = tactics.buildUp === 'direct' ? 0.08 : tactics.buildUp === 'patient' ? -0.06 : 0;
    const widthAdjust = ((tactics.width - 50) / 50) * 0.08;
    // a side's own character colours the situational base: a strong, front-foot
    // team presses higher and plays with more risk in any state, a cautious one
    // sits deeper — so two teams in the same formation/scoreline still differ
    return {
      risk: clamp(base.risk + id.risk + mentalityRisk, 0.6, 1.5),
      tempo: clamp(base.tempo + id.tempo + mentalityTempo + buildTempo, 0.8, 1.4),
      // line height is left to the situational state (whose press/block
      // behaviour is calibrated and tested); identity colours intent, not the
      // raw line offset, whose semantics here are pressure-relative
      lineBias: base.lineBias,
      // only a very cautious side drops a presser (sits an extra man back); we
      // never ADD pressers off identity, so the block can't crowd the carrier
      pressLimit: clamp(base.pressLimit + pressAdjust + (id.aggression < -0.5 ? -1 : 0), 1, 4),
      supportWidth: clamp(base.supportWidth + id.width + widthAdjust, 0.8, 1.35),
    };
  }

  /**
   * A team's intrinsic playing character, derived from its data (no extra
   * authoring needed): strength plus how attacking its formation is. aggression
   * runs roughly -1 (sit-deep, cautious) .. +1 (front-foot, high press). This is
   * what makes different teams play recognisably different football beyond their
   * raw player quality.
   */
  private teamIdentity(team: 0 | 1): { aggression: number; risk: number; tempo: number; width: number } {
    const data = this.cfg.teams[team].data;
    const tactic = this.teamTacticProfile(team);
    const strength = clamp((data.strength - 76) / 16, -1, 1);
    const formationLean = (tactic.directness - 0.5) + (0.5 - tactic.defensiveCover) * 0.8 + (tactic.width - 0.5) * 0.4;
    const aggression = clamp(strength * 0.7 + formationLean, -1, 1);
    return {
      aggression,
      risk: aggression * 0.1,
      tempo: aggression * 0.06,
      width: aggression * 0.05,
    };
  }

  private teamTacticProfile(team: 0 | 1): TeamTacticProfile {
    const formation = this.cfg.teams[team].lineup.formation;
    const base = FORMATION_TACTIC_PROFILES[formation] ?? DEFAULT_TACTIC_PROFILE;
    const tactics = this.teamTactics(team);
    const widthTarget = 0.28 + (tactics.width / 100) * 0.64;
    const depth = tactics.defensiveDepth / 100;
    const mentality = tactics.mentality === 'attacking' ? 1 : tactics.mentality === 'defensive' ? -1 : 0;
    const pressing = tactics.pressing === 'high' ? 1 : tactics.pressing === 'low' ? -1 : 0;
    const build = tactics.buildUp === 'direct' ? 1 : tactics.buildUp === 'patient' ? -1 : 0;
    const width = clamp(base.width * 0.4 + widthTarget * 0.6, 0.24, 0.94);
    return {
      width,
      switchPlay: clamp(base.switchPlay + (width - base.width) * 0.35 + (build === -1 ? -0.04 : 0.04 * build), 0.2, 0.9),
      centralOverload: clamp(base.centralOverload + (0.5 - (width - 0.5)) * 0.08 + (tactics.width < 45 ? 0.08 : 0), 0.2, 0.9),
      defensiveCover: clamp(base.defensiveCover + (0.5 - depth) * 0.45 - mentality * 0.08 - pressing * 0.04, 0.18, 0.94),
      pivotDepth: clamp(base.pivotDepth + (0.5 - depth) * 0.14 + (build === -1 ? 0.08 : 0) + (mentality < 0 ? 0.04 : 0), 0.2, 0.9),
      directness: clamp(base.directness + build * 0.14 + mentality * 0.06 + (tactics.width > 70 ? 0.04 : 0), 0.24, 0.9),
    };
  }

  private teamTactics(team: 0 | 1): TeamTactics {
    const lineup = this.cfg.teams[team].lineup;
    return normalizeTactics(lineup.tactics, lineup.formation);
  }

  private isCentreBack(p: SimPlayer): boolean {
    return p.attrs.pos === 'DF' && Math.abs(p.slot.y) < 0.52;
  }

  private attackingCentreBackProgressCap(team: 0 | 1): number {
    const dir = this.attackSign(team);
    const identity = this.teamIdentity(team);
    const tactic = this.teamTacticProfile(team);
    const halfwayAllowance = clamp(
      identity.aggression * 3.2
        + (tactic.directness - 0.5) * 3.0
        - Math.max(0, tactic.defensiveCover - 0.55) * 2.2,
      0,
      5.2,
    );
    let lastOnsideCounter = Infinity;
    for (const q of this.state.players) {
      if (q.team === team || q.isGK || q.sentOff) continue;
      const progress = q.pos.x * dir;
      if (progress <= 0) continue; // over halfway into our half: offside, so do not pin the line back
      const counterAttacker = q.attrs.pos === 'FW'
        || (q.attrs.pos === 'MF' && progress < HALF_LEN - 18);
      if (counterAttacker && progress < lastOnsideCounter) lastOnsideCounter = progress;
    }
    if (lastOnsideCounter < Infinity) {
      const caution = clamp(
        1.7 - identity.aggression * 1.1 + Math.max(0, tactic.defensiveCover - 0.5) * 2.4,
        0.45,
        3.0,
      );
      return Math.min(lastOnsideCounter, Math.max(halfwayAllowance, lastOnsideCounter - caution));
    }
    return halfwayAllowance;
  }

  private playerRole(p: SimPlayer): PlayerRole {
    if (p.isGK || p.attrs.pos === 'GK') return 'keeper';
    const a = p.attrs;
    // the player's SPECIFIC position drives his playing role (so he acts like a
    // wing-back / holding mid / inside-forward etc.). The two-flavour roles still
    // split on attributes (a quick CB covers, a slow one stops; a getting-forward FB
    // overlaps). Falls back to the legacy slot+attribute inference for any player
    // without a position (older/custom squads).
    switch (a.position) {
      case 'GK': return 'keeper';
      case 'CB': return a.pace >= Math.max(80, a.tackle + 12) ? 'coverCentreBack' : 'stopperCentreBack';
      case 'FB': return a.pace + a.pass > a.tackle + 70 ? 'overlapFullBack' : 'defensiveFullBack';
      case 'WB': return 'overlapFullBack';
      case 'DM': return 'holdingMidfielder';
      case 'CM': return 'boxToBoxMidfielder';
      case 'AM': return 'playmaker';
      case 'W': return 'wideMidfielder';
      case 'WF': return 'wideForward';
      case 'ST': return a.shoot >= a.pace + 6 ? 'poacher' : 'targetForward';
    }
    const wideSlot = Math.abs(p.slot.y);
    if (a.pos === 'DF') {
      if (wideSlot > 0.52) {
        return a.pace + a.pass > a.tackle + 70 ? 'overlapFullBack' : 'defensiveFullBack';
      }
      return a.pace >= Math.max(80, a.tackle + 12) ? 'coverCentreBack' : 'stopperCentreBack';
    }
    if (a.pos === 'MF') {
      if (wideSlot > 0.52) return 'wideMidfielder';
      if (a.tackle >= a.pass + 12 || (p.slot.x < -0.28 && a.tackle >= a.shoot + 18)) {
        return 'holdingMidfielder';
      }
      if (a.pass >= Math.max(a.tackle, a.shoot) + 14) return 'playmaker';
      return 'boxToBoxMidfielder';
    }
    if (wideSlot > 0.48) return 'wideForward';
    return a.shoot >= a.pace + 6 ? 'poacher' : 'targetForward';
  }

  private playerDecisionProfile(p: SimPlayer): PlayerDecisionProfile {
    const role = this.playerRole(p);
    const stamina = clamp(p.stamina, 0, 1);
    const attrPass = (p.attrs.pass - 60) / 100;
    const attrPace = (p.attrs.pace - 60) / 100;
    const attrShoot = (p.attrs.shoot - 60) / 100;
    const attrTackle = (p.attrs.tackle - 60) / 100;
    const slotWidth = clamp(Math.abs(p.slot.y), 0, 1);
    const profile = ROLE_DECISION_BASE[role];
    const mentality = this.teamMentality(p.team);
    return {
      passUrgency: clamp(profile.passUrgency + attrPass * 0.28 + (mentality.tempo - 1) * 0.08, 0.04, 1),
      carryBias: clamp(profile.carryBias + attrPace * 0.24 - (1 - stamina) * 0.18, 0.04, 1),
      shootAggression: clamp(profile.shootAggression + attrShoot * 0.34 + (mentality.risk - 1) * 0.12, 0.02, 1),
      wideCarry: clamp(profile.wideCarry + slotWidth * 0.24 + attrPace * 0.12, 0.02, 1),
      defensiveScreen: clamp(profile.defensiveScreen + attrTackle * 0.22 - Math.max(0, mentality.risk - 1) * 0.08, 0.02, 1),
      pressBias: clamp(profile.pressBias + attrTackle * 0.18 + attrPace * 0.12 + Math.max(0, mentality.risk - 1) * 0.18, 0.02, 1),
    };
  }

  private firstTouchOutcome(p: SimPlayer, incomingSpeed: number, fromOpponent: boolean): FirstTouchOutcome {
    const pressureDist = this.nearestOpponentDist(p);
    const composure = clamp((
      this.effectiveAttr(p, 'pass') * 0.5
      + this.effectiveAttr(p, 'pace') * 0.22
      + (p.attrs.pos === 'DF' ? this.effectiveAttr(p, 'tackle') * 0.2 : this.effectiveAttr(p, 'shoot') * 0.1)
      + p.stamina * 8
    ) / 100 * this.formFactor(p), 0, 1);
    const pressureLoad = pressureDist < 1.8
      ? 0.34
      : pressureDist < 3.2
        ? 0.22
        : pressureDist < 5
          ? 0.11
          : 0;
    const speedLoad = clamp((incomingSpeed - 8.5) / 19, 0, 1) * 0.28;
    const opponentLoad = fromOpponent ? 0.13 : 0;
    const security = composure - pressureLoad - speedLoad - opponentLoad;
    return {
      loose: security < 0.28 && incomingSpeed > 7.5,
      push: clamp((0.52 - security) * 0.82, 0, 0.72),
    };
  }

  private duelScore(challenger: SimPlayer, carrier: SimPlayer): number {
    const challenge = (
      this.effectiveAttr(challenger, 'tackle') * 0.48
      + this.effectiveAttr(challenger, 'pace') * 0.24
      + this.effectiveAttr(challenger, 'pass') * 0.08
      + challenger.stamina * 20
    ) / 100 * this.formFactor(challenger);
    const control = (
      this.effectiveAttr(carrier, 'pace') * 0.34
      + this.effectiveAttr(carrier, 'pass') * 0.3
      + this.effectiveAttr(carrier, 'shoot') * 0.14
      + this.effectiveAttr(carrier, 'tackle') * 0.08
      + carrier.stamina * 14
    ) / 100 * this.formFactor(carrier);
    return clamp(challenge - control, -1, 1);
  }

  private spillLooseFirstTouch(p: SimPlayer, incomingSpeed: number, outcome: FirstTouchOutcome) {
    const ball = this.state.ball;
    const speed = len(ball.vel.x, ball.vel.y);
    const dirX = speed > 0.05 ? ball.vel.x / speed : ball.kickDir.x || this.attackSign(p.team);
    const dirY = speed > 0.05 ? ball.vel.y / speed : ball.kickDir.y || 0;
    const nx0 = ball.pos.x - p.pos.x;
    const ny0 = ball.pos.y - p.pos.y;
    const nd = len(nx0, ny0);
    const nx = nd > 0.05 ? nx0 / nd : dirX;
    const ny = nd > 0.05 ? ny0 / nd : dirY;
    const spillSpeed = clamp(2.8 + incomingSpeed * 0.16 + outcome.push * 6.6, 3.2, 9.4);
    ball.ownerIdx = -1;
    ball.vel.x = dirX * spillSpeed + p.vel.x * 0.22;
    ball.vel.y = dirY * spillSpeed + p.vel.y * 0.22;
    ball.vz = 0;
    ball.z = Math.min(ball.z, 0.1);
    ball.spin *= 0.15;
    ball.lastTouchTeam = p.team;
    ball.lastKicker = p.idx;
    ball.pos.x = clamp(p.pos.x + nx * (PLAYER_RADIUS + BALL_RADIUS + 0.08), -HALF_LEN + 0.25, HALF_LEN - 0.25);
    ball.pos.y = clamp(p.pos.y + ny * (PLAYER_RADIUS + BALL_RADIUS + 0.08), -HALF_WID + 0.25, HALF_WID - 0.25);
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    this.pendingOffside = null;
    if (!p.isGK) this.shotLive = false;
  }

  private autoFaceGoalIfSpace(p: SimPlayer) {
    if (p.isGK) return;
    let hasSpace = true;
    for (const q of this.state.players) {
      if (q.team !== p.team && !q.sentOff && dist(p.pos, q.pos) < 5.0) {
        hasSpace = false;
        break;
      }
    }
    if (hasSpace) {
      const goalDir = this.attackSign(p.team);
      p.facing = Math.atan2(0 - p.pos.y, goalDir * HALF_LEN - p.pos.x);
    }
  }

  /** formation slot -> pitch coords for a team */
  private slotToPitch(team: 0 | 1, slot: Vec2): Vec2 {
    const dir = this.attackSign(team);
    return { x: slot.x * HALF_LEN * dir, y: slot.y * HALF_WID * (dir > 0 ? 1 : -1) * -1 * -1 + 0 * dir + slot.y * 0 };
  }

  /**
   * Form multiplier in roughly [0.85, 1.12]: an out-of-form player feels a yard
   * slower and a touch less sharp, an in-form one is buzzing. Centred on 1.0 at
   * the neutral form of 50 so default matches are unchanged.
   */
  private formFactor(p: SimPlayer): number {
    const form = this.formByIdx[p.idx] ?? 50;
    return clamp(0.86 + (form / 100) * 0.28, 0.82, 1.16);
  }

  /** Team quality normalized to [-1, 1] (0 ≈ an average international side, strength 76). */
  private teamQuality(team: 0 | 1): number {
    return clamp((this.cfg.teams[team].data.strength - 76) / 16, -1, 1);
  }

  /** A ball-carrier's decision quality, blending team rating with own attributes, in [-1, 1]. */
  private decisionQuality(p: SimPlayer): number {
    const team = this.teamQuality(p.team);
    const ownAttr = (p.attrs.pass + p.attrs.pace + (p.attrs.pos === 'FW' ? p.attrs.shoot : p.attrs.tackle)) / 3;
    const attr = clamp((ownAttr - 68) / 24, -1, 1);
    return clamp(team * 0.6 + attr * 0.4, -1, 1);
  }

  /** AI re-evaluation interval (seconds). Elite carriers read the game almost instantly
   * (~0.06s ≈ 4 ticks); poor sides visibly hesitate (~0.32s ≈ 19 ticks). */
  private aiReactionBase(p: SimPlayer): number {
    return clamp(0.19 - this.decisionQuality(p) * 0.13, 0.06, 0.34);
  }

  /** Endurance multiplier (≈0.74..1.08). No dedicated stamina attribute exists,
   * so it is derived from age — endurance peaks in the early/mid 20s and tails
   * off into the 30s — nudged by squad quality (elite sides are fitter). Higher
   * means the player tires slower and recovers more of his ceiling. */
  private staminaFitness(p: SimPlayer): number {
    const age = p.attrs.age || 26;
    let f = 1;
    if (age > 28) f -= (age - 28) * 0.02;        // 33 → 0.90, 36 → 0.84
    else if (age < 21) f -= (21 - age) * 0.012;  // 18 → ~0.96
    f *= 1 + this.teamQuality(p.team) * 0.06;
    return clamp(f, 0.74, 1.08);
  }

  /**
   * Two-pool stamina, the way the old PES/ISS games modelled it:
   *  - `stamina` is the SHORT-TERM bar. It dips while sprinting/working hard and
   *    recovers quickly when the player eases off — but only up to `staminaCeiling`.
   *  - `staminaCeiling` is LONG-TERM condition. It erodes across the match (fastest
   *    when sprinting) and never recovers in open play, so late on a player can rest
   *    yet still not get back to full. Half time hands some of it back.
   * Erosion is scaled to the configured half length so the end-of-match fatigue
   * arc feels the same whether a half is 90s or 360s. Fitter (younger/elite)
   * players tire slower and recover faster; keepers barely expend anything.
   */
  private updateStamina(p: SimPlayer, sprint: boolean, v: number) {
    const fit = this.staminaFitness(p);
    if (p.isGK) {
      p.stamina = Math.min(p.staminaCeiling, p.stamina + 0.05 * DT);
      p.staminaCeiling = Math.max(0.6, p.staminaCeiling - 0.0004 * DT);
      return;
    }
    const jogSpeed = this.maxSpeed(p, false);
    const sprinting = sprint && v > 1;
    const working = v > jogSpeed * 0.66; // running hard, not flat out
    // ONLY a flat-out sprint drains the short-term bar; the moment a player eases
    // off he recovers (slower if still running hard, fast when he stands), so he
    // can never bleed to empty just by jogging around.
    if (sprinting) {
      p.stamina = Math.max(0, p.stamina - (0.026 / fit) * this.heatStaminaMul * DT);
    } else {
      const rec = (v < 0.5 ? 0.06 : working ? 0.02 : 0.04) * fit;
      p.stamina = Math.min(p.staminaCeiling, p.stamina + rec * DT);
    }
    // long-term condition erodes with exertion (fastest at a sprint) and never
    // recovers in open play; scaled to the half length so the fatigue arc fits
    // the match (tuned at the 150s default). Heat erodes it faster too.
    const lenScale = clamp(150 / clamp(this.cfg.halfLengthSec, 60, 600), 0.45, 2.4);
    const erode = (sprinting ? 0.0020 : working ? 0.0008 : 0.00035) / fit * this.heatStaminaMul;
    p.staminaCeiling = Math.max(0.5, p.staminaCeiling - erode * lenScale * DT);
  }

  /** Half-time rest: top the short-term bar back up and hand back a slice of the
   * long-term condition (a breather helps, but never fully undoes the match). */
  private halfTimeRecovery() {
    for (const p of this.state.players) {
      if (p.sentOff) continue;
      p.staminaCeiling = Math.min(1, p.staminaCeiling + 0.14);
      p.stamina = Math.min(p.staminaCeiling, p.stamina + 0.55);
    }
  }

  private maxSpeed(p: SimPlayer, sprinting: boolean): number {
    const base = 6.15 + p.attrs.pace * 0.028; // quicker arcade pace
    const stam = 0.82 + 0.18 * p.stamina;
    // form nudges sharpness within ~±5% so the carrier/chaser feels it without
    // overpowering raw pace
    const form = 1 + (this.formFactor(p) - 1) * 0.45;
    return base * stam * (sprinting ? 1.34 : 1) * this.wfx.maxSpeed * form;
  }

  private acceleration(p: SimPlayer, sprinting: boolean): number {
    const pace = clamp(p.attrs.pace, 0, 100);
    const stam = 0.86 + 0.14 * p.stamina;
    return (22 + pace * 0.16) * stam * (sprinting ? 1.08 : 1);
  }

  private owner(): SimPlayer | null {
    const o = this.state.ball.ownerIdx;
    const p = o >= 0 ? this.state.players[o] : null;
    return p && !p.sentOff && !p.injuredOff ? p : null;
  }

  // ------------------------------------------------------------------- setup

  private placeForKickoff(takerTeam: 0 | 1) {
    const st = this.state;
    st.ball.pos = { x: 0, y: 0 };
    st.ball.z = 0;
    st.ball.vel = { x: 0, y: 0 };
    st.ball.vz = 0;
    st.ball.spin = 0;
    st.ball.kickDir = { x: 0, y: 0 };
    st.ball.ownerIdx = -1;
    st.restartTeam = takerTeam;
    st.restartPos = { x: 0, y: 0 };
    for (const p of st.players) {
      const home = this.slotToPitch(p.team, p.slot);
      // pull everyone into their own half for kickoff
      const dir = this.attackSign(p.team);
      home.x = dir > 0 ? Math.min(home.x, -1) : Math.max(home.x, 1);
      p.pos = { ...home };
      p.vel = { x: 0, y: 0 };
      p.slideTimer = 0;
      p.facing = dir > 0 ? 0 : Math.PI;
    }
    // two kickoff takers from restart team at the spot
    const takers = st.players
      .filter((p) => p.team === takerTeam && !p.isGK && !p.sentOff)
      .sort((a, b) => dist(a.pos, { x: 0, y: 0 }) - dist(b.pos, { x: 0, y: 0 }))
      .slice(0, 2);
    if (takers[0]) takers[0].pos = { x: this.attackSign(takerTeam) * -0.8, y: 0.4 };
    if (takers[1]) takers[1].pos = { x: this.attackSign(takerTeam) * -2.2, y: -3.5 };
    st.phase = 'kickoff';
    st.restartTimer = 1.0;
    this.shotLive = false;
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    this.pendingOffside = null;
    this.gkRushCommit.clear();
    this.gkTargetMemo.clear();
    this.enforceRestartSpacing();
  }

  // -------------------------------------------------------------------- step

  step(inputs: [PadInput, PadInput]) {
    const st = this.state;
    this.events = [];
    st.tick++;

    const ball = st.ball;
    if (ball.lastTouchTeam !== this.prevLastTouchTeam || ball.lastKicker !== this.prevLastKicker) {
      // when the kicker changes, the outgoing kicker is the last DIFFERENT kicker —
      // remember them as a candidate assister for the next goal scored by the new owner
      if (ball.lastKicker !== this.prevLastKicker && this.prevLastKicker >= 0) {
        this.lastAssisterIdx = this.prevLastKicker;
        this.lastAssisterTick = st.tick;
      }
      this.lastTouchTick = st.tick;
      this.prevLastTouchTeam = ball.lastTouchTeam;
      this.prevLastKicker = ball.lastKicker;
    }
    // held flag only means anything while a keeper actually owns the ball
    if (ball.held && (ball.ownerIdx < 0 || !st.players[ball.ownerIdx]?.isGK)) ball.held = false;

    // glide the team-shape reference toward the ball; snap on dead balls and on
    // teleports (restart resets, goals) so the block never lags a long way behind
    if (st.phase !== 'play' || dist(this.smoothBall, ball.pos) > 14) {
      this.smoothBall.x = ball.pos.x;
      this.smoothBall.y = ball.pos.y;
    } else {
      this.smoothBall.x += (ball.pos.x - this.smoothBall.x) * 0.16;
      this.smoothBall.y += (ball.pos.y - this.smoothBall.y) * 0.16;
    }

    // sticky attacking-block anchor (see blockPush). A loose ball mid-attack is
    // still "ours" via lastTouchTeam, so the line keeps its height while passes
    // are in flight instead of snapping home and starting the climb over again.
    {
      const owner = ball.ownerIdx >= 0 ? st.players[ball.ownerIdx] : null;
      for (const t of [0, 1] as const) {
        const dir = this.attackSign(t);
        // we keep the initiative while we carry the ball OR while it is loose and
        // we touched it last (a pass in flight is still our move). Only the OTHER
        // side actually carrying the ball is a turnover that drops our line.
        const hasInit = owner ? owner.team === t && !owner.isGK : ball.lastTouchTeam === t;
        const oppCarries = !!owner && owner.team !== t && !owner.isGK;
        const ballProg = this.smoothBall.x * dir;
        const desired = ballProg - 20; // compact line ~20m behind the ball
        if (st.phase === 'play' && hasInit && ballProg > -10 && desired > this.blockPush[t]) {
          this.blockPush[t] += (desired - this.blockPush[t]) * 0.14; // climb (~0.25s)
        } else if (oppCarries || st.phase !== 'play') {
          this.blockPush[t] = Math.max(-HALF_LEN, this.blockPush[t] - 38 * DT); // drop fast on a real turnover (~0.7s) so a high line isn't countered
        }
        // else: ball loose and last touch was ours — HOLD the line; don't slide
        // home just because a pass is in the air between our players.
        this.blockPush[t] = clamp(this.blockPush[t], -HALF_LEN, HALF_LEN - 30);
        // Cap the line at the deepest opposition outfielder: never step beyond a
        // forward who is hanging back, or he is left in behind with the whole
        // pitch to run into when the ball turns over. Only a clearly STRONGER side
        // (positive quality edge) steps a few metres past him to squeeze a high
        // line; an equal or weaker side holds level with / just goal-side of him.
        // This is why a striker loitering on halfway is as high as the line goes.
        let deepestOpp = HALF_LEN - 30;
        for (const q of st.players) {
          if (q.team === t || q.isGK || q.sentOff) continue;
          const prog = q.pos.x * dir;
          if (prog < deepestOpp) deepestOpp = prog;
        }
        const edge = this.teamQuality(t) - this.teamQuality((1 - t) as 0 | 1);
        this.blockPush[t] = Math.max(-HALF_LEN, Math.min(this.blockPush[t], deepestOpp + clamp(edge * 9, -4, 9)));
      }
    }

    if (st.phase === 'finished') return;
    if (st.phase === 'penalties') {
      this.stepPenalties(inputs);
      this.decayExcitement();
      this.prevInputs = [{ ...inputs[0] }, { ...inputs[1] }];
      return;
    }

    // phase timers ------------------------------------------------------
    if (st.phase === 'goalCelebration') {
      st.restartTimer -= DT;
      if (st.restartTimer <= 0) {
        this.placeForKickoff((1 - this.celebrationTeam) as 0 | 1);
        this.emit({ type: 'whistle' });
        this.prevInputs = [{ ...inputs[0] }, { ...inputs[1] }];
        return;
      }
      this.integratePlayers(inputs, true);
      this.integrateBall(inputs);
      this.settleBallInGoalNet();
      this.decayExcitement();
      this.prevInputs = [{ ...inputs[0] }, { ...inputs[1] }];
      return;
    }
    if (st.phase === 'halfTime' || st.phase === 'extraTimeBreak') {
      st.restartTimer -= DT;
      if (st.restartTimer <= 0) {
        st.half = (st.half + 1) as 1 | 2 | 3 | 4;
        st.clock = 0;
        st.addedTime = 0;
        this.addedTimeSec = -1;
        this.awaitingHalfEnd = false;
        st.attackDir = [st.attackDir[0] * -1, st.attackDir[1] * -1] as [number, number];
        this.halfTimeRecovery();
        this.resolveInjuredOff();
        this.placeForKickoff(st.half === 2 ? 1 : st.half === 3 ? 0 : 1);
        this.emit({ type: 'whistle' });
      }
      this.prevInputs = [{ ...inputs[0] }, { ...inputs[1] }];
      return;
    }

    // restart handling ----------------------------------------------------
    const isRestart = st.phase === 'kickoff' || st.phase === 'throwIn' || st.phase === 'corner' || st.phase === 'goalKick' || st.phase === 'freeKick' || st.phase === 'penaltyKick';
    if (isRestart) {
      st.restartTimer -= DT;
      if (st.phase === 'penaltyKick') {
        const inp = inputs[st.restartTeam];
        st.penaltyAim = this.cfg.teams[st.restartTeam].controller !== 'ai'
          ? clamp(inp.moveY, -1, 1)
          : 0;
      } else {
        st.penaltyAim = 0;
      }
      const deadBallCanRoll = st.phase === 'throwIn' || st.phase === 'corner' || st.phase === 'goalKick';
      const deadBallRolling = deadBallCanRoll
        && st.restartTimer > 0.62
        && len(st.ball.vel.x, st.ball.vel.y) > 0.2;
      if (!deadBallRolling) {
        if (st.phase === 'throwIn') {
          // the thrower holds the ball OVER HIS HEAD (behind the line), not on the
          // line in front of him — sit it at his hands so it reads as a throw-in
          const taker = this.findTaker(st.restartTeam);
          const at = taker ? taker.pos : this.restartTakerSpot();
          st.ball.pos = { x: at.x, y: at.y };
          st.ball.z = 1.5; // held between the raised hands
        } else {
          st.ball.pos = { ...st.restartPos };
          st.ball.z = 0;
        }
        st.ball.vel = { x: 0, y: 0 };
        st.ball.vz = 0;
      }
      st.ball.ownerIdx = -1;
      this.moveTakerToBall();
    }

    if (!isRestart) {
      this.humans[0].restartChargeBtn = null;
      this.humans[1].restartChargeBtn = null;
    }
    const frameBallStart = { ...st.ball.pos };
    this.updateControlledIndices(inputs);
    this.integratePlayers(inputs, false);

    if (isRestart) {
      this.resolveInjuredOff();
      this.aiConsiderSubstitutions();
      this.applyRestartTakerPose();
      this.maybeTakeRestart(inputs);
    } else {
      this.handleHumanKicks(inputs);
      this.updateBallOwnership();
      this.aiAerialPlay();
      this.updateAITackles();
      this.updateAIWithBall();
    }

    const ballFrameStart = this.integrateBall(inputs);
    this.goalkeeperLogic();
    this.limitOpenPlayBallSnap(frameBallStart);
    if (st.phase === 'play') this.checkBounds(ballFrameStart);

    // clock ---------------------------------------------------------------
    const halfLen = st.half <= 2 ? this.cfg.halfLengthSec : this.cfg.halfLengthSec / 3;
    if (st.phase === 'play') {
      st.penaltyAim = 0;
      // once we're past stoppage time and just waiting for the ball to go dead, let the clock
      // CRAWL — racing the minutes 5+ past full time while the move plays out looks broken;
      // a slow creep reads like proper added time. It runs normally otherwise (and resets
      // fresh each half because clock starts at 0 with awaitingHalfEnd cleared).
      st.clock += this.awaitingHalfEnd ? DT * 0.18 : DT;
      if (st.clock >= halfLen) {
        if (this.addedTimeSec < 0) {
          // first tick past regulation: decide stoppage time and announce it
          this.addedTimeSec = this.computeAddedTime(halfLen);
          st.addedTime = this.addedTimeSec;
          this.emit({ type: 'addedTime', seconds: Math.round(this.addedTimeSec) });
        }
        if (st.clock >= halfLen + this.addedTimeSec && !this.awaitingHalfEnd) {
          this.awaitingHalfEnd = true;
          this.halfEndArmTick = st.tick;
        }
      }
      // international-cup drinks break: once we pass the midpoint of a regulation
      // half, arm a hydration break to be taken at the next dead-ball / neutral moment
      if (this.hydrationBreaksEnabled()
        && st.half <= 2
        && !this.hydrationBreakHalves.has(st.half)
        && st.clock >= halfLen * 0.5
        && !this.awaitingHalfEnd) {
        this.awaitingHydration = true;
      }
    }
    // the drinks break is taken at the first time the ball goes OUT OF PLAY after the
    // midpoint — a throw-in, free kick, goal kick, corner or kick-off — so play actually
    // stops there and restarts there, never mid-move. It clears all momentum built up to
    // that point and signals the presentation layer.
    if (this.awaitingHydration && !this.awaitingHalfEnd
      && this.isRestartPhase(st.phase)) {
      this.awaitingHydration = false;
      this.hydrationBreakHalves.add(st.half);
      st.momentum[0] = 0;
      st.momentum[1] = 0;
      this.hydrationRecovery();
      this.emit({ type: 'hydrationBreak' });
    }
    // Once stoppage time is up, the whistle only goes at a NEUTRAL moment — the
    // ball in the centre circle, or any dead-ball / restart — so full time can
    // never be blown while a team is mid-attack. A hard cap stops endless play.
    if (this.awaitingHalfEnd) {
      // backstop in REAL ticks (not the now-crawling clock): if no dead ball comes within a
      // short window, blow it anyway so a half can't run on forever.
      const hardCap = this.halfEndArmTick >= 0 && st.tick - this.halfEndArmTick > Math.round(14 / DT);
      if (hardCap || this.ballInCentreCircle() || this.isRestartPhase(st.phase)) {
        this.awaitingHalfEnd = false;
        this.halfEndArmTick = -1;
        this.addedTimeSec = -1;
        st.addedTime = 0;
        this.endOfHalf();
      }
    }

    this.updateMomentumContext();
    this.checkNonContactInjuries();
    this.decayExcitement();
    this.prevInputs = [{ ...inputs[0] }, { ...inputs[1] }];
  }

  private endOfHalf() {
    const st = this.state;
    if (st.half === 1 || st.half === 3) {
      st.phase = st.half === 1 ? 'halfTime' : 'extraTimeBreak';
      st.restartTimer = 2.5;
      this.emit({ type: 'halfTime' });
      this.emit({ type: 'whistle' });
      return;
    }
    if (st.half === 2) {
      if (st.score[0] !== st.score[1] || !this.cfg.cupTie) {
        this.finishMatch();
      } else {
        st.phase = 'extraTimeBreak';
        st.restartTimer = 3;
        this.emit({ type: 'fullWhistle' });
      }
      return;
    }
    // half 4 done
    if (st.score[0] !== st.score[1] || !this.cfg.cupTie) {
      this.finishMatch();
    } else {
      this.beginPenalties();
    }
  }

  /** realistic stoppage time, scaled to the half length and nudged up by goals. */
  private computeAddedTime(halfLen: number): number {
    const st = this.state;
    const goals = st.score[0] + st.score[1];
    const base = halfLen * 0.045 + goals * (halfLen * 0.012);
    return clamp(base + this.rng.range(0, halfLen * 0.035), halfLen * 0.04, halfLen * 0.16);
  }

  /** the ball sitting in (or being carried into) the centre circle — a neutral spot, never an attack. */
  private ballInCentreCircle(): boolean {
    const b = this.state.ball.pos;
    return Math.hypot(b.x, b.y) <= CENTER_CIRCLE_R + 0.5;
  }

  /** drinks breaks: always in the international cup, and in any hot match (≥30°C). */
  private hydrationBreaksEnabled(): boolean {
    return this.cfg.leagueId === 'international-cup' || (this.cfg.temperature ?? 0) >= 30;
  }

  /** A drinks break hands back a slug of energy — less than half-time, but enough
   * to matter when the heat has been draining the players. */
  private hydrationRecovery() {
    for (const p of this.state.players) {
      if (p.sentOff) continue;
      p.staminaCeiling = Math.min(1, p.staminaCeiling + 0.05);
      p.stamina = Math.min(p.staminaCeiling, p.stamina + 0.2);
    }
  }

  /** the ball is dead / a restart is pending (throw-in, corner, goal kick, free kick, kickoff). */
  private isRestartPhase(p: SimPhase): boolean {
    return p === 'kickoff' || p === 'throwIn' || p === 'corner' || p === 'goalKick' || p === 'freeKick';
  }

  private finishMatch() {
    const st = this.state;
    st.phase = 'fullTime';
    st.winner = st.score[0] > st.score[1] ? 0 : st.score[1] > st.score[0] ? 1 : -1;
    this.emit({ type: 'fullWhistle' });
    this.emit({ type: 'fullTime' });
    // brief pause then finished
    st.restartTimer = 3;
    setTimeoutTick(this, () => {
      st.phase = 'finished';
      this.emit({ type: 'matchEnd' });
    });
  }

  // --------------------------------------------------------------- players

  private updateControlledIndices(inputs: [PadInput, PadInput]) {
    const st = this.state;
    for (let t = 0 as 0 | 1; t <= 1; t++) {
      if (this.cfg.teams[t].controller === 'ai') {
        st.controlledIdx[t] = -1;
        continue;
      }
      // Player Career: pin control to the avatar player — the human steers only
      // them; the other ten team-mates stay AI-controlled (Be-A-Pro mode).
      if (this.cfg.focusPlayer && this.cfg.focusPlayer.team === t) {
        const fp = st.players.find((p) => p.team === t && p.squadIdx === this.cfg.focusPlayer!.squadIdx);
        if (fp) {
          st.controlledIdx[t] = fp.idx;
          for (const p of st.players) if (p.team === t) p.control = (p.idx === fp.idx);
          continue;
        }
      }
      const ball = st.ball;
      const owner = this.owner();
      let best = st.controlledIdx[t];
      const current = st.players[best];
      const h = this.humans[t];
      const inp = inputs[t];
      const prev = this.prevInputs[t];
      // pass doubles as switch when we're off the ball in open play
      const ballIncoming = current
        ? (this.livePassTargetIdx === current.idx
          || ((ball.vel.x * (current.pos.x - ball.pos.x) + ball.vel.y * (current.pos.y - ball.pos.y)) > 0
            && dist(current.pos, ball.pos) < 8))
        : false;
      const passSwitch = st.phase === 'play'
        && inp.pass && !prev.pass
        // pass never switches while your own keeper holds a caught ball —
        // there it calls the short distribution instead (handleHumanKicks)
        && (!owner || owner.team !== t || (owner.isGK && !ball.held))
        && !ballIncoming
        && (!current || dist(current.pos, st.ball.pos) > 2.4);
      const switchEdge = (!!inp.switchPlayer && !prev.switchPlayer) || passSwitch;
      // restart taken by nearest of restart team
      const isRestart = st.phase !== 'play';
      if (owner && owner.team === t && (!owner.isGK || st.ball.held)) {
        // the man on the ball gets control — INCLUDING the keeper while he holds a
        // caught ball, so the human can throw/clear it himself instead of being
        // switched to a defender while the keeper just sits on it
        best = owner.idx;
        h.manualSwitchUntil = -1;
      } else {
        if (isRestart && st.restartTeam === t) {
          best = this.findTaker(t)?.idx ?? best;
        } else {
          const auto = this.autoControlCandidate(t);
          const validCurrent = !!current && current.team === t && !current.isGK && !current.sentOff && !current.injuredOff;
          if (switchEdge) {
            // manual switch: pick the next-best man, then BLIND the auto-switch
            // for a window so the engine can't immediately grab control back
            best = this.manualSwitchCandidate(t, current?.idx ?? -1, auto?.idx ?? -1)?.idx ?? auto?.idx ?? best;
            h.manualSwitchUntil = st.tick + Math.round(0.5 / DT);
          } else if (h.manualSwitchUntil > st.tick && validCurrent) {
            // inside the manual-override window: keep the man the human chose,
            // full stop — no automatic override
            best = current!.idx;
          } else if (!validCurrent) {
            best = auto?.idx ?? best;
          } else if (st.tick < h.autoSwitchAt) {
            // auto-switch cooldown: stop flickering between players when the ball
            // zips around in a quick passing move
            best = current!.idx;
          } else if (auto && auto.idx !== current!.idx
            && this.controlScore(auto, true) < this.controlScore(current!, true) - SWITCH_BIAS) {
            // only hand over when the new man is NOTABLY better placed
            best = auto.idx;
          } else {
            best = current!.idx;
          }
        }
      }
      if (best !== st.controlledIdx[t]) {
        // a swap just happened: arm the cooldown and a brief input-settle so the
        // freshly-controlled player doesn't sprint off on the held stick direction
        h.autoSwitchAt = st.tick + Math.round(0.18 / DT);
        h.controlSettleUntil = st.tick + 2;
      }
      st.controlledIdx[t] = best;
      for (const p of st.players) if (p.team === t) p.control = p.idx === best;
    }
  }

  /** Hand the human control to the man a cross/through-ball is played to, so the stick
   * runs HIM onto the end of it instead of curling the ball. Held briefly against the
   * auto-switch so it doesn't immediately snatch control back. */
  private handControlToReceiver(team: 0 | 1, idx: number) {
    if (idx < 0 || this.cfg.teams[team].controller === 'ai') return;
    const st = this.state;
    st.controlledIdx[team] = idx;
    for (const p of st.players) if (p.team === team) p.control = p.idx === idx;
    const h = this.humans[team];
    h.manualSwitchUntil = st.tick + Math.round(0.6 / DT);
    h.autoSwitchAt = st.tick + Math.round(0.18 / DT);
  }

  private autoControlCandidate(team: 0 | 1): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestScore = Infinity;
    for (const p of this.state.players) {
      if (p.team !== team || p.isGK) continue;
      if (p.sentOff || p.injuredOff) continue;
      let score = this.controlScore(p, true);
      if (p.idx === this.state.controlledIdx[team]) score -= 1.2;
      if (this.humans[team].passTargetIdx === p.idx) score -= 3;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  private manualSwitchCandidate(team: 0 | 1, currentIdx: number, autoIdx: number): SimPlayer | null {
    const ranked = this.state.players
      .filter((p) => p.team === team && !p.isGK)
      .filter((p) => !p.sentOff && !p.injuredOff)
      .sort((a, b) => this.controlScore(a, false) - this.controlScore(b, false));
    if (!ranked.length) return null;
    if (ranked[0].idx === currentIdx || ranked[0].idx === autoIdx) return ranked[1] ?? ranked[0];
    return ranked[0];
  }

  private controlScore(p: SimPlayer, includeBallPath: boolean): number {
    const ball = this.state.ball;
    const speed = len(ball.vel.x, ball.vel.y);
    const lead = clamp(speed / 18, 0, 0.75);
    const future = { x: ball.pos.x + ball.vel.x * lead, y: ball.pos.y + ball.vel.y * lead };
    let score = dist(p.pos, future);
    if (includeBallPath && speed > 2) {
      const path = pointSegDist(p.pos, ball.pos, future);
      const ahead = ((p.pos.x - ball.pos.x) * ball.vel.x + (p.pos.y - ball.pos.y) * ball.vel.y) / (speed || 1);
      if (ahead > -1 && path < 3.5) score -= clamp(3.5 - path, 0, 3.5);
    }
    return score;
  }

  private integratePlayers(inputs: [PadInput, PadInput], celebrating: boolean) {
    const st = this.state;
    for (const p of st.players) {
      if (p.sentOff) {
        p.control = false;
        p.vel = { x: 0, y: 0 };
        p.pos = { x: p.team === 0 ? -HALF_LEN - 4 : HALF_LEN + 4, y: -HALF_WID - 4 - p.idx * 0.1 };
        p.anim = 'idle';
        continue;
      }
      if (p.injuredOff) {
        // stays on the pitch (rendered as down) until the next break resolves him
        p.control = false;
        p.vel = { x: 0, y: 0 };
        p.anim = 'fall';
        continue;
      }
      p.kickCooldown = Math.max(0, p.kickCooldown - DT);
      if (p.actionTimer && p.actionTimer > 0) p.actionTimer = Math.max(0, p.actionTimer - DT);
      if (p.knockTimer && p.knockTimer > 0) p.knockTimer = Math.max(0, p.knockTimer - DT);
      if (p.downTimer && p.downTimer > 0) {
        // down after a foul or a hard tackle: he topples and lies on the turf, the
        // little momentum from the contact bleeding off, until he gets to his feet.
        // This wins over the slide block and clears any stray tackle state so he
        // can never be flung into a slide while he's supposed to be on the ground.
        p.downTimer -= DT;
        p.anim = 'fall';
        p.slideTimer = 0;
        p.diving = false;
        // bleed the launch/skid off gradually so he slides along the turf rather than
        // stopping dead the instant he lands
        p.vel.x *= 1 - 4 * DT;
        p.vel.y *= 1 - 4 * DT;
        p.pos.x += p.vel.x * DT;
        p.pos.y += p.vel.y * DT;
        this.clampToField(p);
        continue;
      }
      if (p.slideTimer > 0) {
        p.slideTimer -= DT;
        if (p.slideTimer <= 0) {
          p.diving = false;
          p.diveSide = 0;
          p.diveKind = null;
          p.diveBeaten = false;
        }
        p.anim = p.diving ? (p.anim === 'smother' ? 'smother' : 'dive') : 'slide';
        // keep sliding momentum, friction
        p.vel.x *= 1 - 2.4 * DT;
        p.vel.y *= 1 - 2.4 * DT;
        p.pos.x += p.vel.x * DT;
        p.pos.y += p.vel.y * DT;
        this.clampToField(p);
        continue;
      }
      let desired: Vec2;
      let sprint = false;
      const isRestartTaker = st.phase !== 'play'
        && p.team === st.restartTeam
        && p === this.findTaker(p.team);
      if (celebrating) {
        desired = p.team === this.celebrationTeam
          ? { x: p.pos.x + Math.cos(p.idx + st.tick * 0.05) * 2, y: p.pos.y + Math.sin(p.idx + st.tick * 0.05) * 2 }
          : this.slotToPitch(p.team, p.slot);
        p.anim = p.team === this.celebrationTeam ? 'celebrate' : 'run';
      } else if (isRestartTaker) {
        desired = this.restartTakerSpot();
        sprint = false;
      } else if (p.control && this.cfg.teams[p.team].controller !== 'ai') {
        const inp = inputs[p.team];
        sprint = inp.sprint;

        // --- pass-receiving CPU assistance ---
        // When a pass is in flight toward this player, auto-steer toward the
        // projected ball intercept point so the player meets the ball cleanly.
        // Holding sprint overrides the assist and gives full manual control.
        const h = this.humans[p.team];
        const isPassTarget = (this.livePassTargetIdx === p.idx && st.tick <= this.livePassTargetUntil)
          || (h.passTargetIdx === p.idx && st.ball.ownerIdx === -1);

        const isDefending = st.ball.ownerIdx === -1 && st.ball.lastTouchTeam !== p.team;
        const ticksSinceTouch = st.tick - this.lastTouchTick;
        const reactionDelayTicks = Math.round(30 * (1 - p.attrs.tackle / 100));
        const canAnticipate = ticksSinceTouch >= reactionDelayTicks;

        // The intended receiver is steered onto the ball even while sprinting —
        // holding sprint to chase a pass should run him cleanly ONTO it, not strip
        // the assist so he sprints straight past. Defensive anticipation still
        // yields to a held sprint (manual override of a marking jockey).
        const assistActive = isPassTarget || (isDefending && canAnticipate && !sprint);

        if (assistActive) {
          // a long ball with no reachable intercept yet still guides the
          // receiver to where it will come down
          const intercept = this.projectBallIntercept(p, false)
            ?? (isPassTarget ? this.projectBallArrival() : null);
          if (intercept) {
            const stickActive = inp.moveX !== 0 || inp.moveY !== 0;
            if (stickActive) {
              // blend manual stick with the intercept. The intended receiver who is
              // SPRINTING wants the assist for line (he's pressing toward the play),
              // so lean it harder onto the ball; otherwise keep the lighter 70/30
              // blend so the player retains his usual steering authority.
              const w = (isPassTarget && sprint) ? 0.85 : 0.7;
              const manX = p.pos.x + inp.moveX * 10;
              const manY = p.pos.y + inp.moveY * 10;
              desired = { x: intercept.x * w + manX * (1 - w), y: intercept.y * w + manY * (1 - w) };
            } else {
              desired = intercept;
            }
          } else {
            // no reachable intercept — fall back to manual or idle
            desired = { x: p.pos.x + inp.moveX * 10, y: p.pos.y + inp.moveY * 10 };
            if (inp.moveX === 0 && inp.moveY === 0) desired = { ...p.pos };
          }
        } else {
          // normal manual control (or sprint override)
          desired = { x: p.pos.x + inp.moveX * 10, y: p.pos.y + inp.moveY * 10 };
          if (inp.moveX === 0 && inp.moveY === 0) {
            // idle on the stick while the opponent has the ball: the CPU keeps the
            // controlled defender in shape for you (quality-scaled) instead of
            // leaving him stood still
            const idle = this.idleDefensiveAssist(p);
            if (idle) {
              desired = idle.desired;
              if (idle.sprint) sprint = true;
            } else {
              desired = { ...p.pos };
            }
          }
        }
        desired = this.humanDefensiveAssistTarget(p, inp, desired);
      } else {
        const raw = this.aiTarget(p);
        desired = this.smoothAiAim(p, raw);
        sprint = this.aiWantsSprint(p, desired);
      }
      // input-settle: for a couple of frames after a control handover the freshly
      // selected player ignores the held stick, so he doesn't lurch out of
      // position the instant control transfers
      if (p.control && this.cfg.teams[p.team].controller !== 'ai'
        && st.tick < this.humans[p.team].controlSettleUntil
        && st.ball.ownerIdx !== p.idx) {
        desired = { ...p.pos };
        sprint = false;
      }
      // keeper movement intent: hold a set, balanced stance when the adjustment
      // is tiny (no aimless shuffling back and forth on the line), but spring out
      // at a sprint when he has real ground to cover to close a man down or claim
      if (p.isGK && st.phase === 'play'
        && !(p.control && this.cfg.teams[p.team].controller !== 'ai')) {
        const gkd = len(desired.x - p.pos.x, desired.y - p.pos.y);
        if (gkd > 2.2) sprint = true;
        else if (gkd < 0.6 && !this.shotLive) desired = { x: p.pos.x, y: p.pos.y };
      }
      // steer toward desired
      const dx = desired.x - p.pos.x;
      const dy = desired.y - p.pos.y;
      const d = len(dx, dy);
      const sp = this.maxSpeed(p, sprint);
      let tx = 0, ty = 0;
      if (d > 0.05) {
        const arrive = Math.min(1, d / 1.2);
        tx = (dx / d) * sp * arrive;
        ty = (dy / d) * sp * arrive;
      }
      if (p.control && this.cfg.teams[p.team].controller !== 'ai') {
        const inp = inputs[p.team];
        if (inp.moveX || inp.moveY) p.facing = Math.atan2(inp.moveY, inp.moveX);
      } else if (d > 0.25) {
        p.facing = Math.atan2(dy, dx);
      }
      const accel = this.acceleration(p, sprint) * this.wfx.accel;
      p.vel.x += clamp(tx - p.vel.x, -accel * DT, accel * DT);
      p.vel.y += clamp(ty - p.vel.y, -accel * DT, accel * DT);
      // a standing tackle PLANTS the feet — he can't keep running through it. Kill his
      // momentum for the duration of the lunge so he stabs at the ball in place, then
      // resumes running (to catch up) once the action window ends.
      if (p.anim === 'tackle' && p.actionTimer && p.actionTimer > 0) {
        p.vel.x *= 0.55;
        p.vel.y *= 0.55;
      }
      p.pos.x += p.vel.x * DT;
      p.pos.y += p.vel.y * DT;
      const v = len(p.vel.x, p.vel.y);
      const hasBall = st.ball.ownerIdx === p.idx;
      const isHumanNeutral = p.control && this.cfg.teams[p.team].controller !== 'ai' && inputs[p.team].moveX === 0 && inputs[p.team].moveY === 0;
      if (hasBall && isHumanNeutral) {
        this.autoFaceGoalIfSpace(p);
      } else if (v > 0.4) {
        p.facing = Math.atan2(p.vel.y, p.vel.x);
      }

      // Goalkeeper override: always face the ball (unless celebrating). The dive/save
      // logic sets his facing to the shot direction when he commits, so this must NOT
      // rate-limit it — a capped turn here lagged the dive orientation and sent him the
      // wrong way across goal.
      if (p.isGK && !celebrating) {
        const toBallX = st.ball.pos.x - p.pos.x;
        const toBallY = st.ball.pos.y - p.pos.y;
        if (Math.hypot(toBallX, toBallY) > 0.2) {
          p.facing = Math.atan2(toBallY, toBallX);
        }
      }

      if (celebrating && p.team === this.celebrationTeam) {
        p.anim = 'celebrate';
      } else if (p.actionTimer && p.actionTimer > 0
        && (p.anim === 'header' || p.anim === 'kick' || p.anim === 'gkthrow'
          || p.anim === 'smother' || p.anim === 'tackle' || p.anim === 'throw')) {
        // one-shot action anim (header/kick/throw/tackle) holds over locomotion
      } else {
        p.anim = v < 0.4 ? 'idle' : v > this.maxSpeed(p, false) * 1.02 ? 'sprint' : 'run';
      }
      this.updateStamina(p, sprint, v);
      this.clampToField(p);
    }
    // soft player-player separation
    const ps = st.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (a.sentOff || b.sentOff) continue;
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
        const d = len(dx, dy);
        // team-mates keep a yard of daylight in open play so the shape never
        // reads as a rugby scrum around the ball (the carrier is exempt)
        const sameTeamSpread = st.phase === 'play'
          && a.team === b.team && !a.isGK && !b.isGK
          && st.ball.ownerIdx !== a.idx && st.ball.ownerIdx !== b.idx;
        const min = sameTeamSpread ? 1.45 : PLAYER_RADIUS * 2;
        if (d > 0.001 && d < min) {
          // a player on the ground (just fouled / hard tackle) isn't shoved around —
          // the other one steps over him and takes the full push
          const aDown = !!(a.downTimer && a.downTimer > 0);
          const bDown = !!(b.downTimer && b.downTimer > 0);
          if (aDown && bDown) continue;
          const push = (min - d) / (aDown || bDown ? 1 : 2);
          const nx = dx / d, ny = dy / d;
          if (!aDown) { a.pos.x -= nx * push; a.pos.y -= ny * push; }
          if (!bDown) { b.pos.x += nx * push; b.pos.y += ny * push; }
        }
      }
    }
    this.enforceRestartSpacing();
  }

  /**
   * Project the ball's 2-D ground trajectory forward in time and return the
   * first point where the given player can arrive before (or at the same time
   * as) the ball.  Returns null when no reachable intercept is found within
   * the look-ahead horizon.
   *
   * The projection mirrors the real integrateBall physics: air drag, ground
   * friction, gravity + bounce on the z-axis.  We ignore curl/spin since
   * their effect is small over the receiving window.
   */
  private projectBallIntercept(p: SimPlayer, sprint: boolean, horizon = 3.4): Vec2 | null {
    const ball = this.state.ball;
    // nothing to intercept if the ball is barely moving
    const ballSpeed = len(ball.vel.x, ball.vel.y);
    if (ballSpeed < 2) return null;

    const playerSpeed = this.maxSpeed(p, sprint);
    const step = 0.1;      // 100 ms steps — fast enough for smooth guidance
    const maxT = horizon;  // long passes fly 3+ s, so the live-pass window needs the full horizon

    // local copies we can mutate
    let bx = ball.pos.x, by = ball.pos.y;
    let bvx = ball.vel.x, bvy = ball.vel.y;
    let bz = ball.z, bvz = ball.vz;
    const longAerialSkid = this.longAerialSkidActive();

    for (let t = step; t <= maxT; t += step) {
      // --- mini ball physics step (mirroring integrateBall) ---
      const sp = len(bvx, bvy);
      if (bz > 0.02) {
        bvz += GRAVITY * step;
        bvx *= 1 - BALL_AIR_DRAG * step;
        bvy *= 1 - BALL_AIR_DRAG * step;
      } else if (sp > 0) {
        const ns = this.groundBallSpeedAfterStep(sp, step, longAerialSkid);
        bvx *= ns / sp;
        bvy *= ns / sp;
      }
      bx += bvx * step;
      by += bvy * step;
      bz += bvz * step;
      if (bz < 0) {
        bz = 0;
        if (longAerialSkid) {
          bvx *= LONG_AERIAL_BOUNCE_DAMP;
          bvy *= LONG_AERIAL_BOUNCE_DAMP;
        }
        bvz = -bvz * this.bounceRestitution(longAerialSkid);
        if (Math.abs(bvz) < 1.2) bvz = 0;
      }

      // how far the player can cover in time t (straight line)
      const reachDist = playerSpeed * t;
      const dx = bx - p.pos.x, dy = by - p.pos.y;
      const gap = len(dx, dy);

      if (gap <= reachDist + CONTROL_RADIUS) {
        return { x: bx, y: by };
      }
      // ball has almost stopped — no point projecting further
      if (len(bvx, bvy) < 1) break;
    }
    return null;
  }

  /**
   * Where the ball first becomes playable (low and slow enough to receive).
   * Used as the run target for an intended receiver who can't reach a true
   * intercept yet — e.g. a long ball still hanging in the air — so he attacks
   * the landing spot instead of standing flat-footed.
   */
  private projectBallArrival(): Vec2 | null {
    const ball = this.state.ball;
    if (len(ball.vel.x, ball.vel.y) < 2) return null;
    const step = 0.1;
    let bx = ball.pos.x, by = ball.pos.y;
    let bvx = ball.vel.x, bvy = ball.vel.y;
    let bz = ball.z, bvz = ball.vz;
    const longAerialSkid = this.longAerialSkidActive();
    for (let t = step; t <= 3.6; t += step) {
      const sp = len(bvx, bvy);
      if (bz > 0.02) {
        bvz += GRAVITY * step;
        bvx *= 1 - BALL_AIR_DRAG * step;
        bvy *= 1 - BALL_AIR_DRAG * step;
      } else if (sp > 0) {
        const ns = this.groundBallSpeedAfterStep(sp, step, longAerialSkid);
        bvx *= ns / sp;
        bvy *= ns / sp;
      }
      bx += bvx * step;
      by += bvy * step;
      bz += bvz * step;
      if (bz < 0) {
        bz = 0;
        if (longAerialSkid) {
          bvx *= LONG_AERIAL_BOUNCE_DAMP;
          bvy *= LONG_AERIAL_BOUNCE_DAMP;
        }
        bvz = -bvz * this.bounceRestitution(longAerialSkid);
        if (Math.abs(bvz) < 1.2) bvz = 0;
      }
      if (bz < 1.05 && len(bvx, bvy) < 12) return { x: bx, y: by };
      if (len(bvx, bvy) < 1) return { x: bx, y: by };
    }
    return { x: bx, y: by };
  }

  private clampToField(p: SimPlayer) {
    p.pos.x = clamp(p.pos.x, -HALF_LEN - 2, HALF_LEN + 2);
    p.pos.y = clamp(p.pos.y, -HALF_WID - 2, HALF_WID + 2);
  }

  private enforceRestartSpacing() {
    const st = this.state;
    // goal kick: the laws keep the opposition outside the penalty area until the
    // ball is in play — physically hold any of them out of the box (the AI
    // already steers their target out; this stops anyone who was caught inside)
    if (st.phase === 'goalKick') {
      const kicker = st.restartTeam;
      const away = this.attackSign(kicker); // downfield, away from the kicking team's goal
      const goalX = -away * HALF_LEN;
      for (const p of st.players) {
        if (p.sentOff || p.team === kicker) continue;
        if (Math.abs(p.pos.x - goalX) < PENALTY_BOX_DEPTH && Math.abs(p.pos.y) < PENALTY_BOX_HALF_WIDTH) {
          p.pos.x = goalX + away * (PENALTY_BOX_DEPTH + 1.2);
          if (p.vel.x * away < 0) p.vel.x = 0; // don't let them charge straight back in
        }
      }
      return;
    }
    if (st.phase !== 'kickoff') return;
    for (const p of st.players) {
      if (p.sentOff) continue;
      const dir = this.attackSign(p.team);
      if (p.team === st.restartTeam) {
        p.pos.x = dir > 0 ? Math.min(p.pos.x, 0.05) : Math.max(p.pos.x, -0.05);
        continue;
      }

      p.pos.x = dir > 0 ? Math.min(p.pos.x, -0.05) : Math.max(p.pos.x, 0.05);
      const d = Math.hypot(p.pos.x, p.pos.y);
      if (d < CENTER_CIRCLE_R + 0.1) {
        const outwardX = Math.sign(p.pos.x || (dir > 0 ? -1 : 1));
        const a = Math.atan2(p.pos.y, outwardX * Math.max(Math.abs(p.pos.x), 0.4));
        p.pos.x = Math.cos(a) * (CENTER_CIRCLE_R + 0.15);
        p.pos.y = Math.sin(a) * (CENTER_CIRCLE_R + 0.15);
        p.pos.x = dir > 0 ? Math.min(p.pos.x, -0.05) : Math.max(p.pos.x, 0.05);
      }
    }
  }

  // ----------------------------------------------------------------- AI

  /**
   * Damp high-frequency vibration in an off-ball player's steering target.
   * A large change (a genuinely new decision — start a run, switch a mark,
   * break to chase) snaps straight through; small frame-to-frame wobble from
   * threshold-crossing logic is filtered, so movement reads as committed
   * rather than twitchy. This is the central cure for the "erratic" feel.
   */
  private smoothAiAim(p: SimPlayer, raw: Vec2): Vec2 {
    const prev = this.aiAim.get(p.idx);
    if (!prev) {
      const v = { x: raw.x, y: raw.y };
      this.aiAim.set(p.idx, v);
      return v;
    }
    const jump = dist(prev, raw);
    const s = jump > 5 ? 1 : 0.2;
    prev.x += (raw.x - prev.x) * s;
    prev.y += (raw.y - prev.y) * s;
    return prev;
  }

  private aiTarget(p: SimPlayer): Vec2 {
    const st = this.state;
    const ball = st.ball;
    const owner = this.owner();
    const myDir = this.attackSign(p.team);

    if (p.isGK) return this.gkPosition(p);

    // restart phases: hold formation (taker handled separately)
    if (st.phase !== 'play') {
      if (st.phase === 'kickoff') return this.kickoffFormationTarget(p);
      if (st.phase === 'penaltyKick') {
        if (p.team === st.restartTeam && p === this.findTaker(p.team)) return this.restartTakerSpot();
        const atkDir = this.attackSign(st.restartTeam);
        const lineX = atkDir * (HALF_LEN - 24);
        return {
          x: lineX - atkDir * (p.team === st.restartTeam ? (p.idx % 3) * 1.6 : 4 + (p.idx % 4) * 1.4),
          y: clamp(((p.idx % 9) - 4) * 3.2, -HALF_WID + 5, HALF_WID - 5),
        };
      }
      if (st.phase === 'freeKick' && p.team !== st.restartTeam) {
        const wall = this.freeKickWallTarget(p);
        if (wall) return wall;
      }
      if ((st.phase === 'throwIn' || st.phase === 'corner' || st.phase === 'freeKick') && p.team === st.restartTeam && p === this.findTaker(p.team)) {
        return this.restartTakerSpot();
      }
      // attacking free kicks in crossing range: forwards skip the generic
      // support shape and go crowd the box instead (handled below)
      const fkAttackerToBox = st.phase === 'freeKick'
        && p.team === st.restartTeam
        && st.restartPos.x * this.attackSign(st.restartTeam) > HALF_LEN - 38
        && (p.attrs.pos === 'FW' || p.attrs.pos === 'MF');
      if ((st.phase === 'throwIn' || st.phase === 'corner' || st.phase === 'freeKick') && p.team === st.restartTeam && !fkAttackerToBox) {
        const support = this.attackingRestartTarget(p);
        if (support) return support;
      }
      const fkInCrossRange = st.phase === 'freeKick'
        && st.restartPos.x * this.attackSign(st.restartTeam) > HALF_LEN - 38;
      if (st.phase === 'corner' || fkInCrossRange) {
        // crowd the box
        const atkTeam = st.restartTeam;
        const goalX = this.attackSign(atkTeam) * HALF_LEN;
        if (!p.isGK && Math.abs(p.slot.x) < 0.95) {
          if (p.team === atkTeam && (p.attrs.pos === 'FW' || p.attrs.pos === 'MF')) {
            return { x: goalX - this.attackSign(atkTeam) * (6 + (p.idx % 4) * 3), y: ((p.idx % 5) - 2) * 4 };
          }
          if (p.team !== atkTeam && (p.attrs.pos === 'DF' || p.attrs.pos === 'MF')) {
            return { x: goalX - this.attackSign(atkTeam) * (4 + (p.idx % 4) * 3), y: ((p.idx % 5) - 2) * 3.4 };
          }
        }
      }
      const restHome = this.formationTarget(p);
      // goal kick: the opposition retreats out of the penalty area until the
      // ball is back in play
      if (st.phase === 'goalKick' && p.team !== st.restartTeam) {
        return this.clampOutOfBox(st.restartTeam, restHome);
      }
      return restHome;
    }

    const h = this.humans[p.team];
    const isPassTarget = (this.livePassTargetIdx === p.idx && st.tick <= this.livePassTargetUntil)
      || (h.passTargetIdx === p.idx && st.ball.ownerIdx === -1);
    if (isPassTarget) {
      const intercept = this.projectBallIntercept(p, true);
      if (intercept) return intercept;
      // long ball still out of range: attack where it will come down instead
      // of standing flat-footed until it enters the intercept horizon
      const arrival = this.projectBallArrival();
      if (arrival) return arrival;
    }

    const dToBall = dist(p.pos, ball.pos);
    // chase ranking by arrival time, sharpened by anticipation: better players
    // (attack stats up front, defence stats at the back) read a loose ball
    // sooner and so claim the chase from slower-witted teammates
    const ranked = st.players
      .filter((q) => q.team === p.team && !q.isGK && !q.sentOff && !q.injuredOff)
      .map((q) => ({
        q,
        eta: dist(q.pos, ball.pos) / this.maxSpeed(q, true) - (this.anticipation(q) / 100) * 0.4,
      }))
      .sort((a, b) => a.eta - b.eta)
      .map(({ q }) => q);
    const chaseRank = ranked.indexOf(p);

    if (!owner) {
      // a committed run (e.g. attacking a cross) carries on while our
      // delivery is in flight
      const run = this.forwardRuns.get(p.idx);
      if (run && run.until > st.tick && ball.lastTouchTeam === p.team) {
        return run.target;
      }
      // free ball: closest chase — three men when it drops near a box
      // (rebounds, parries, half-cleared corners), two in midfield. The
      // chase/hold choice is committed for ~0.4s so a near-tie in arrival time
      // can't flip a man between sprinting at the ball and dropping into shape
      // every frame (the classic "two players twitching at a loose ball").
      const nearBox = Math.abs(ball.pos.x) > HALF_LEN - 24;
      const chaseThreshold = nearBox ? 3 : 2;
      const commit = this.chaseCommit.get(p.idx);
      let shouldChase: boolean;
      if (commit && commit.until > st.tick && commit.ballTeam === ball.lastTouchTeam) {
        shouldChase = commit.chase;
      } else {
        shouldChase = chaseRank < chaseThreshold;
        this.chaseCommit.set(p.idx, { chase: shouldChase, until: st.tick + Math.round(0.4 / DT), ballTeam: ball.lastTouchTeam });
      }
      if (shouldChase) {
        const ticksSinceTouch = st.tick - this.lastTouchTick;
        const sameTeamTouch = ball.lastTouchTeam === p.team;
        const reactionDelayTicks = Math.round(
          32 * (1 - this.anticipation(p) / 100) * (sameTeamTouch ? 0.55 : 1),
        );
        if (ticksSinceTouch >= reactionDelayTicks) {
          const intercept = this.projectBallIntercept(p, true);
          if (intercept) return intercept;
        }
        const t = clamp(dToBall / 12, 0, 0.7);
        return { x: ball.pos.x + ball.vel.x * t, y: ball.pos.y + ball.vel.y * t };
      }
      return this.formationTarget(p);
    }

    if (owner.team === p.team) {
      if (owner === p) return this.dribbleTarget(p); // shouldn't reach (handled in updateAIWithBall) but safe
      return this.supportTarget(p, owner);
    }

    // a keeper with the ball in his hands cannot be challenged: clear his box
    // and pick up men for the distribution instead of crowding him
    if (owner.isGK && ball.held) {
      const markHeld = this.markReceiverTarget(p, owner);
      return this.clampOutOfBox(owner.team, markHeld ?? this.formationTarget(p));
    }

    // defending: one player presses, midfield covers, defenders keep the line
    const ownGoalDir = this.ownGoalDir(p.team);
    const press = this.pressAssignments(p.team, owner);
    if (press.primary?.idx === p.idx) {
      // cut the angle to a reachable point on his path to goal so we get ACROSS the
      // run, instead of trailing the tail of a carrier moving at pace
      const cutoff = this.goalCutoffTarget(p, owner);
      if (cutoff) return cutoff;
      // approach goal-side of the carrier so he can't just knock it past the press
      return { x: owner.pos.x + ownGoalDir * 0.9, y: owner.pos.y + clamp(-owner.pos.y * 0.05, -0.9, 0.9) };
    }
    if (press.secondary?.idx === p.idx) {
      // Cover shadow: stay goal-side of ball, cut passing lanes rather than charging past.
      const coverX = owner.pos.x + ownGoalDir * 5;
      const ownerY = owner.pos.y;
      // Against a CENTRAL carrier the danger is the direct line to goal, so the cover
      // man tucks in almost directly behind the press — a clear defender between the
      // carrier and goal — rather than sitting off to one side (which reads as "no one
      // in front" while the back line just flanks him). A wide carrier keeps the wider
      // cover so the cutback lane is still screened. (Accepted trade: tighter central
      // cover wins/contests the ball more, so open-play turnovers run a little higher.)
      const carrierCentral = Math.abs(ownerY) < PENALTY_BOX_HALF_WIDTH;
      const lateral = carrierCentral ? 2.4 : 6;
      return { x: coverX, y: ownerY + (p.pos.y > ownerY ? lateral : -lateral) };
    }
    // Last line of cover: if no other outfielder is goal-side of the carrier and
    // he's close, THIS man must step up and contain rather than dropping onto the
    // line or peeling off to mark space — otherwise he reads as running away from
    // a carrier bearing down on goal with no one behind to cover.
    if ((p.attrs.pos === 'DF' || p.attrs.pos === 'MF')
      && dist(p.pos, owner.pos) < 18
      && this.isLastLineDefender(p, owner)) {
      // the last man cuts across the run to block the path to goal rather than
      // backpedalling on the carrier's current spot
      const cutoff = this.goalCutoffTarget(p, owner);
      if (cutoff) return cutoff;
      return { x: owner.pos.x + ownGoalDir * 1.4, y: owner.pos.y + clamp(-owner.pos.y * 0.04, -1.4, 1.4) };
    }
    // A carrier driving centrally at our goal: the single nearest defender peels
    // into the lane and cuts off the path, instead of retreating to his wide slot
    // and leaving the middle open. Only the nearest goes; the rest hold shape.
    if (p.attrs.pos === 'DF' && Math.abs(owner.pos.y) < 14 && this.isNearestCentralBlocker(p, owner)) {
      const block = this.goalCutoffTarget(p, owner);
      if (block) return block;
    }
    const centralCutbackScreen = this.centralCutbackScreenTarget(p, owner, [
      press.primary?.idx ?? -1,
      press.secondary?.idx ?? -1,
    ]);
    if (centralCutbackScreen) return centralCutbackScreen;
    if (press.tertiary?.idx === p.idx && press.dangerousReceiver) {
      // cut the lane to the most dangerous unmarked receiver
      const r = press.dangerousReceiver;
      return { x: (owner.pos.x + r.pos.x) / 2, y: (owner.pos.y + r.pos.y) / 2 };
    }
    // A man getting in behind toward goal is picked up by the SINGLE nearest
    // covering player (a defender or a dropping midfielder) — the rest hold their
    // shape — rather than everyone standing in their slot beside him while he runs
    // through. The recoverer drops goal-side and sprints to track/block the run.
    if (p.attrs.pos === 'DF' || p.attrs.pos === 'MF') {
      const runner = this.findRunnerInBehind(p, owner);
      if (runner && this.isNearestRecoverer(p, runner)) {
        return this.markingSpot(p, runner, this.ownGoalDir(p.team));
      }
    }
    const mark = this.markReceiverTarget(p, owner);
    if (mark) return mark;
    return this.nonPressingDefensiveTarget(p, owner, this.formationTarget(p));
  }

  /** A controlled defender's reading + closing ability, 0..1, used to scale how
   * sharply the defensive assist repositions and sticks to the ball. Weighted to
   * tackle with pace and centred so a ~70-rated defender sits mid-range — only the
   * best read and close like elite defenders, a poor one is a step slow. Carries
   * the player's current form and team momentum through `effectiveAttr`/`formFactor`
   * so the assist tracks his actual quality, not a flat rating. */
  private defensiveQuality(p: SimPlayer): number {
    const reading = this.effectiveAttr(p, 'tackle') * 0.7 + this.effectiveAttr(p, 'pace') * 0.3;
    return clamp(((reading - 58) / 30) * this.formFactor(p), 0, 1);
  }

  /** When the human lets go of the stick while the opposition has the ball, the
   * controlled player holds his shape on his own instead of standing flat-footed:
   * he slides toward his AI defensive position and sprints back if he's been pulled
   * out of it. Both the snap into shape and how soon he sprints to cover scale with
   * his defensive quality — a top defender tucks in instantly, a poor one lags. */
  private idleDefensiveAssist(p: SimPlayer): { desired: Vec2; sprint: boolean } | null {
    const st = this.state;
    const owner = this.owner();
    if (!owner || owner.team === p.team || owner.isGK || p.isGK
      || st.phase !== 'play' || st.ball.ownerIdx === p.idx) {
      return null;
    }
    const q = this.defensiveQuality(p);
    const aiRaw = this.aiTarget(p);
    const w = 0.5 + q * 0.3; // sharper readers close into shape faster
    const desired = {
      x: p.pos.x * (1 - w) + aiRaw.x * w,
      y: p.pos.y * (1 - w) + aiRaw.y * w,
    };
    const sprint = dist(p.pos, aiRaw) > 6 - q * 3; // elite cover sooner, a poor one jogs
    return { desired, sprint };
  }

  private humanDefensiveAssistTarget(p: SimPlayer, inp: PadInput, desired: Vec2): Vec2 {
    const st = this.state;
    if (st.phase !== 'play' || p.isGK || st.ball.ownerIdx === p.idx || st.ball.z > 1.2) return desired;
    const stick = len(inp.moveX, inp.moveY);
    if (stick < 0.12) return desired;
    const owner = this.owner();
    let target: Vec2 | null = null;
    if (owner && owner.team !== p.team && !owner.isGK) {
      target = owner.pos;
    } else if (!owner && st.ball.lastTouchTeam !== p.team) {
      target = st.ball.pos;
    }
    if (!target) return desired;
    const toBallX = target.x - p.pos.x;
    const toBallY = target.y - p.pos.y;
    const toBallD = len(toBallX, toBallY);
    // a sharper defender reads the danger and engages from further out
    const q = this.defensiveQuality(p);
    if (toBallD < 1.2 || toBallD > 30 + q * 8) return desired;
    const stickX = inp.moveX / stick;
    const stickY = inp.moveY / stick;
    const ballX = toBallX / toBallD;
    const ballY = toBallY / toBallD;
    const away = stickX * ballX + stickY * ballY;
    if (away > -0.12) return desired;
    // and his close-down sticks harder to the ball — a poor one's is looser
    const assist = clamp((-away - 0.12) / 0.88, 0, 1) * (0.6 + q * 0.3);
    const corrective = { x: p.pos.x + ballX * 10, y: p.pos.y + ballY * 10 };
    return {
      x: desired.x * (1 - assist) + corrective.x * assist,
      y: desired.y * (1 - assist) + corrective.y * assist,
    };
  }

  /** true when `p` is the last line of cover: he is goal-side of the carrier and
   * no OTHER own outfielder is also goal-side of the carrier (the back line has
   * been broken and only this man stands between the carrier and our goal). */
  private isLastLineDefender(p: SimPlayer, carrier: SimPlayer): boolean {
    const ownGoalDir = this.ownGoalDir(p.team);
    if ((p.pos.x - carrier.pos.x) * ownGoalDir <= 0.5) return false;
    let goalSide = 0;
    for (const q of this.state.players) {
      if (q.team !== p.team || q.isGK || q.sentOff || q === carrier) continue;
      if ((q.pos.x - carrier.pos.x) * ownGoalDir > 0.5 && ++goalSide > 1) return false;
    }
    return true;
  }

  /** true when `p` is the single closest own defender to a carrier driving at our
   * goal — so exactly ONE man peels into the central lane to block the run, rather
   * than the whole back line retreating to its slots and leaving the middle open
   * (the "they back off and let him run between them" complaint). */
  private isNearestCentralBlocker(p: SimPlayer, carrier: SimPlayer): boolean {
    const myD = dist(p.pos, carrier.pos);
    if (myD > 26) return false;
    for (const q of this.state.players) {
      if (q.team !== p.team || q.isGK || q.sentOff || q === p || q.attrs.pos !== 'DF') continue;
      if (dist(q.pos, carrier.pos) < myD - 0.3) return false;
    }
    return true;
  }

  /** true when `p` is the closest own outfield player to the runner, so only one
   * defender peels off to recover rather than the whole back line chasing. */
  private isNearestRecoverer(p: SimPlayer, runner: SimPlayer): boolean {
    const myD = dist(p.pos, runner.pos);
    for (const q of this.state.players) {
      if (q.team !== p.team || q.isGK || q.sentOff || q === p) continue;
      if (dist(q.pos, runner.pos) < myD - 0.5) return false;
    }
    return true;
  }

  /** Find attackers running in behind the defensive line */
  private findRunnerInBehind(defender: SimPlayer, carrier: SimPlayer): SimPlayer | null {
    const dirToOwnGoal = this.ownGoalDir(defender.team);
    const defLineX = this.defensiveLineX(defender.team);
    let bestRunner: SimPlayer | null = null;
    let bestThreat = 0;
    for (const q of this.state.players) {
      if (q.team === defender.team || q.isGK || q.sentOff || q === carrier) continue;
      const attackerProgress = q.pos.x * dirToOwnGoal;
      const lineProgress = defLineX * dirToOwnGoal;
      // keep the offside-trap gate: only track behind when the carrier can
      // actually play the runner in (otherwise hold the line, leave him offside)
      if (!this.canCarrierThreatenRunnerBehind(defender.team, carrier, q)) continue;
      if (attackerProgress > lineProgress + 2) {
        const velTowardGoal = q.vel.x * dirToOwnGoal;
        const threat = attackerProgress + velTowardGoal * 0.5;
        if (threat > bestThreat && dist(defender.pos, q.pos) < 40) {
          bestThreat = threat;
          bestRunner = q;
        }
      }
    }
    return bestRunner;
  }

  /** push an opposing target out of boxTeam's penalty area (goal kicks, held balls) */
  private clampOutOfBox(boxTeam: 0 | 1, target: Vec2): Vec2 {
    const away = this.attackSign(boxTeam); // downfield, out of the box
    const goalX = -away * HALF_LEN;
    if (Math.abs(target.x - goalX) < 18 && Math.abs(target.y) < 21.5) {
      return { x: goalX + away * 18, y: target.y };
    }
    return target;
  }

  /**
   * How early a player reads a loose ball, 0-100. In the attacking third it's
   * the attacking stats that matter (a poacher sniffing a rebound), in the
   * defensive third the defending stats (a centre-half attacking a clearance),
   * in midfield a blend.
   */
  private anticipation(p: SimPlayer): number {
    const ballProg = this.state.ball.pos.x * this.attackSign(p.team);
    if (ballProg > HALF_LEN - 28) return p.attrs.shoot * 0.6 + p.attrs.pass * 0.4;
    if (ballProg < -(HALF_LEN - 28)) return p.attrs.tackle;
    return (p.attrs.pass + p.attrs.tackle) / 2;
  }

  private supportTarget(p: SimPlayer, owner: SimPlayer): Vec2 {
    const st = this.state;
    const base = this.formationTarget(p);
    const dir = this.attackSign(p.team);
    const ownerAhead = (owner.pos.x - p.pos.x) * dir;
    const laneSide = p.slot.y === 0 ? (p.idx % 2 ? 1 : -1) : Math.sign(p.slot.y);
    const role = this.playerRole(p);
    const mentality = this.teamMentality(p.team);
    const tactic = this.teamTacticProfile(p.team);

    // committed darts behind the line carry on until they expire or the player
    // actually arrives — use the full distance, not just the x component, so a
    // run isn't abandoned mid-stride the instant its depth is reached while the
    // player is still yards from the target line (the old x-only check made
    // runs stutter: sprint, stop, reset, sprint again)
    const run = this.forwardRuns.get(p.idx);
    if (run && run.until > st.tick && dist(p.pos, run.target) > 1.4) {
      return { x: run.target.x, y: run.target.y };
    }
    if (role === 'holdingMidfielder' && ownerAhead > 3) {
      return {
        x: dir * clamp(owner.pos.x * dir - 12.5, -HALF_LEN + 8, HALF_LEN - 18),
        y: clamp(base.y * 0.68 + owner.pos.y * 0.12, -HALF_WID + 5, HALF_WID - 5),
      };
    }
    if (this.inTransition(p.team) && (p.attrs.pos === 'FW' || p.attrs.pos === 'MF')) {
      return this.transitionSupportTarget(p, owner);
    }
    // occasionally start a new run into the widest channel — quick, sharp
    // attackers (pace + finishing instinct) make far more of these darts
    const runInstinct = 0.55 + ((p.attrs.pace * 0.6 + p.attrs.shoot * 0.4) / 100) * 0.65;
    if ((p.attrs.pos === 'FW' || p.attrs.pos === 'MF')
      && (!run || run.until <= st.tick - Math.round(1.1 / DT))
      && (st.tick + p.idx * 37) % 54 === 0
      && this.rng.next() < (p.attrs.pos === 'FW' ? 0.7 : 0.42) * clamp(0.86 + this.teamQuality(p.team) * 0.16, 0.66, 1.04) * runInstinct * mentality.risk) {
      const ownerProg = owner.pos.x * dir;
      if (ownerProg > -25 && ownerProg < HALF_LEN - 8) {
        const lineProg = this.oppositionDefLineX(p.team) * dir;
        const targetX = dir * clamp(lineProg + 7, 4, HALF_LEN - 8);
        // Use formation slot for varied Y offsets so different players target different spaces
        const slotOffset = (p.slot.y * 8 + (p.idx % 5 - 2) * 2) * mentality.supportWidth * (0.88 + tactic.width * 0.28);
        const targetY = clamp(this.openChannelY(p.team) + slotOffset, -HALF_WID + 5, HALF_WID - 5);
        this.forwardRuns.set(p.idx, {
          until: st.tick + Math.round(3.0 / DT),
          target: { x: targetX, y: targetY },
        });
      }
    }

    // owner wide in the final third: get bodies on the posts before the cross
    const ownerInCrossZone = owner.pos.x * dir > HALF_LEN - 34
      && Math.abs(owner.pos.y) > PENALTY_BOX_HALF_WIDTH - 2;
    if (ownerInCrossZone && p.attrs.pos === 'FW') {
      const ownerSide = Math.sign(owner.pos.y || p.slot.y || 1);
      const slotSide = Math.sign(p.slot.y || 0);
      const farPostRunner = slotSide !== 0 && slotSide !== ownerSide;
      return {
        x: dir * (HALF_LEN - (farPostRunner ? 5.4 : 7.2)),
        y: clamp((farPostRunner ? -ownerSide : ownerSide) * (farPostRunner ? 6.4 : 6.1), -HALF_WID + 4, HALF_WID - 4),
      };
    }
    if (ownerInCrossZone && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.45) {
      return {
        x: dir * (HALF_LEN - PENALTY_SPOT - 1.8),
        y: clamp(owner.pos.y * 0.08, -2.2, 2.2),
      };
    }
    const ownerInCentralBoxChannel = owner.pos.x * dir > HALF_LEN - 16
      && Math.abs(owner.pos.y) < PENALTY_BOX_HALF_WIDTH - 3
      && Math.abs(owner.pos.y) > 3.5;
    if (ownerInCentralBoxChannel && p.attrs.pos === 'MF' && Math.abs(p.slot.y) < 0.45) {
      return {
        x: dir * (HALF_LEN - PENALTY_SPOT - 1.2),
        y: clamp(owner.pos.y * 0.08, -2.2, 2.2),
      };
    }
    if (ownerInCentralBoxChannel && p.attrs.pos === 'FW') {
      const side = Math.sign(p.slot.y || owner.pos.y || 1);
      return {
        x: dir * (HALF_LEN - 7.2),
        y: clamp(side * 5.4, -HALF_WID + 4, HALF_WID - 4),
      };
    }
    let x = base.x;
    let y = base.y;
    if (p.attrs.pos === 'FW') {
      x = Math.max(x * dir, owner.pos.x * dir + 8) * dir;
      x = this.clampToAttackingLine(p.team, x, 1.0);
      // Find actual open space instead of clustering around carrier
      const space = this.findAttackingSpace(p, owner, laneSide);
      y = space.y;
      // Blend X toward open space too to avoid stacking
      x = x * 0.7 + space.x * 0.3;
      x = dir * Math.max(x * dir, owner.pos.x * dir + 1.1);
      x = this.clampToAttackingLine(p.team, x, 0.2);
    } else if (p.attrs.pos === 'MF') {
      // staggered depth: midfielders at different X positions to create passing triangles
      // not parallel lines - blend formation depth with tactical positioning
      const formationDepth = p.slot.x * 12; // Deeper midfielders stay deeper
      const tacticalDepth = ownerAhead > 8 ? -5 : 8 + (mentality.risk - 1) * 6;
      const staggeredDepth = formationDepth * 0.6 + tacticalDepth * 0.4;
      x = owner.pos.x + dir * staggeredDepth;
      x = this.clampToAttackingLine(p.team, x, 0.5);
      // Width: stay wide based on formation slot, don't converge on carrier.
      // A central-overload formation squeezes its midfield inward to crowd the
      // middle; a wide formation keeps the touchlines stretched.
      const overloadSqueeze = 1 - Math.max(0, tactic.centralOverload - 0.6) * 0.4;
      const baseWidth = p.slot.y * (HALF_WID * (0.42 + tactic.width * 0.18)) * mentality.supportWidth * overloadSqueeze;
      const carrierOffset = laneSide * (5 + tactic.width * 3) * mentality.supportWidth;
      // A winger only tucks into the half-space when his OWN flank is being driven
      // — the carrier is wide on his side and level with or ahead of him (e.g. an
      // overlapping full-back). Until then he holds the wide channel and shows for
      // the pass rather than drifting inside as a spectator.
      const carrierDrivingMyFlank = Math.sign(owner.pos.y || laneSide) === laneSide
        && Math.abs(owner.pos.y) > HALF_WID * 0.34
        && (owner.pos.x - p.pos.x) * dir > -6;
      if (role === 'wideMidfielder' && !carrierDrivingMyFlank) {
        y = laneSide * clamp(Math.abs(baseWidth) * 1.55 + 6, 16, HALF_WID - 4);
      } else {
        y = baseWidth * 0.7 + carrierOffset * 0.3;
        y = clamp(y, -HALF_WID + 5, HALF_WID - 5);
      }
      if (tactic.pivotDepth > 0.68 && p.slot.x < -0.3 && owner.pos.x * dir > -8) {
        const pivotProgress = clamp(owner.pos.x * dir - (11 + tactic.pivotDepth * 5), -HALF_LEN + 8, HALF_LEN - 20);
        x = dir * pivotProgress;
        y = clamp(y * 0.72, -HALF_WID + 7, HALF_WID - 7);
      }
    } else if (p.attrs.pos === 'DF') {
      const baseProgress = base.x * dir;
      const ownerProgress = owner.pos.x * dir;
      const ballProgress = this.state.ball.pos.x * dir;
      // When our team is attacking into the opponent half the back line must
      // step up and squeeze the game — sit AT LEAST around halfway rather than
      // dropping deep in our own half while we're on top. A front-foot side
      // (higher identity aggression) holds the line a touch higher again. The
      // existing ownerProgress-16 term still pulls the line up further as the
      // attack advances, and the HALF_LEN-30 ceiling keeps a counter cushion.
      const holdFloor = ballProgress > 4
        ? clamp(ballProgress - 24 + this.teamIdentity(p.team).aggression * 4, -2, HALF_LEN - 30)
        : -HALF_LEN + 15;
      const pushedProgress = clamp(
        Math.min(ownerProgress - 16, ballProgress - 14),
        holdFloor,
        HALF_LEN - 30,
      );
      // ball-side fullback overlaps outside the carrier during sustained attacks
      const wideBack = Math.abs(p.slot.y) >= 0.55;
      const ballSide = Math.sign(owner.pos.y || 1) === Math.sign(p.slot.y || 1);
      if (wideBack && ballProgress > -8 && (ballSide || role === 'overlapFullBack')) {
        const overlapProgress = clamp(ownerProgress + (role === 'overlapFullBack' ? 6 : 5), baseProgress, HALF_LEN - 16);
        x = Math.max(baseProgress, overlapProgress) * dir;
        y = clamp(Math.sign(p.slot.y) * (HALF_WID - 7), -HALF_WID + 4, HALF_WID - 4);
      } else {
        const pushedLine = Math.max(baseProgress, pushedProgress, this.blockPush[p.team]);
        const cappedLine = this.isCentreBack(p)
          ? Math.min(pushedLine, this.attackingCentreBackProgressCap(p.team))
          : pushedLine;
        x = cappedLine * dir;
        y = clamp(base.y + this.state.ball.pos.y * 0.12, -HALF_WID + 4, HALF_WID - 4);
      }
    }
    return { x: clamp(x, -HALF_LEN + 2, HALF_LEN - 2), y };
  }

  private transitionSupportTarget(p: SimPlayer, owner: SimPlayer): Vec2 {
    const dir = this.attackSign(p.team);
    const mentality = this.teamMentality(p.team);
    const tactic = this.teamTacticProfile(p.team);
    const ownerProg = owner.pos.x * dir;
    const oppLineProg = this.oppositionDefLineX(p.team) * dir;
    const slotSide = Math.abs(p.slot.y) > 0.08 ? Math.sign(p.slot.y) : (p.idx % 2 ? 1 : -1);
    const width = (p.attrs.pos === 'FW'
      ? 10 + Math.abs(p.slot.y) * 12
      : 8 + Math.abs(p.slot.y) * 15) * mentality.supportWidth * (0.86 + tactic.width * 0.32);
    const desiredProgress = ownerProg + (p.attrs.pos === 'FW'
      ? 17
      : Math.abs(p.slot.y) > 0.48 ? 13 : 8) + Math.max(0, mentality.risk - 1) * 4 + Math.max(0, tactic.directness - 0.5) * 5;
    const checkedProgress = Math.min(desiredProgress, oppLineProg - 1.1, HALF_LEN - 8);
    const supportProgress = Math.max(checkedProgress, ownerProg + (p.attrs.pos === 'FW' ? 8 : 5));
    const switchSide = Math.sign(owner.pos.y || 0) === slotSide && Math.abs(owner.pos.y) > 9
      ? -slotSide
      : slotSide;
    return {
      x: dir * clamp(supportProgress, -HALF_LEN + 6, HALF_LEN - 8),
      y: clamp(owner.pos.y + switchSide * width, -HALF_WID + 5, HALF_WID - 5),
    };
  }

  /** Find open attacking space with anti-bunching - prevents clustering */
  private findAttackingSpace(p: SimPlayer, owner: SimPlayer, laneSide: number): Vec2 {
    const st = this.state;
    const myDir = this.attackSign(p.team);
    const opponents = st.players.filter((q) => q.team !== p.team && !q.isGK && !q.sentOff);
    const teammates = st.players.filter((q) => q.team === p.team && q.idx !== p.idx && !q.isGK && !q.sentOff);

    // Candidate positions: formation-based + open channel-based + opposite-side options
    const candidates: Vec2[] = [];
    const base = this.slotToPitch(p.team, p.slot);
    const baseY = base.y;
    const openChannelY = this.openChannelY(p.team);

    // Generate candidates across the width
    const yOffsets = [-12, -7, -3.5, 0, 3.5, 7, 12];
    for (const offY of yOffsets) {
      // Blend formation slot with open channel
      let candidateY = (baseY * 0.4 + openChannelY * 0.4 + offY * 0.2);
      // Prefer the side this player should be on based on formation
      if (laneSide > 0) {
        candidateY = Math.abs(candidateY); // right side
      } else {
        candidateY = -Math.abs(candidateY); // left side
      }
      candidateY = clamp(candidateY, -HALF_WID + 6, HALF_WID - 6);

      // X position: ahead of ball but not offside. A fixed per-player depth
      // (NOT a fresh rng draw each tick) keeps the chosen space stable frame to
      // frame, so a forward commits to consistent width instead of bunching or
      // spreading at random as the candidate scores reshuffle every tick.
      const depthJitter = 8 + ((p.idx * 2.3) % 4);
      let candidateX = owner.pos.x + myDir * depthJitter;
      // Blend with formation X
      candidateX = candidateX * 0.6 + base.x * 0.4;
      candidateX = this.clampToAttackingLine(p.team, candidateX, 2.0);

      candidates.push({ x: candidateX, y: candidateY });
    }

    let bestPos = { x: owner.pos.x + myDir * 10, y: baseY };
    let bestScore = -Infinity;

    for (const c of candidates) {
      // Distance to nearest opponent (prefer open space)
      let nearestOppDist = Infinity;
      for (const opp of opponents) {
        nearestOppDist = Math.min(nearestOppDist, dist(c, opp.pos));
      }

      // Forward progress
      const forwardness = (c.x - p.pos.x) * myDir;

      // Anti-bunching: penalty for being near teammates
      let bunchPenalty = 0;
      for (const tm of teammates) {
        const d = dist(c, tm.pos);
        if (d < 8.0) {
          bunchPenalty += 2.0 * (8.0 - d); // Heavy penalty for close teammates
        } else if (d < 14.0) {
          bunchPenalty += 0.5 * (14.0 - d); // Light penalty for medium distance
        }
      }

      // Passing lane openness from owner
      let laneClear = Infinity;
      for (const opp of opponents) {
        laneClear = Math.min(laneClear, pointSegDist(opp.pos, owner.pos, c));
      }

      // Score combines all factors
      let score = nearestOppDist * 1.2
                  + forwardness * 0.4
                  + Math.min(laneClear, 8) * 0.6
                  - bunchPenalty * 1.5  // Heavy weight on anti-bunching
                  - Math.abs(c.y - baseY) * 0.1; // Slight preference for staying near formation Y

      // Bonus for being on the correct side (based on formation slot)
      const correctSide = (laneSide > 0 && c.y > 0) || (laneSide < 0 && c.y < 0);
      if (correctSide) score += 0.8;

      if (score > bestScore) {
        bestScore = score;
        bestPos = c;
      }
    }

    return bestPos;
  }

  private markReceiverTarget(p: SimPlayer, carrier: SimPlayer): Vec2 | null {
    if (p.attrs.pos === 'FW') return null;
    const dirToOwnGoal = -this.attackSign(p.team);
    // keep tracking the same runner for a beat instead of flickering between
    // men. Within the memo window we DON'T re-run the full threat test every
    // frame — a runner who dips just under a sprint/offside threshold for a
    // tick used to be dropped and a new man chosen, so markers visibly swapped
    // targets. Stay with the man unless he is clearly gone (out of range) or a
    // team-mate has since picked him up.
    const memo = this.markAssignments.get(p.idx);
    if (memo && memo.until > this.state.tick) {
      const held = this.state.players[memo.targetIdx];
      const heldByMate = held ? this.markedByTeammate(p, held.idx) : false;
      if (held && held.team !== p.team && held !== carrier && !held.isGK && !held.sentOff
        && dist(p.pos, held.pos) < 26 && !heldByMate) {
        return this.markingSpot(p, held, dirToOwnGoal);
      }
    }
    // a man already picked up by a teammate keeps his marker; take the most
    // dangerous free runner instead of doubling up and leaving someone loose
    const taken = new Set<number>();
    for (const [idx, m] of this.markAssignments) {
      if (idx === p.idx || m.until <= this.state.tick) continue;
      const teammate = this.state.players[idx];
      if (teammate && teammate.team === p.team && !teammate.sentOff) taken.add(m.targetIdx);
    }
    const candidates = this.state.players
      .filter((q) => q.team !== p.team && q !== carrier && !q.isGK && !q.sentOff)
      .filter((q) => this.isMarkingThreat(p, q, carrier))
      .filter((q) => {
        // don't peel off to "mark" a man a teammate already has unless he's an
        // immediate box danger — doubling a covered man in midfield left whoever he
        // came off (often the man pressing the ball) abandoning a real threat
        if (!taken.has(q.idx)) return true;
        return q.pos.x * dirToOwnGoal > HALF_LEN - 18;
      })
      .map((q) => {
        // threat = how deep the runner is toward OUR goal. Proximity to the
        // carrier is deliberately NOT a factor — weighting it herded every
        // marker into the crowd around the ball
        const receiverThreat = (q.pos.x * dirToOwnGoal) * 0.06;
        return { q, score: dist(p.pos, q.pos) - receiverThreat + (taken.has(q.idx) ? 14 : 0) };
      })
      .sort((a, b) => a.score - b.score);
    const pick = candidates[0];
    const best = pick?.q ?? null;
    if (!best || pick.score > 30) return null;
    this.markAssignments.set(p.idx, { targetIdx: best.idx, until: this.state.tick + Math.round(1.3 / DT) });
    return this.markingSpot(p, best, dirToOwnGoal);
  }

  /** is some other defender already actively assigned to mark targetIdx? */
  private markedByTeammate(marker: SimPlayer, targetIdx: number): boolean {
    for (const [idx, m] of this.markAssignments) {
      if (idx === marker.idx || m.until <= this.state.tick || m.targetIdx !== targetIdx) continue;
      const mate = this.state.players[idx];
      if (mate && mate.team === marker.team && !mate.sentOff) return true;
    }
    return false;
  }

  private isMarkingThreat(p: SimPlayer, target: SimPlayer, carrier: SimPlayer): boolean {
    const dirToOwnGoal = this.ownGoalDir(p.team);
    const lineProgress = this.defensiveLineX(p.team) * dirToOwnGoal;
    const targetProgress = target.pos.x * dirToOwnGoal;
    const inBehind = targetProgress > lineProgress + 1.2;
    const carrierDistance = dist(target.pos, carrier.pos);
    const closeSupport = carrierDistance < 14;
    const nearCarrierLane = Math.abs(target.pos.y - carrier.pos.y) < 17 || carrierDistance < 24;
    const centralEnough = Math.abs(target.pos.y) < HALF_WID - 6;
    const sprintingIntoGoal = target.vel.x * dirToOwnGoal > 1.4;
    const immediateBoxDanger = targetProgress > HALF_LEN - 24 && Math.abs(target.pos.y) < PENALTY_BOX_HALF_WIDTH + 3;
    if (closeSupport && !immediateBoxDanger) return false;
    if (inBehind && !this.canCarrierThreatenRunnerBehind(p.team, carrier, target)) return false;
    if (immediateBoxDanger) return true;
    if (p.attrs.pos === 'DF' && !inBehind) {
      const betweenLines = targetProgress > lineProgress - 9;
      const pullingWide = Math.abs(target.pos.y) > HALF_WID - 7;
      return !closeSupport && !pullingWide && centralEnough && betweenLines;
    }
    if (!inBehind) return nearCarrierLane || centralEnough;
    return (centralEnough && nearCarrierLane) || sprintingIntoGoal;
  }

  private canCarrierThreatenRunnerBehind(defendingTeam: 0 | 1, carrier: SimPlayer, runner: SimPlayer): boolean {
    const dirToOwnGoal = this.ownGoalDir(defendingTeam);
    const carrierProgress = carrier.pos.x * dirToOwnGoal;
    const runnerProgress = runner.pos.x * dirToOwnGoal;
    const passDistance = dist(carrier.pos, runner.pos);
    const centralRunner = Math.abs(runner.pos.y) < PENALTY_BOX_HALF_WIDTH + 4;
    const sprintingIntoGoal = runner.vel.x * dirToOwnGoal > 1.4;
    const immediateCentralDanger = runnerProgress > HALF_LEN - 24 && centralRunner;

    // If the passer is still deep, hold the line and leave the runner offside.
    // A defender should only track behind when the ball is close enough, central
    // enough, or travelling quickly enough to become an immediate through-ball.
    if (carrierProgress < -2) return false;
    if (passDistance > 42) return false;
    return carrierProgress > 8 || centralRunner || sprintingIntoGoal || immediateCentralDanger;
  }

  /** goal-side marking position against a specific runner */
  private markingSpot(p: SimPlayer, target: SimPlayer, dirToOwnGoal: number): Vec2 {
    // stay goal-side of the runner with more depth cushion
    // track the runner but position to intercept through balls
    const targetProgress = target.pos.x * -dirToOwnGoal; // toward our goal
    const pProgress = p.pos.x * -dirToOwnGoal;
    // Minimum distance to maintain goal-side (2.5m to prevent getting spun)
    const minGoalSide = 2.5;
    const currentGoalSide = pProgress - targetProgress;
    let depthOffset = currentGoalSide > minGoalSide ? 1.4 : minGoalSide + 0.5;
    // If runner is sprinting in behind, drop deeper
    const runnerVelTowardGoal = target.vel.x * dirToOwnGoal;
    if (runnerVelTowardGoal > 2) {
      depthOffset += 1.0; // Extra depth for fast runners
    }
    const rawX = target.pos.x + dirToOwnGoal * depthOffset;
    // Tighter Y tracking - stay directly goal-side
    return {
      x: clamp(rawX, -HALF_LEN + 4, HALF_LEN - 4),
      y: clamp(target.pos.y, -HALF_WID + 2, HALF_WID - 2),
    };
  }

  /** Interception point on the carrier's line to OUR goal that this defender can
   * still reach in time — so he cuts the angle and gets his body ACROSS the run,
   * rather than chasing the carrier's present position (which a carrier moving at
   * pace always leaves behind: the "runs straight between two defenders" goal we
   * keep conceding). We solve the classic pursuit: the earliest time `t` where the
   * defender (sprinting) and the carrier (driving along his line to goal) meet at
   * the same point, then aim there. Returns null when the carrier isn't driving at
   * goal, or the line is genuinely uncatchable — caller falls back to a tight
   * engage. */
  private goalCutoffTarget(p: SimPlayer, carrier: SimPlayer): Vec2 | null {
    const ownGoalDir = this.ownGoalDir(p.team);
    const goalX = ownGoalDir * HALF_LEN;
    // only cut the angle when the carrier is a real goal threat — within ~33m of
    // our goal. Further out this is a midfield press, where committing a man to a
    // straight-line interception just pulls him out of shape (a dribbler who jinks
    // leaves him stranded); leave that to the existing contain logic.
    if (Math.abs(goalX - carrier.pos.x) > 33) return null;
    // unit vector along the carrier's path to the centre of our goal
    let ux = goalX - carrier.pos.x;
    let uy = -carrier.pos.y;
    const ul = Math.hypot(ux, uy);
    if (ul < 1) return null;
    ux /= ul; uy /= ul;
    // only cut the angle off a carrier genuinely driving AT our goal — a slow or
    // sideways carrier is left to the existing contain logic
    const projVel = carrier.vel.x * ux + carrier.vel.y * uy;
    if (projVel < 2.2) return null;
    const cs = clamp(projVel, 4.5, 11); // carrier speed along the path
    const ds = this.maxSpeed(p, true); // defender at a full recovery sprint
    const ax = carrier.pos.x - p.pos.x;
    const ay = carrier.pos.y - p.pos.y;
    // |a + u*cs*t| = ds*t  ->  (cs^2 - ds^2) t^2 + 2(a.u)cs t + |a|^2 = 0
    const A = cs * cs - ds * ds;
    const B = 2 * (ax * ux + ay * uy) * cs;
    const C = ax * ax + ay * ay;
    let t: number;
    if (Math.abs(A) < 1e-3) {
      if (Math.abs(B) < 1e-6) return null;
      t = -C / B;
    } else {
      const disc = B * B - 4 * A * C;
      if (disc < 0) return null; // can't reach the line before he's gone
      const sq = Math.sqrt(disc);
      t = Math.min(...[(-B + sq) / (2 * A), (-B - sq) / (2 * A)].filter((v) => v > 0.02));
    }
    if (!isFinite(t) || t <= 0) return null;
    const lead = clamp(cs * t, 0, ul); // never aim past the goal itself
    return {
      x: clamp(carrier.pos.x + ux * lead, -HALF_LEN + 3, HALF_LEN - 3),
      y: clamp(carrier.pos.y + uy * lead, -HALF_WID + 2, HALF_WID - 2),
    };
  }

  private nonPressingDefensiveTarget(p: SimPlayer, carrier: SimPlayer, target: Vec2): Vec2 {
    if (p.attrs.pos !== 'MF') return target;
    const dirToOwnGoal = this.ownGoalDir(p.team);
    const profile = this.playerDecisionProfile(p);
    if (profile.defensiveScreen > 0.72 && Math.abs(carrier.pos.y) > PENALTY_BOX_HALF_WIDTH - 2) {
      const carrierProgress = carrier.pos.x * dirToOwnGoal;
      const screenProgress = clamp(carrierProgress + 7.8, -HALF_LEN + 8, HALF_LEN - 15);
      return {
        x: dirToOwnGoal * screenProgress,
        y: clamp(carrier.pos.y * 0.22 + p.slot.y * HALF_WID * 0.3, -10.5, 10.5),
      };
    }
    if (dist(target, carrier.pos) >= 8.5) return target;
    const side = Math.sign(p.slot.y || p.pos.y - carrier.pos.y || (p.idx % 2 ? 1 : -1));
    return {
      x: clamp(carrier.pos.x + dirToOwnGoal * 7.4, -HALF_LEN + 2, HALF_LEN - 2),
      y: clamp(carrier.pos.y + side * (9.5 + Math.abs(p.slot.y) * 8), -HALF_WID + 2, HALF_WID - 2),
    };
  }

  private centralCutbackScreenTarget(p: SimPlayer, carrier: SimPlayer, excludedIdxs: number[]): Vec2 | null {
    if (p.team === carrier.team || p.isGK || p.sentOff || p.attrs.pos === 'FW') return null;
    if (excludedIdxs.includes(p.idx)) return null;
    const runner = this.centralCutbackTarget(carrier);
    if (!runner) return null;
    const dir = this.attackSign(carrier.team);
    const carrierProgress = carrier.pos.x * dir;
    if (carrierProgress < HALF_LEN - 15) return null;
    const screenSpot = {
      x: clamp((carrier.pos.x + runner.pos.x) / 2 - dir * 0.7, -HALF_LEN + 3, HALF_LEN - 3),
      y: clamp((carrier.pos.y + runner.pos.y) / 2, -HALF_WID + 3, HALF_WID - 3),
    };
    const candidates = this.state.players
      .filter((q) => q.team === p.team && !q.isGK && !q.sentOff && !excludedIdxs.includes(q.idx))
      .filter((q) => q.attrs.pos === 'MF' || q.attrs.pos === 'DF')
      .map((q) => {
        const role = this.playerRole(q);
        const roleBias = role === 'holdingMidfielder' ? -1.2
          : q.attrs.pos === 'MF' ? -0.55
            : Math.abs(q.slot.y) < 0.35 ? 0.15 : 0.75;
        return { q, score: dist(q.pos, screenSpot) + roleBias + Math.abs(q.pos.y - screenSpot.y) * 0.04 };
      })
      .sort((a, b) => a.score - b.score);
    if (candidates[0]?.q.idx !== p.idx) return null;
    return screenSpot;
  }

  /** formation anchor warped toward the ball and adjusted for attack/defence */
  /** Low-quality sides lose their shape — outfield players slowly wander off their
   * formation slot, opening gaps. Elite sides hold a rigid block (no drift). Smooth
   * and low-frequency so it never twitches. */
  private positionalDrift(p: SimPlayer): Vec2 {
    if (p.isGK) return { x: 0, y: 0 };
    const slack = clamp((76 - this.cfg.teams[p.team].data.strength) / 18, 0, 1);
    if (slack <= 0.01) return { x: 0, y: 0 };
    const t = this.state.tick * DT;
    const mag = slack * 3.6;
    return {
      x: Math.sin(t * 0.45 + p.idx * 1.7) * mag,
      y: Math.cos(t * 0.37 + p.idx * 2.3) * mag * 0.8,
    };
  }

  private formationTarget(p: SimPlayer): Vec2 {
    const st = this.state;
    const base = this.slotToPitch(p.team, p.slot);
    const ball = st.ball;
    const owner = this.owner();
    const myDir = this.attackSign(p.team);
    const attacking = owner?.team === p.team;
    const tactic = this.teamTacticProfile(p.team);
    // shift with ball, more when attacking — track the smoothed ball so the
    // block glides instead of shuffling on every touch
    const ref = this.smoothBall;
    const shiftX = clamp(ref.x * (attacking ? 0.42 : 0.34) * 1, -18, 18);
    const shiftY = clamp(ref.y * 0.3, -10, 10);
    let x = base.x + shiftX;
    let y = base.y + shiftY;
    if (attacking && p.attrs.pos === 'FW') x += myDir * 6; // forwards push the line
    if (!attacking && !owner) x -= 0; // neutral
    if (!attacking && owner && p.attrs.pos !== 'GK') {
      const dirOwn = this.ownGoalDir(p.team);
      const lineProgress = this.defensiveLineX(p.team) * dirOwn;
      const coverDepth = Math.max(0, tactic.defensiveCover - 0.5);
      const roleOffset = p.attrs.pos === 'DF' ? coverDepth * 4.2 : p.attrs.pos === 'MF' ? -9.5 + coverDepth * 1.4 : -19.5;
      const stagger = p.attrs.pos === 'DF' ? clamp((p.slot.x + 0.68) * 2.2, -1.1, 1.1) : 0;
      const roleMin = p.attrs.pos === 'DF' ? 5 : p.attrs.pos === 'MF' ? -8 : -20;
      const progress = clamp(lineProgress + roleOffset + stagger, roleMin, HALF_LEN - 14.2);
      x = dirOwn * progress;
      // A wide player (winger / wide-mid / full-back) holds his flank when the
      // ball is wide on his side — he steps out to show on the line and engage
      // the man in possession rather than tucking inside with everyone else.
      const isWide = Math.abs(p.slot.y) > 0.5;
      const ballWideSameSide = Math.abs(ref.y) > 9 && Math.sign(ref.y) === Math.sign(p.slot.y || 1);
      y = isWide && ballWideSameSide
        ? clamp(base.y * 0.9 + ref.y * 0.27, -HALF_WID + 1, HALF_WID - 1)
        : clamp(base.y * 0.74 + ref.y * 0.2, -HALF_WID + 1, HALF_WID - 1);
      if (p.attrs.pos === 'DF') {
        const ownerProgress = owner.pos.x * dirOwn;
        const canHoldLine = ownerProgress < HALF_LEN - 18;
        if (canHoldLine) {
          // when this defender is the LAST man — no other outfielder goal-side of
          // the carrier — holding a 6.6m cover cushion just lets the carrier run
          // at goal (it reads as backpedalling away from the ball). The last man
          // steps up and contains tight instead; with cover behind he keeps the
          // normal cushion so the line stays compact.
          let goalSideCount = 0;
          for (const q of st.players) {
            if (q.team !== p.team || q.isGK || q.sentOff || q === owner) continue;
            if ((q.pos.x - owner.pos.x) * dirOwn > 0.5) goalSideCount++;
          }
          const minCoverGap = goalSideCount <= 1 ? 1.6 : 6.6;
          const yGap = Math.abs(y - owner.pos.y);
          const requiredGoalSide = Math.sqrt(Math.max(0, minCoverGap * minCoverGap - yGap * yGap));
          const currentGoalSide = (x - owner.pos.x) * dirOwn;
          if (currentGoalSide < requiredGoalSide) {
            x = dirOwn * clamp(ownerProgress + requiredGoalSide, roleMin, HALF_LEN - 14.2);
          }
        }
      }
    }
    // hold the sticky attacking block: a back line (or screening midfield) that
    // stepped up during a spell of pressure must not drop home the instant the
    // ball runs loose between passes. blockPush decays once possession is truly
    // lost, so this only props the line up during/just-after our own attacks.
    if (p.attrs.pos !== 'GK') {
      const anchor = this.blockPush[p.team];
      if (anchor > -HALF_LEN + 0.5) {
        let floor = p.attrs.pos === 'DF' ? anchor : p.attrs.pos === 'MF' ? anchor + 8 : anchor + 16;
        if (attacking && this.isCentreBack(p)) floor = Math.min(floor, this.attackingCentreBackProgressCap(p.team));
        if (x * myDir < floor) x = myDir * floor;
      }
    }
    const drift = this.positionalDrift(p);
    return { x: clamp(x + drift.x, -HALF_LEN + 2, HALF_LEN - 2), y: clamp(y + drift.y, -HALF_WID + 1, HALF_WID - 1) };
  }

  private defensiveLineX(team: 0 | 1): number {
    const dirOwn = this.ownGoalDir(team);
    const owner = this.owner();
    const reference = owner && owner.team !== team ? owner.pos : this.smoothBall;
    const pressureProgress = reference.x * dirOwn;
    // Hold a real back line. In midfield the line keeps a proper cushion
    // behind the press; near the box it compresses so defenders can engage
    // without camping on the goal line.
    const tactic = this.teamTacticProfile(team);
    const lineBias = this.teamMentality(team).lineBias + Math.max(0, tactic.defensiveCover - 0.55) * 2.8;
    const holdProgress = clamp(pressureProgress + 9.5 + lineBias, 2, HALF_LEN - 21);
    const dangerProgress = clamp(pressureProgress + 2.2 + lineBias * 0.35, 2, HALF_LEN - 16);
    const dangerBlend = clamp((pressureProgress - (HALF_LEN - 27)) / 10, 0, 1);
    // lineProgress is distance BEHIND the pressure point, so shrinking it pushes
    // the back line up the pitch. A front-foot side holds a literally higher
    // line (squeezing the game high), a cautious side drops deeper. This is the
    // correctly-signed line lever (raw lineBias is pressure-relative, not a
    // high/low-line knob — see notes in defensiveLineX history).
    const lineRaise = this.teamIdentity(team).aggression * 3.5;
    const lineProgress = clamp(
      holdProgress * (1 - dangerBlend) + dangerProgress * dangerBlend - lineRaise,
      2,
      HALF_LEN - 16,
    );
    return dirOwn * lineProgress;
  }

  private pressCache: Record<number, { until: number; carrierIdx: number; result: PressAssignments }> = {};

  private pressAssignments(team: 0 | 1, carrier: SimPlayer): PressAssignments {
    // roles stick for a beat: re-evaluating every tick made defenders flip
    // between dropping deep and charging out for no visible reason
    const cached = this.pressCache[team];
    // if the carrier has dribbled GOAL-SIDE of the assigned presser, that man
    // has been beaten — tear up the assignment immediately so a covering
    // defender steps out to close the ball down instead of everyone holding
    // their man. Otherwise the press sticks for a beat to avoid flip-flopping.
    const primary = cached?.result.primary;
    const beaten = !!primary
      && (carrier.pos.x - primary.pos.x) * this.ownGoalDir(team) > 1.5;
    // The presser stays COMMITTED to the carrier until he is genuinely beaten (ball
    // goes goal-side of him), loses touch (>14m), or is sent off — NOT merely until a
    // 0.7s timer lapses. Recomputing mid-press let a near-tie flip the presser, and
    // the man dropped from the press would peel off to "mark" someone a teammate
    // already had, leaving the carrier a free run at goal.
    const valid = cached
      && cached.carrierIdx === carrier.idx
      && cached.result.primary && !cached.result.primary.sentOff
      && !beaten
      && dist(cached.result.primary.pos, carrier.pos) < 14;
    if (valid) return cached!.result;
    const result = this.computePressAssignments(team, carrier);
    this.pressCache[team] = {
      until: this.state.tick + Math.round(0.7 / DT),
      carrierIdx: carrier.idx,
      result,
    };
    return result;
  }

  private computePressAssignments(team: 0 | 1, carrier: SimPlayer): PressAssignments {
    const ownGoalDir = this.ownGoalDir(team);
    const lineX = this.defensiveLineX(team);
    const tactic = this.teamTacticProfile(team);
    const pressLimit = Math.max(1, Math.round(this.teamMentality(team).pressLimit - Math.max(0, tactic.defensiveCover - 0.72)));
    const carrierBehindLine = (carrier.pos.x - lineX) * ownGoalDir > 0.7;
    const carrierNearGoal = carrier.pos.x * ownGoalDir > HALF_LEN - 22;
    const emergency = carrierBehindLine && carrierNearGoal;
    const maxPressers = emergency ? Math.max(2, pressLimit) : pressLimit;
    const carrierWide = Math.abs(carrier.pos.y) > PENALTY_BOX_HALF_WIDTH + 4;
    // a carrier arriving in the defensive third is engaged by the nearest
    // defender as a matter of course, not only in a last-ditch emergency —
    // the old binary (never press / suddenly charge) read as defenders
    // flipping their minds; outside that zone midfielders do the pressing
    const carrierInDefThird = carrier.pos.x * ownGoalDir > HALF_LEN - 30;
    // a carrier driving unopposed at our defence — his marker beaten, with no
    // teammate goal-side and tight to him — is met by a covering defender EARLIER,
    // not left to run all the way to the defensive third before anyone steps out
    const carrierAdvancing = carrier.vel.x * ownGoalDir > 2.0;
    // genuine goal-side cover = a teammate tight AND roughly in line with the
    // carrier (a man 4.5m away or out wide is easily slipped, so he doesn't count)
    const hasGoalSideCover = this.state.players.some((q) =>
      q.team === team && !q.isGK && !q.sentOff && q !== carrier
      && (q.pos.x - carrier.pos.x) * ownGoalDir > 0.3
      && dist(q.pos, carrier.pos) < 3.6
      && Math.abs(q.pos.y - carrier.pos.y) < 4.5);
    // step out to close down a carrier with a clear lane to goal — whether he is
    // already driving forward OR has just received in space and can line up a
    // shot/run (the old gate needed him sprinting, so unopposed shooters were left)
    const carrierThreateningGoal = carrier.pos.x * ownGoalDir > HALF_LEN - 34;
    // "no one else is goal-side, so stop retreating and engage": count our own
    // outfielders between the carrier and our goal. If at most one is (i.e. the
    // last man, or nobody), whoever is nearest MUST confront the carrier rather
    // than dropping off — wherever on the pitch this is. Without this a beaten /
    // unsupported last defender keeps backpedalling away from the ball.
    const goalSideOutfielders = this.state.players.filter((q) =>
      q.team === team && !q.isGK && !q.sentOff && q !== carrier
      && (q.pos.x - carrier.pos.x) * ownGoalDir > 0.5).length;
    const lastManSituation = goalSideOutfielders <= 1 && carrier.pos.x * ownGoalDir > -2;
    const engageEarly = (!hasGoalSideCover
      && (carrierAdvancing || carrierThreateningGoal)
      && carrier.pos.x * ownGoalDir > HALF_LEN - 46)
      || lastManSituation;
    const candidates = this.state.players
      .filter((p) => p.team === team && !p.isGK && !p.sentOff)
      .map((p) => {
        const d = dist(p.pos, carrier.pos);
        const role = this.playerRole(p);
        let roleBias = p.attrs.pos === 'DF'
          ? (emergency || d < 1.15 ? 0.1 : (carrierInDefThird || engageEarly) ? 0.9 : 3.2)
          : p.attrs.pos === 'MF'
            ? -1.4
            : 0.8;
        if (carrierWide && p.attrs.pos === 'DF') {
          const fullBack = role === 'overlapFullBack' || role === 'defensiveFullBack';
          const sameSide = Math.sign(p.slot.y || p.pos.y || carrier.pos.y) === Math.sign(carrier.pos.y);
          if (fullBack && sameSide) roleBias -= 1.35;
          if (!fullBack) roleBias += 1.1;
        }
        if (role === 'holdingMidfielder' && !emergency) roleBias += carrierWide ? 0.7 : 0.25;
        roleBias -= this.playerDecisionProfile(p).pressBias * 0.35;
        // strongly favour a defender who is GOAL-SIDE of the carrier as the
        // presser — he can actually engage, where a man the carrier has already
        // gone past just trails the play. This is what makes a beaten defender
        // get replaced by a covering one rather than everyone marking space.
        const betweenBallAndGoal = (p.pos.x - carrier.pos.x) * ownGoalDir > -0.5 ? -0.85 : 1.3;
        return { p, d, score: d + roleBias + betweenBallAndGoal + Math.abs(p.pos.y - carrier.pos.y) * 0.04 };
      })
      .sort((a, b) => a.score - b.score);
    const primary = candidates[0]?.p ?? null;
    const secondary = maxPressers >= 2
      ? candidates
        .filter(({ p }) => p !== primary)
        .filter(({ p }) => emergency || p.attrs.pos !== 'DF')
        .sort((a, b) => a.d - b.d)[0]?.p ?? null
      : null;
    let tertiary: SimPlayer | null = null;
    let dangerousReceiver: SimPlayer | null = null;
    if (emergency && maxPressers >= 3) {
      // most advanced unmarked opponent near our goal gets his lane shadowed
      let bestThreat = -Infinity;
      for (const q of this.state.players) {
        if (q.team === team || q === carrier || q.isGK || q.sentOff) continue;
        const threat = q.pos.x * ownGoalDir;
        if (threat > HALF_LEN - 30 && threat > bestThreat) { bestThreat = threat; dangerousReceiver = q; }
      }
      if (dangerousReceiver) {
        tertiary = candidates
          .map(({ p }) => p)
          .filter((p) => p !== primary && p !== secondary)
          .sort((a, b) => dist(a.pos, dangerousReceiver!.pos) - dist(b.pos, dangerousReceiver!.pos))[0] ?? null;
      }
    }
    return { primary, secondary, tertiary, dangerousReceiver };
  }

  /** within ~3 seconds of winning the ball back the team plays quicker and more direct */
  private inTransition(team: 0 | 1): boolean {
    return this.lastTurnover.team === team && this.state.tick - this.lastTurnover.tick < Math.round(3 / DT);
  }

  /** x of the opposition's second-last outfielder — the line a through ball plays behind */
  private oppositionDefLineX(team: 0 | 1): number {
    const dir = this.attackSign(team);
    let p1 = -Infinity;
    let p2 = -Infinity;
    for (const q of this.state.players) {
      if (q.team === team || q.isGK || q.sentOff) continue;
      const prog = q.pos.x * dir;
      if (prog > p1) { p2 = p1; p1 = prog; } else if (prog > p2) p2 = prog;
    }
    if (!Number.isFinite(p2)) return dir * (HALF_LEN - 12);
    return dir * clamp(p2, -HALF_LEN + 12, HALF_LEN - 8);
  }

  /** widest vertical gap in the opposition line — where a runner should dart */
  private openChannelY(team: 0 | 1): number {
    const st = this.state;
    const myDir = this.attackSign(team);
    const ballY = st.ball.pos.y;

    // Consider all opponents near the ball, not just defenders
    const ys = st.players
      .filter((q) => q.team !== team && !q.isGK && !q.sentOff)
      .map((q) => q.pos.y)
      .sort((a, b) => a - b);

    const edges = [-HALF_WID + 8, ...ys, HALF_WID - 8];
    let bestGap = 0;
    let bestY = ballY; // Default to ball Y if no clear gaps

    for (let i = 1; i < edges.length; i++) {
      const gap = edges[i] - edges[i - 1];
      const gapCenter = (edges[i] + edges[i - 1]) / 2;
      // Bonus for gaps closer to ball Y (more accessible passes)
      const ballProximity = 1.0 / (1.0 + Math.abs(gapCenter - ballY) * 0.1);
      const score = gap + ballProximity * 5;

      if (score > bestGap) {
        bestGap = score;
        bestY = gapCenter;
      }
    }

    // Blend with ball Y to ensure the channel is accessible
    bestY = bestY * 0.7 + ballY * 0.3;
    bestY = clamp(bestY, -HALF_WID + 6, HALF_WID - 6);

    // hold the chosen channel for a beat and ease toward new picks, so runners
    // commit to a gap instead of snapping between two as defenders jostle
    const memo = this.openChannelMemo.get(team);
    if (memo && memo.until > st.tick) {
      memo.y += (bestY - memo.y) * 0.12;
      return memo.y;
    }
    this.openChannelMemo.set(team, { y: bestY, until: st.tick + Math.round(0.5 / DT) });
    return bestY;
  }

  private clampToAttackingLine(team: 0 | 1, x: number, margin: number): number {
    const dir = this.attackSign(team);
    const lineX = this.defensiveLineX((1 - team) as 0 | 1);
    const limit = lineX - dir * margin;
    return dir > 0 ? Math.min(x, limit) : Math.max(x, limit);
  }

  private kickoffFormationTarget(p: SimPlayer): Vec2 {
    const base = this.slotToPitch(p.team, p.slot);
    const dir = this.attackSign(p.team);
    const target = {
      x: dir > 0 ? Math.min(base.x, -1) : Math.max(base.x, 1),
      y: clamp(base.y, -HALF_WID + 1, HALF_WID - 1),
    };
    if (p.team !== this.state.restartTeam) {
      const d = Math.hypot(target.x, target.y);
      if (d < CENTER_CIRCLE_R + 0.3) {
        const a = Math.atan2(target.y, target.x || (dir > 0 ? -1 : 1));
        target.x = Math.cos(a) * (CENTER_CIRCLE_R + 0.35);
        target.y = Math.sin(a) * (CENTER_CIRCLE_R + 0.35);
        target.x = dir > 0 ? Math.min(target.x, -1) : Math.max(target.x, 1);
      }
    }
    return target;
  }

  private aiWantsSprint(p: SimPlayer, target: Vec2): boolean {
    if (p.stamina < 0.2) return false;
    const d = dist(p.pos, target);
    if (d < 3) return false;
    const ball = this.state.ball;
    const owner = this.owner();
    const nearBall = dist(p.pos, ball.pos) < 18;
    const targetNearBall = dist(target, ball.pos) < 8;

    if (!owner) {
      // the intended receiver of a pass attacks his ball at full pace
      const isPassTarget = this.livePassTargetIdx === p.idx && this.state.tick <= this.livePassTargetUntil;
      return isPassTarget || nearBall || targetNearBall;
    }
    if (owner === p) {
      const progress = p.pos.x * this.attackSign(p.team);
      return progress < HALF_LEN - 9;
    }
    if (owner.team !== p.team) {
      const closingCarrier = dist(target, owner.pos) < 4;
      const coveringCarrier = dist(target, owner.pos) < 8 && p.attrs.pos !== 'DF';
      // tracking a runner goal-side: go with him at full pace, don't jog
      // behind and concede the free run
      const trackingRun = (target.x - p.pos.x) * this.ownGoalDir(p.team) > 1.2 && d > 3.5;
      return (closingCarrier && dist(p.pos, owner.pos) < 30) || coveringCarrier || trackingRun;
    }

    const dir = this.attackSign(p.team);
    const movingAhead = target.x * dir > p.pos.x * dir + 3;
    const bunchedNearCarrier = dist(p.pos, owner.pos) < 8 && dist(target, owner.pos) > 10;
    if ((p.attrs.pos === 'FW' || p.attrs.pos === 'MF') && bunchedNearCarrier && d > 4.5) return true;
    if ((p.attrs.pos === 'FW' || p.attrs.pos === 'MF') && movingAhead && d > 7) return true;
    return d > 8 && (nearBall || targetNearBall);
  }

  private dribbleTarget(p: SimPlayer): Vec2 {
    const myDir = this.attackSign(p.team);
    const profile = this.playerDecisionProfile(p);
    const progress = p.pos.x * myDir;
    // Time wasting: head to the nearest corner in opponent's half
    if (this.shouldGoToCorner(p)) {
      const cornerY = p.pos.y > 0 ? HALF_WID - 2 : -HALF_WID + 2;
      const cornerX = myDir * (HALF_LEN - 3);
      return { x: cornerX, y: cornerY };
    }
    if (profile.wideCarry > 0.68
      && progress > HALF_LEN - 42
      && Math.abs(p.pos.y) > PENALTY_BOX_HALF_WIDTH - 2) {
      const side = Math.sign(p.pos.y || p.slot.y || 1);
      const laneY = side * (HALF_WID - 4);
      return {
        x: myDir * clamp(progress + 10 + profile.carryBias * 4, -HALF_LEN + 4, HALF_LEN - 4.5),
        y: clamp(p.pos.y * 0.72 + laneY * 0.28, -HALF_WID + 3, HALF_WID - 3),
      };
    }
    const goal = { x: myDir * HALF_LEN, y: 0 };
    // veer away from nearest opponent
    let nearest: SimPlayer | null = null;
    let nd = Infinity;
    for (const q of this.state.players) {
      if (q.team === p.team) continue;
      const d = dist(q.pos, p.pos);
      if (d < nd) { nd = d; nearest = q; }
    }
    const t = { x: goal.x, y: goal.y + (p.pos.y > 0 ? -4 : 4) };
    if (nearest && nd < 4) {
      let ax = p.pos.x - nearest.pos.x;
      let ay = p.pos.y - nearest.pos.y;
      // hard against a touchline, veering "away" from an infield defender just runs him
      // straight out for a throw-in (and he stalls against the line while he's bundled
      // over it). When he's near the line and the escape points further out, flip the
      // lateral component so he cuts back INFIELD and keeps driving forward instead.
      if (HALF_WID - Math.abs(p.pos.y) < 5 && Math.sign(ay || 0) === Math.sign(p.pos.y || 1)) {
        ay = -Math.sign(p.pos.y || 1) * Math.abs(ay);
      }
      const away = Math.atan2(ay, ax);
      t.x = p.pos.x + Math.cos(away) * 4 + myDir * 7;
      t.y = clamp(p.pos.y + Math.sin(away) * 4, -HALF_WID + 4, HALF_WID - 4);
    }
    return t;
  }

  /** AI owner decisions: shoot / pass / keep dribbling. Called each tick. */
  private updateAIWithBall() {
    const st = this.state;
    const owner = this.owner();
    if (!owner || owner.kickCooldown > 0) return;
    if (this.maybeCallPendingOffside(owner)) return;
    const humanTeam = this.cfg.teams[owner.team].controller !== 'ai';
    if (humanTeam && !owner.isGK) return; // the next control pass hands the receiver to the human
    // the human controls his keeper while he holds a caught ball, but if he doesn't
    // throw/clear it within the hold window the CPU clears it for him (long, below)
    if (humanTeam && owner.control && !(owner.isGK && st.ball.held)) return; // human decides
    if (humanTeam && owner.isGK && st.ball.held && this.humans[owner.team].passHeldSince >= 0) return;
    const nextAt = this.aiDecideAt.get(owner.idx) ?? 0;
    if (st.tick < nextAt) {
      // keep dribbling
      if (!owner.isGK) this.dribbleTouch(owner, this.dribbleTarget(owner));
      return;
    }
    const mentality = this.teamMentality(owner.team);
    const reactionScale = this.inTransition(owner.team) ? 0.6 : clamp(1 / mentality.tempo, 0.74, 1.15);
    // attribute-driven cadence: elite sides snap onto decisions, weak sides hesitate
    this.aiDecideAt.set(owner.idx, st.tick + Math.round((this.aiReactionBase(owner) * reactionScale + this.rng.range(0, 0.08)) / DT));

    const myDir = this.attackSign(owner.team);
    const goal = { x: myDir * HALF_LEN, y: 0 };
    const dGoal = dist(owner.pos, goal);
    const pressure = this.nearestOpponentDist(owner);
    const clearChance = this.isClearScoringChance(owner, goal);
    const profile = this.playerDecisionProfile(owner);

    // GK with ball: throw/roll it short when a man is genuinely free,
    // otherwise go long. A held ball can always pick the short option safely.
    if (owner.isGK) {
      // ...but a keeper sprawled mid-dive can't spring up and hoof it up the pitch.
      // Rather than leave the ball loose at his feet (a clearance up the pitch, or a
      // tap-in for an attacker), he gathers it safely into his hands and waits until
      // the dive has played out before he distributes — he only clears once he's up.
      if (owner.diving || owner.slideTimer > 0) {
        if (!st.ball.held) this.beginGkHold(owner);
        return;
      }
      // a human-team keeper only reaches here when the player did NOT throw/clear
      // within the hold window — so hoof it long to safety rather than risk a short
      // roll an opponent near the box can pounce on
      if (humanTeam) { this.gkDistribute(owner, 'long'); return; }
      const short = this.gkShortOption(owner);
      const unpressed = pressure > 13 || st.ball.held === true;
      // just after a save, keep the ball in the area — roll it out short rather than
      // hoofing it straight back to the other end, so a half-cleared chance becomes
      // sustained pressure instead of an instant counter
      const justSaved = st.tick - this.lastSaveTick < Math.round(4 / DT);
      const shortBias = justSaved
        ? 0.85
        : clamp(0.28 + this.teamQuality(owner.team) * 0.12, 0.16, 0.44);
      // default to launching it long and downfield; only roll it short to a
      // genuinely free man, and even then only some of the time
      if (short && (unpressed || justSaved) && this.rng.next() < shortBias) {
        this.gkDistribute(owner, 'short');
      } else {
        this.gkDistribute(owner, 'long');
      }
      return;
    }

    // Through on goal with a clear run: don't blaze from outside the box. While the
    // keeper is still rooted on his line and nobody is breathing down his neck, the
    // attacker carries into a high-quality finishing position first. Once inside a
    // real range (~15m), or once the keeper commits and rushes off his line, he
    // takes it on (the shoot block / aiShoot one-on-one finish below handles that).
    if (clearChance) {
      const oppKeeper = st.players.find((p) => p.team !== owner.team && p.isGK && !p.sentOff);
      const keeperOffLine = oppKeeper ? Math.abs(oppKeeper.pos.x - goal.x) : 99;
      if (dGoal > 15.5 && keeperOffLine < 4.5 && pressure > 4) {
        this.dribbleTouch(owner, this.dribbleTarget(owner));
        return;
      }
    }

    // shoot?
    const shootRange = 24 + owner.attrs.shoot * 0.08;
    const angleOk = Math.abs(owner.pos.y) < 24;
    const ownerProgress = owner.pos.x * myDir;
    // an instinctive snap is a reaction chance in/around the box, NOT a 30m
    // speculative effort — capping the distance stops poachers blazing from range
    const instinctiveShot = profile.shootAggression > 0.82
      && ownerProgress > HALF_LEN - 32
      && dGoal < 20
      && pressure > 4.2;
    // A long-range effort is the EXCEPTION, not the default. The old gate let a
    // player SNATCH a shot from distance whenever a defender closed within 6m
    // (`pressure < 6`), so under a tight press the AI blasted 25m+ efforts every
    // possession instead of passing out — constant speculative shooting (and, against
    // a beatable keeper, an outside-the-box goal glut). From 18m+ it now only shoots
    // with a clear sight of goal, an instinctive snap, or a DELIBERATE effort from a
    // willing shooter in a real pocket of central space; merely pressured at range it
    // builds into the box instead. (`pressure` is distance to the nearest opponent —
    // higher means more space.)
    const longShot = dGoal >= 18;
    // A speculative long effort under pressure is the EXCEPTION: from 18m+ the AI
    // shoots with a clear sight of goal, an instinctive snap, or a deliberate effort
    // from a willing shooter in a pocket of central space — rarely from real distance.
    // (Long-range shots are kept honest by the keeper-distance penalty, not by banning
    // them, so the user still gets the odd screamer that mostly gets saved.)
    const longShotRate = dGoal < 23 ? 0.18 : 0.06;
    const openLongShot = longShot && pressure > 6.5 && Math.abs(owner.pos.y) < 15
      && profile.shootAggression > 0.55 && this.rng.next() < longShotRate;
    const shootGate = clearChance || instinctiveShot
      || (!longShot && (pressure < 6 || dGoal < 14))
      || openLongShot;
    if (dGoal < shootRange + (instinctiveShot ? 2 : 0) && angleOk && shootGate) {
      const chance = clamp(((owner.attrs.shoot / 100) * 0.88 + profile.shootAggression * 0.16) * this.formFactor(owner), 0.08, 0.98);
      if (clearChance || instinctiveShot || openLongShot || this.rng.next() < chance) {
        this.aiShoot(owner, goal, pressure, clearChance);
        return;
      }
    }

    const cross = this.aiCrossOption(owner);
    if (cross) {
      this.kickBall(owner, cross.aim, cross.speed, cross.loft, cross.target.idx);
      this.emitPass(owner, cross.target.idx, 0.68);
      this.emit({ type: 'kick', team: owner.team, power: 0.68 });
      this.triggerBoxRuns(owner.team, owner.idx, owner.pos.y);
      return;
    }

    const centralChance = this.centralChanceOption(owner);
    if (centralChance) {
      this.kickBall(owner, centralChance.aim, centralChance.speed, centralChance.loft, centralChance.target.idx);
      this.emitPass(owner, centralChance.target.idx, centralChance.power);
      this.emit({ type: 'kick', team: owner.team, power: centralChance.power });
      if (centralChance.through) {
        this.forwardRuns.set(centralChance.target.idx, {
          until: st.tick + Math.round(2.2 / DT),
          target: centralChance.aim,
        });
      }
      return;
    }

    // Evaluate pass options with forward bias
    const opt = this.bestPassOption(owner, false, true);
    const forwardness = opt ? (opt.aim.x - owner.pos.x) * myDir : 0;
    const isForwardPass = forwardness > 1.5;
    const isClearingForward = forwardness > 4;

    // Strongly prefer forward passes; sideways/backward only when pressured or exhausted
    const pressured = pressure < 4.5;
    const exhausted = owner.stamina < 0.25;
    const riskThreshold = 0.8 / clamp(mentality.risk + (profile.passUrgency - 0.5) * 0.34, 0.78, 1.42);
    const passTempo = clamp(mentality.tempo, 0.92, 1.15);
    const hasGoodForwardOption = opt && isForwardPass && opt.score > riskThreshold;
    const hasAnyGoodOption = opt && opt.score > 1.2 / clamp(mentality.risk + (profile.passUrgency - 0.5) * 0.22, 0.85, 1.3);
    const hasViableOutlet = opt && opt.score > 0.65;

    // pass under pressure or when a clearly better option exists; with open
    // grass ahead and no one closing, carry the ball forward instead of
    // recycling it sideways between the back four
    const forwardSpace = this.hasForwardSpace(owner);

    // Decision: pass forward aggressively, sideways only under pressure, backward as last resort
    if (hasGoodForwardOption || (pressured && hasAnyGoodOption) || (exhausted && hasViableOutlet)) {
      // Only pass sideways/backward if truly pressured or no forward option exists
      if (!isForwardPass && !pressured && !exhausted) {
        // Try to find a forward option specifically
        const forwardOpt = this.bestForwardPassOption(owner);
        if (forwardOpt && !clearChance) {
          const d = dist(owner.pos, forwardOpt.aim);
          const speed = (forwardOpt.through ? clamp(14 + d * 0.55, 16, 26) : clamp(12 + d * 0.6, 13, 24)) * passTempo;
          this.kickBall(owner, forwardOpt.aim, speed, forwardOpt.through ? 0.04 : d > 25 ? 0.3 : 0.05, forwardOpt.targetIdx);
          this.emitPass(owner, forwardOpt.targetIdx, 0.5);
          this.emit({ type: 'kick', team: owner.team, power: 0.5 });
          return;
        }
        // No good forward pass - keep dribbling if space allows
        if (pressure > 5 && this.isFacingForward(owner)) {
          this.dribbleTouch(owner, this.dribbleTarget(owner));
          return;
        }
      }
      if (opt && opt.score > 0.65 && !clearChance) {
        const d = dist(owner.pos, opt.aim);
        const speed = (opt.through ? clamp(14 + d * 0.55, 16, 26) : clamp(12 + d * 0.6, 13, 24)) * passTempo;
        this.kickBall(owner, opt.aim, speed, opt.through ? 0.04 : d > 25 ? 0.3 : 0.05, opt.targetIdx);
        this.emitPass(owner, opt.targetIdx, 0.5);
        this.emit({ type: 'kick', team: owner.team, power: 0.5 });
        return;
      }
    }

    // No good pass option - dribble forward if space, otherwise safe pass back
    if (pressure > 5 && this.isFacingForward(owner)) {
      this.dribbleTouch(owner, this.dribbleTarget(owner));
      return;
    }

    // Last resort: use an outlet only if it is meaningfully safer than keeping
    // the ball. A low-scoring clustered layoff just keeps the attack bunched.
    if (pressured && opt && opt.score > 0.65 && !clearChance) {
      const d = dist(owner.pos, opt.aim);
      const speed = (opt.through ? clamp(14 + d * 0.55, 16, 26) : clamp(12 + d * 0.6, 13, 24)) * passTempo;
      this.kickBall(owner, opt.aim, speed, opt.through ? 0.04 : d > 25 ? 0.3 : 0.05, opt.targetIdx);
      this.emitPass(owner, opt.targetIdx, 0.5);
      this.emit({ type: 'kick', team: owner.team, power: 0.5 });
      return;
    }

    // Default: keep dribbling
    this.dribbleTouch(owner, this.dribbleTarget(owner));
  }

  private aiShoot(owner: SimPlayer, goal: Vec2, pressure = 99, clearChance = false) {
    const dGoal = dist(owner.pos, goal);
    const closeCentral = dGoal < 14 && Math.abs(owner.pos.y) < GOAL_HALF_WIDTH * 1.35;
    const narrowAngle = dGoal < 18 && Math.abs(owner.pos.y) > GOAL_HALF_WIDTH * 1.25;
    const opponentKeeper = this.state.players.find((p) => p.team !== owner.team && p.isGK && !p.sentOff);
    const keeperGap = opponentKeeper ? Math.abs(opponentKeeper.pos.x - goal.x) : 99;
    // a genuine one-on-one: clean through with the keeper off his line and committed
    const oneOnOne = clearChance && dGoal < 22 && keeperGap > 1.5;
    let intendedY: number;
    if (oneOnOne) {
      // a real striker rounds the situation and slots it into the FAR side — the
      // corner away from his diagonal run / from where the keeper is shading. A
      // good finisher (tight error cone) buries it; a poor one drags it wide.
      const keeperY = opponentKeeper ? opponentKeeper.pos.y : 0;
      const shooterSide = Math.abs(owner.pos.y) > 1.2
        ? Math.sign(owner.pos.y)
        : (Math.abs(keeperY) > 0.6 ? Math.sign(keeperY) : (this.rng.next() < 0.5 ? -1 : 1));
      intendedY = -shooterSide * this.rng.range(GOAL_HALF_WIDTH * 0.62, GOAL_HALF_WIDTH * 0.94);
    } else if (narrowAngle) {
      // From a tight angle, finish across the keeper instead of poking it at
      // the near-post body shape.
      intendedY = -Math.sign(owner.pos.y || 1) * this.rng.range(GOAL_HALF_WIDTH * 0.68, GOAL_HALF_WIDTH * 0.94);
    } else if (closeCentral) {
      const awayFromKeeper = opponentKeeper
        ? (opponentKeeper.pos.y >= 0 ? -1 : 1)
        : (this.rng.next() < 0.5 ? -1 : 1);
      intendedY = awayFromKeeper * this.rng.range(GOAL_HALF_WIDTH * 0.52, GOAL_HALF_WIDTH * 0.88);
    } else {
      intendedY = this.rng.range(-GOAL_HALF_WIDTH * 0.88, GOAL_HALF_WIDTH * 0.88);
    }
    const aimY = this.applyShotSkillToAimY(owner, intendedY, dGoal, pressure);
    // power leans harder on finishing so elite strikers hit it like a train
    const power = closeCentral
      ? clamp(22 + dGoal * 0.46 + owner.attrs.shoot * 0.12 + this.rng.range(0, 2.4), 26, 39)
      : narrowAngle
        ? clamp(20 + dGoal * 0.54 + owner.attrs.shoot * 0.11 + this.rng.range(0, 2.1), 24, 37)
        : clamp(17.5 + dGoal * 0.5 + owner.attrs.shoot * 0.11 + this.rng.range(0, 2.5), 20, 38);
    const loft = oneOnOne
      ? this.rng.range(0.04, 0.1) // keep the finish low and placed, around the keeper
      : closeCentral
        ? this.rng.range(0.075, 0.14)
        : narrowAngle
          ? this.rng.range(0.08, 0.16)
          : this.rng.range(0.14, 0.28);
    this.kickBall(owner, { x: goal.x, y: aimY }, power, loft);
    this.shotLive = true;
    this.emit({ type: 'shot', team: owner.team, power: power / 30 });
    this.state.excitement = Math.min(1, this.state.excitement + 0.35);
  }

  /** an open defender or midfielder the keeper can roll/throw it to safely */
  private gkShortOption(owner: SimPlayer): { aim: Vec2; targetIdx: number } | null {
    const st = this.state;
    let short: { aim: Vec2; targetIdx: number } | null = null;
    let bestScore = 2.4;
    for (const q of st.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      if (q.attrs.pos !== 'DF' && q.attrs.pos !== 'MF') continue;
      const d = dist(owner.pos, q.pos);
      if (d < 6 || d > 26) continue;
      let lane = Infinity;
      for (const o of st.players) {
        if (o.team === owner.team || o.sentOff) continue;
        lane = Math.min(lane, pointSegDist(o.pos, owner.pos, q.pos));
      }
      // the receiver needs real room to take a touch — not a defender breathing
      // down his neck — so only roll it short to a genuinely free man
      if (this.nearestOpponentDist(q) < 7) continue;
      const score = lane + (q.attrs.pos === 'DF' ? 0.4 : 0);
      if (lane > 2.4 && score > bestScore) {
        bestScore = score;
        short = { aim: this.passAimForReceiver(owner, q, false), targetIdx: q.idx };
      }
    }
    return short;
  }

  private goalkeeperLongTarget(owner: SimPlayer, inp: PadInput, forceClearance: boolean): { aim: Vec2; targetIdx: number; speed: number; loft: number } {
    const myDir = this.attackSign(owner.team);
    let dx = inp.moveX;
    let dy = inp.moveY;
    const mag = len(dx, dy);
    if (mag > 0.15) {
      dx /= mag;
      dy /= mag;
      // A keeper long ball is for escaping pressure. If the stick is square or
      // backwards, still drive it upfield while preserving the requested side.
      if (dx * myDir < 0.28) dx = myDir * 0.28;
      const n = len(dx, dy) || 1;
      dx /= n;
      dy /= n;
    } else {
      dx = myDir;
      dy = 0;
    }

    const reach = forceClearance
      ? MAX_LONG_KICK_RANGE
      : clamp(50 + Math.max(0, inp.moveX * myDir) * 13, 44, MAX_LONG_KICK_RANGE);
    const angle = Math.atan2(dy, dx);
    const minForward = forceClearance ? 36 : 32;
    let best: SimPlayer | null = null;
    let bestScore = -Infinity;
    for (const q of this.state.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      const forward = (q.pos.x - owner.pos.x) * myDir;
      if (forward < minForward || forward > MAX_LONG_KICK_RANGE + 4) continue;
      const d = dist(owner.pos, q.pos);
      const a = Math.atan2(q.pos.y - owner.pos.y, q.pos.x - owner.pos.x);
      const off = Math.abs(angleDiff(a, angle));
      if (off > Math.PI / (forceClearance ? 1.65 : 2.05)) continue;
      const space = this.nearestOpponentDist(q);
      const score = forward * 0.11
        - off * 7
        + clamp(space, 0, 12) * 0.16
        + (q.attrs.pos === 'FW' ? 2.2 : q.attrs.pos === 'MF' ? 0.8 : 0)
        + Math.max(0, q.vel.x * myDir) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }

    const loft = forceClearance ? 0.64 : 0.58;
    if (best) {
      const aim = this.passAimForReceiver(owner, best, true);
      const d = Math.min(dist(owner.pos, aim), MAX_LONG_KICK_RANGE);
      return {
        aim,
        targetIdx: best.idx,
        speed: Math.max(forceClearance ? 30 : 28, this.speedForReach(d, loft)),
        loft,
      };
    }

    const aim = {
      x: clamp(owner.pos.x + dx * reach, -HALF_LEN + 3, HALF_LEN - 3),
      y: clamp(owner.pos.y + dy * reach, -HALF_WID + 4, HALF_WID - 4),
    };
    const d = Math.min(dist(owner.pos, aim), MAX_LONG_KICK_RANGE);
    return {
      aim,
      targetIdx: -1,
      speed: Math.max(forceClearance ? 31 : 29, this.speedForStop(d, loft)),
      loft,
    };
  }

  private kickGoalkeeperLong(owner: SimPlayer, inp: PadInput, forceClearance: boolean, checkOffside = true): { targetIdx: number } {
    const launch = this.goalkeeperLongTarget(owner, inp, forceClearance);
    this.kickBall(owner, launch.aim, launch.speed, launch.loft, launch.targetIdx, checkOffside);
    owner.anim = 'kick';
    owner.actionTimer = 0.5;
    this.emitPass(owner, launch.targetIdx, forceClearance ? 1 : 0.9);
    this.emit({ type: 'kick', team: owner.team, power: forceClearance ? 1 : 0.9 });
    return { targetIdx: launch.targetIdx };
  }

  /**
   * Release the ball from the keeper: 'short' is a throw/roll to a free
   * defender (same receiver-assist mechanics as a ground pass), 'long' a punt
   * upfield (same as a lofted long ball).
   */
  /** Human keeper clears it from his hands: a big punt downfield, steered left/
   * right (and a little fore/aft) by the stick, that comfortably clears halfway. */
  private gkBigKick(owner: SimPlayer, inp: PadInput) {
    this.kickGoalkeeperLong(owner, inp, true);
  }

  private gkDistribute(owner: SimPlayer, mode: 'short' | 'long') {
    const st = this.state;
    const myDir = this.attackSign(owner.team);
    const wasHeld = st.ball.held === true;
    if (mode === 'short') {
      const short = this.gkShortOption(owner);
      if (short) {
        // roll/throw it out like a real short pass: pace scales with the distance
        // to the receiver (a 6m roll is gentle, a 24m ball is firmer) with a
        // slight loft out of the hands rather than a dead, fixed-speed tap
        const recv = st.players[short.targetIdx];
        const d = recv ? dist(owner.pos, recv.pos) : 12;
        const speed = clamp(12 + d * 0.6, 13, 23);
        this.kickBall(owner, short.aim, speed, wasHeld ? 0.1 : 0.05, short.targetIdx);
        if (wasHeld) {
          owner.anim = 'gkthrow';
          owner.actionTimer = 0.5;
        }
        this.emitPass(owner, short.targetIdx, 0.4);
        this.emit({ type: 'kick', team: owner.team, power: 0.4 });
        return;
      }
    }
    this.kickGoalkeeperLong(owner, { ...NULL_INPUT, moveX: myDir }, false);
  }

  private isWideCrossingLane(p: SimPlayer): boolean {
    const dir = this.attackSign(p.team);
    const progress = p.pos.x * dir;
    const wideEnough = Math.abs(p.pos.y) > PENALTY_BOX_HALF_WIDTH - 2;
    const roleCanCross = p.attrs.pos === 'FW' || p.attrs.pos === 'MF' || Math.abs(p.slot.y) > 0.45;
    return !p.isGK && roleCanCross && progress > HALF_LEN - 36 && progress < HALF_LEN - 5 && wideEnough;
  }

  private aiCrossOption(owner: SimPlayer): { target: SimPlayer; aim: Vec2; speed: number; loft: number } | null {
    if (!this.isWideCrossingLane(owner)) return null;
    const target = this.crossTargetInBox(owner);
    if (!target || this.isOffsideTarget(owner, target)) return null;
    const aim = this.passAimForReceiver(owner, target, true);
    const d = dist(owner.pos, aim);
    const skill = clamp(owner.attrs.pass / 100, 0, 1);
    const pressure = this.nearestOpponentDist(owner);
    const hurry = pressure < 7 ? 1.0 : 0;
    // a clipped, DIPPING cross: low enough loft that it drops onto the runner,
    // with the pace solved from the physics so it lands AT him rather than
    // sailing 6-7m over his head (the old hot moon-ball never connected). The
    // aerial aim cone in applyPassSkillToAim already gives it a touch less
    // accuracy than a threaded pass, which is right for a ball into an area.
    const loft = clamp(0.5 + d * 0.006, 0.48, 0.64);
    const speed = clamp(this.speedForReach(d, loft) + hurry, 13, 25);
    return { target, aim, speed, loft };
  }

  private centralChanceOption(owner: SimPlayer): { target: SimPlayer; aim: Vec2; speed: number; loft: number; power: number; through?: boolean } | null {
    const cutback = this.centralCutbackOption(owner);
    if (cutback) return cutback;
    return this.centralSlipOption(owner);
  }

  private centralCutbackOption(owner: SimPlayer): { target: SimPlayer; aim: Vec2; speed: number; loft: number; power: number } | null {
    const target = this.centralCutbackTarget(owner);
    if (!target) return null;
    const d = dist(owner.pos, target.pos);
    const skill = clamp(owner.attrs.pass / 100, 0, 1);
    return {
      target,
      aim: this.passAimForReceiver(owner, target, false),
      speed: clamp(15.5 + d * 0.56 + skill * 2.2, 18, 24),
      loft: 0.035,
      power: 0.54,
    };
  }

  private centralCutbackTarget(owner: SimPlayer): SimPlayer | null {
    const dir = this.attackSign(owner.team);
    const ownerProgress = owner.pos.x * dir;
    if (ownerProgress < HALF_LEN - 15) return null;
    if (Math.abs(owner.pos.y) > PENALTY_BOX_HALF_WIDTH - 3 || Math.abs(owner.pos.y) < 3.5) return null;
    let best: SimPlayer | null = null;
    let bestScore = -Infinity;
    for (const q of this.state.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      const qProgress = q.pos.x * dir;
      const cutbackDepth = ownerProgress - qProgress;
      if (cutbackDepth < 2 || cutbackDepth > 20) continue;
      if (qProgress < HALF_LEN - 24 || qProgress > HALF_LEN - 8) continue;
      if (Math.abs(q.pos.y) > 14) continue;
      let lane = Infinity;
      for (const o of this.state.players) {
        if (o.team === owner.team || o.sentOff) continue;
        lane = Math.min(lane, pointSegDist(o.pos, owner.pos, q.pos));
      }
      if (lane < 0.9) continue;
      const centralBonus = 1.2 - clamp(Math.abs(q.pos.y) / 14, 0, 1);
      const roleBonus = q.attrs.pos === 'MF' ? 1.1 : q.attrs.pos === 'FW' ? 0.7 : 0;
      const arriving = q.vel.x * dir > 0.8 ? 0.55 : 0;
      const score = clamp(lane / 3, 0, 1.5)
        + centralBonus
        + roleBonus
        + arriving
        + q.attrs.shoot * 0.018
        - Math.abs(cutbackDepth - 8) * 0.04;
      if (score > bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  private centralSlipOption(owner: SimPlayer): { target: SimPlayer; aim: Vec2; speed: number; loft: number; power: number; through: boolean } | null {
    const dir = this.attackSign(owner.team);
    const ownerProgress = owner.pos.x * dir;
    if (ownerProgress < -8 || ownerProgress > HALF_LEN - 18) return null;
    if (Math.abs(owner.pos.y) > PENALTY_BOX_HALF_WIDTH - 4) return null;
    const lineProgress = this.oppositionDefLineX(owner.team) * dir;
    const room = (HALF_LEN - 8) - lineProgress;
    if (room < 4.2) return null;
    const skill = clamp(owner.attrs.pass / 100, 0, 1);
    let best: { target: SimPlayer; aim: Vec2; score: number } | null = null;
    for (const q of this.state.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      if (this.isOffsideTarget(owner, q)) continue;
      if (q.attrs.pos !== 'FW' && q.attrs.pos !== 'MF') continue;
      if (q.attrs.pace < 58) continue;
      const qProgress = q.pos.x * dir;
      const forward = qProgress - ownerProgress;
      if (forward < 8 || forward > 42) continue;
      if (qProgress < lineProgress - 7 || qProgress > lineProgress + 1.4) continue;
      const aimProgress = clamp(
        lineProgress + Math.min(11.5, room * 0.78) + Math.max(0, q.vel.x * dir) * 0.3,
        qProgress + 5.5,
        HALF_LEN - 7.5,
      );
      const aim = {
        x: dir * aimProgress,
        y: clamp(q.pos.y + q.vel.y * 0.35, -HALF_WID + 6, HALF_WID - 6),
      };
      let lane = Infinity;
      let race = Infinity;
      const runnerDist = dist(q.pos, aim);
      for (const o of this.state.players) {
        if (o.team === owner.team || o.sentOff || o.isGK) continue;
        lane = Math.min(lane, pointSegDist(o.pos, owner.pos, aim));
        race = Math.min(race, dist(o.pos, aim) - runnerDist * (82 / Math.max(42, q.attrs.pace)));
      }
      if (lane < 0.8 || race < -4.2) continue;
      const score = skill * 1.25
        + q.attrs.pace * 0.018
        + clamp(room / 12, 0, 1.2)
        + clamp(forward / 30, 0, 1.1)
        + (q.attrs.pos === 'FW' ? 0.55 : 0)
        + (q.vel.x * dir > 1.2 ? 0.55 : 0)
        + clamp(race / 8, -0.3, 0.8);
      if (!best || score > best.score) best = { target: q, aim, score };
    }
    if (!best) return null;
    const d = dist(owner.pos, best.aim);
    return {
      target: best.target,
      aim: best.aim,
      speed: clamp(18.5 + d * 0.34 + skill * 2.8, 21, 29),
      loft: 0.04,
      power: 0.62,
      through: true,
    };
  }

  private applyShotSkillToAimY(shooter: SimPlayer, intendedY: number, distanceToGoal: number, pressure = 99): number {
    const shootAttr = this.effectiveAttr(shooter, 'shoot');
    const passAttr = this.effectiveAttr(shooter, 'pass');
    const skill = clamp(shootAttr / 100, 0, 1);
    const sign = this.rng.next() < 0.5 ? -1 : 1;
    const noise = 0.5 + this.rng.next() * 0.5;
    // A clinical, composed finisher slots it even under a challenge; a low-tier
    // player panics when a defender is tight and sprays it. Tired legs widen it too.
    const composure = clamp((shootAttr * 0.4 + passAttr * 0.4 + shooter.stamina * 20) / 100, 0.2, 1);
    const pressMult = pressure < 2.0 ? 1 + (1 - composure) * 1.1 : pressure < 3.8 ? 1 + (1 - composure) * 0.55 : 1;
    const stamMult = 1 + (1 - shooter.stamina) * 0.35;
    // long range adds error even for elite finishers (the pow(1-skill) term alone
    // keeps them near-pinpoint at 30m, which made screamers far too repeatable)
    const longRangeError = Math.max(0, distanceToGoal - 21) * 0.009;
    const spread = (Math.pow(1 - skill, 1.18) * (0.42 + distanceToGoal * 0.026) + (1 - skill) * 0.07 + longRangeError) * pressMult * stamMult;
    return clamp(intendedY + sign * spread * noise, -GOAL_HALF_WIDTH * 1.25, GOAL_HALF_WIDTH * 1.25);
  }

  /** open grass straight ahead toward goal — nobody within reach of the channel */
  private hasForwardSpace(p: SimPlayer): boolean {
    const dir = this.attackSign(p.team);
    if (p.pos.x * dir > HALF_LEN - 16) return false; // at the box: pick a proper option
    const probe = { x: p.pos.x + dir * 7.5, y: p.pos.y };
    for (const q of this.state.players) {
      if (q.team === p.team || q.sentOff || q.isGK) continue;
      if ((q.pos.x - p.pos.x) * dir > -1 && pointSegDist(q.pos, p.pos, probe) < 2.6) return false;
    }
    return true;
  }

  private nearestOpponentDist(p: SimPlayer): number {
    let nd = Infinity;
    for (const q of this.state.players) {
      if (q.team === p.team) continue;
      nd = Math.min(nd, dist(q.pos, p.pos));
    }
    return nd;
  }

  private isClearScoringChance(owner: SimPlayer, goal: Vec2): boolean {
    const dir = this.attackSign(owner.team);
    const dGoal = dist(owner.pos, goal);
    if (dGoal > 34 || owner.pos.x * dir < HALF_LEN - 36 || Math.abs(owner.pos.y) > 17) return false;
    for (const q of this.state.players) {
      if (q.team === owner.team || q.isGK || q.sentOff) continue;
      const ahead = (q.pos.x - owner.pos.x) * dir;
      if (ahead <= 0 || ahead > dGoal) continue;
      if (pointSegDist(q.pos, owner.pos, goal) < 3.1) return false;
    }
    return true;
  }

  private bestPassOption(owner: SimPlayer, longOnly: boolean, allowThrough = false): { aim: Vec2; score: number; targetIdx: number; through?: boolean } | null {
    const st = this.state;
    const myDir = this.attackSign(owner.team);
    const mentality = this.teamMentality(owner.team);
    const minute = this.matchMinute();
    const goalDiff = st.score[owner.team] - st.score[1 - owner.team];
    const ownProgress = owner.pos.x * myDir;
    const inOwnThird = ownProgress < -HALF_LEN / 3;
    const chasing = goalDiff < 0 && minute >= 70; // behind late: take more risks
    const protecting = goalDiff > 0 && minute >= 75; // ahead late: keep it safe
    const wastingTime = this.shouldWasteTime(owner.team); // actively waste time
    // Check for clear chance - don't waste time if there's one
    const goal = { x: myDir * HALF_LEN, y: 0 };
    const clearChance = this.isClearScoringChance(owner, goal);
    const transition = this.inTransition(owner.team);
    const ownerProfile = this.playerDecisionProfile(owner);
    const tactic = this.teamTacticProfile(owner.team);
    const throughBias = clamp(0.7 + this.teamQuality(owner.team) * 0.4, 0.4, 1.15) * clamp(mentality.risk + (ownerProfile.passUrgency - 0.5) * 0.18, 0.72, 1.34);
    const oppLineProg = this.oppositionDefLineX(owner.team) * myDir;
    const pressure = this.nearestOpponentDist(owner);
    // better passers see and trust harder balls: tighter lanes qualify and
    // forward progress weighs more in their choice
    const skill = clamp(owner.attrs.pass / 100, 0, 1);
    const laneNeeded = 1.75 - skill * 0.45 - (ownerProfile.passUrgency - 0.5) * 0.22;
    const receivedFrom = this.recentReceivedFrom.get(owner.idx);
    let best: { aim: Vec2; score: number; targetIdx: number; through?: boolean } | null = null;

    for (const q of st.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      const d = dist(owner.pos, q.pos);
      if (this.isOffsideTarget(owner, q)) continue;
      const forward = (q.pos.x - owner.pos.x) * myDir;
      const role = this.playerRole(q);
      const lateralGap = Math.abs(q.pos.y - owner.pos.y);
      const switchPass = tactic.switchPlay > 0.62
        && lateralGap > HALF_WID * 0.9
        && Math.sign(q.pos.y || q.slot.y || 1) !== Math.sign(owner.pos.y || 1);
      const maxPassRange = longOnly ? 55 : switchPass ? 58 : 38;

      if (d >= 4 && d <= maxPassRange) {
        // straight pass to feet
        let lane = Infinity;
        for (const o of st.players) {
          if (o.team === owner.team || o.sentOff) continue;
          lane = Math.min(lane, pointSegDist(o.pos, owner.pos, q.pos));
        }
        // Strong forward bonus: 0.35 per meter forward (was 0.045-0.07)
        const forwardBonus = forward > 0
          ? forward * 0.35 * clamp(mentality.risk, 0.76, 1.3)
          : forward * 0.08;
        // Bonus for teammates running into space (positive velocity in attack direction)
        const runningIntoSpace = (q.vel.x * myDir) > 1.5 ? 0.6 : (q.vel.x * myDir) > 0.5 ? 0.3 : 0;
        let score = clamp(lane / 3, 0, 1.6)
          + forwardBonus
          + runningIntoSpace
          + (q.attrs.pos === 'FW' ? 0.35 : 0);
        score += (ownerProfile.passUrgency - 0.5) * 0.42;
        // formations built to overload the middle (a diamond, a narrow 4-3-1-2)
        // funnel the ball through central receivers; wide formations don't
        const overload = Math.max(0, tactic.centralOverload - 0.6);
        if (overload > 0 && Math.abs(q.pos.y) < 14) score += overload * (0.45 + clamp(forward, 0, 12) * 0.012);
        if (ownerProfile.carryBias > ownerProfile.passUrgency + 0.16 && pressure > 5.5 && forward < 5) score -= 0.38;
        if (role === 'playmaker' && pressure < 5.2) score += 0.32;
        if (role === 'holdingMidfielder' && pressure > 4.8 && forward < 2) score -= 0.32;
        if (role === 'overlapFullBack' && forward > 2 && Math.abs(q.pos.y) > HALF_WID - 12) score += 0.42;
        if (switchPass) {
          const nearCrowd = this.teammateCrowd(owner.team, owner.pos, [owner.idx, q.idx], 10)
            + this.opponentCrowd(owner.team, owner.pos, 12);
          const farCrowd = this.teammateCrowd(owner.team, q.pos, [owner.idx, q.idx], 8)
            + this.opponentCrowd(owner.team, q.pos, 10);
          score += tactic.switchPlay * 1.25 + clamp(nearCrowd - farCrowd, 0, 5) * 0.34;
          if (role === 'wideForward' || role === 'wideMidfielder' || role === 'overlapFullBack') score += 0.38;
        }
        if (inOwnThird && lane < 2.4) score -= 0.55; // no risky balls near our own goal
        // no sterile give-and-go straight back to the man who just played it,
        // unless the return genuinely breaks ground
        if (receivedFrom && receivedFrom.from === q.idx
          && st.tick - receivedFrom.tick < Math.round(4 / DT)
          && forward < 2) {
          score -= 0.55;
        }
        if (wastingTime && forward < 0 && !clearChance) {
          // Strongly prefer backward passes when wasting time (but not on clear chances)
          const backwardMeters = Math.abs(forward);
          score += 0.8 * backwardMeters; // Big bonus for going backward
        } else if (protecting && forward < 0) {
          score += 0.3; // see the game out
        } else if (forward < -1.5) {
          // Strong backward penalty: scaled by distance (0.5 per meter back)
          const backwardMeters = Math.abs(forward);
          score -= 0.5 * backwardMeters;
          if (pressure > 6) score -= 0.5; // unpressed: going backwards is a cop-out
        }
        // Extra penalty for very short backward/sideways passes (ping-pong passing)
        // But allow it when wasting time to run clock down
        if (forward < 2 && d < 8 && !protecting && !wastingTime) {
          score -= 0.4;
        }
        if (!longOnly && d < 12 && forward < 3.5 && !protecting && !wastingTime) {
          const ownerCluster = this.teammateCrowd(owner.team, owner.pos, [owner.idx, q.idx], 8);
          const receiverCluster = this.teammateCrowd(owner.team, q.pos, [owner.idx, q.idx], 7);
          if (ownerCluster >= 2 || receiverCluster >= 2) {
            score -= 2.4 + Math.max(0, 3.5 - forward) * 0.12;
          }
        }
        if (forward < 1.5) {
          // unpressed players shouldn't just pass sideways or backwards; they should look to carry it forward
          if (pressure > 4.5) score -= 0.6;
        }
        if (ownProgress > HALF_LEN - 30 && forward < -2 && !protecting) score -= 0.85; // never turn back in sight of goal
        if (transition) score += clamp(forward, 0, 14) * (0.02 + Math.max(0, mentality.tempo - 1) * 0.05); // break at pace
        const requiredLane = switchPass ? Math.max(0.9, laneNeeded - 0.42) : laneNeeded;
        if (lane > requiredLane && (!best || score > best.score)) {
          best = { aim: this.passAimForReceiver(owner, q, longOnly), score, targetIdx: q.idx };
        }
      }

      // through ball: play into space behind the back line for a runner to chase
      if (allowThrough && !longOnly && !protecting && (q.attrs.pos === 'FW' || q.attrs.pos === 'MF') && q.attrs.pace >= 55) {
        const qProg = q.pos.x * myDir;
        const room = (HALF_LEN - 13) - oppLineProg;
        const nearLine = qProg > oppLineProg - 13 && qProg > ownProgress - 4;
        if (room > 4 && nearLine) {
          const aim = {
            x: myDir * clamp(oppLineProg + Math.min(8, room * 0.6), 4, HALF_LEN - 9),
            y: clamp(q.pos.y * 0.82, -HALF_WID + 6, HALF_WID - 6),
          };
          const dAim = dist(owner.pos, aim);
          if (dAim >= 8 && dAim <= 42) {
            let lane = Infinity;
            let race = Infinity;
            const qToAim = dist(q.pos, aim);
            for (const o of st.players) {
              if (o.team === owner.team || o.sentOff || o.isGK) continue;
              lane = Math.min(lane, pointSegDist(o.pos, owner.pos, aim));
              race = Math.min(race, dist(o.pos, aim) - qToAim * (78 / Math.max(40, q.attrs.pace)));
            }
            if (lane > 1.3 && race > -1.5) {
              const score = (1.05 + room * 0.03 + (q.attrs.pace - 60) * 0.008 + (transition ? 0.45 : 0)) * throughBias
                + (chasing ? 0.25 : 0)
                - (inOwnThird ? 0.5 : 0);
              if (!best || score > best.score) {
                best = { aim, score, targetIdx: q.idx, through: true };
              }
            }
          }
        }
      }
    }
    return best;
  }

  private teammateCrowd(team: 0 | 1, point: Vec2, excluded: number[], radius: number): number {
    let count = 0;
    for (const p of this.state.players) {
      if (p.team !== team || p.isGK || p.sentOff || excluded.includes(p.idx)) continue;
      if (dist(p.pos, point) < radius) count++;
    }
    return count;
  }

  private opponentCrowd(team: 0 | 1, point: Vec2, radius: number): number {
    let count = 0;
    for (const p of this.state.players) {
      if (p.team === team || p.isGK || p.sentOff) continue;
      if (dist(p.pos, point) < radius) count++;
    }
    return count;
  }

  private shortPassOption(owner: SimPlayer): { aim: Vec2; score: number; targetIdx: number } | null {
    const myDir = this.attackSign(owner.team);
    const faceX = Math.cos(owner.facing);
    const faceY = Math.sin(owner.facing);
    let best: { aim: Vec2; score: number; targetIdx: number } | null = null;
    for (const q of this.state.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      if (this.isOffsideTarget(owner, q)) continue;
      const d = dist(owner.pos, q.pos);
      if (d < 3.2 || d > 23) continue;
      let lane = Infinity;
      for (const o of this.state.players) {
        if (o.team === owner.team || o.sentOff) continue;
        lane = Math.min(lane, pointSegDist(o.pos, owner.pos, q.pos));
      }
      if (lane < 1.15) continue;
      const dx = (q.pos.x - owner.pos.x) / (d || 1);
      const dy = (q.pos.y - owner.pos.y) / (d || 1);
      const alignment = dx * faceX + dy * faceY;
      const forward = (q.pos.x - owner.pos.x) * myDir;
      const score = clamp(lane / 2.5, 0, 1.4)
        - Math.abs(d - 9) * 0.11
        + clamp(forward, -4, 10) * 0.025
        + alignment * 0.18
        + (q.attrs.pos === 'MF' ? 0.18 : 0);
      if (!best || score > best.score) {
        best = { aim: this.passAimForReceiver(owner, q, false), score, targetIdx: q.idx };
      }
    }
    return best;
  }

  /** Find the best forward pass option specifically (for aggressive attacking) */
  private bestForwardPassOption(owner: SimPlayer): { aim: Vec2; score: number; targetIdx: number; through?: boolean } | null {
    const st = this.state;
    const myDir = this.attackSign(owner.team);
    let best: { aim: Vec2; score: number; targetIdx: number; through?: boolean } | null = null;

    for (const q of st.players) {
      if (q.team !== owner.team || q === owner || q.isGK || q.sentOff || q.injuredOff) continue;
      if (this.isOffsideTarget(owner, q)) continue;
      const d = dist(owner.pos, q.pos);
      if (d < 4 || d > 38) continue;

      const forward = (q.pos.x - owner.pos.x) * myDir;
      // Only consider forward options
      if (forward < 2) continue;

      let lane = Infinity;
      for (const o of st.players) {
        if (o.team === owner.team || o.sentOff) continue;
        lane = Math.min(lane, pointSegDist(o.pos, owner.pos, q.pos));
      }

      // Score prioritizes forwardness and runners
      const runningIntoSpace = (q.vel.x * myDir) > 1.0 ? 0.8 : (q.vel.x * myDir) > 0.3 ? 0.4 : 0;
      const forwardBonus = forward * 0.4;
      let score = clamp(lane / 3, 0, 1.2) + forwardBonus + runningIntoSpace + (q.attrs.pos === 'FW' ? 0.4 : 0);

      // Anti-circulation
      const receivedFrom = this.recentReceivedFrom.get(owner.idx);
      if (receivedFrom && receivedFrom.from === q.idx
        && st.tick - receivedFrom.tick < Math.round(4 / DT)) {
        score -= 0.5;
      }

      const minLane = d > 24 ? 0.7 : 1.4;
      if (lane > minLane && (!best || score > best.score)) {
        best = { aim: this.passAimForReceiver(owner, q, false), score, targetIdx: q.idx };
      }
    }
    return best;
  }

  /** Check if player is facing forward (toward opponent goal) */
  private isFacingForward(p: SimPlayer): boolean {
    const myDir = this.attackSign(p.team);
    return Math.cos(p.facing) * myDir > 0.3;
  }

  private passAimForReceiver(kicker: SimPlayer, receiver: SimPlayer, aerial: boolean): Vec2 {
    const d = dist(kicker.pos, receiver.pos);
    const leadSeconds = aerial
      ? clamp(d / 25, 0, 1.05)
      : clamp(d / 30, 0, 0.36);
    return {
      x: receiver.pos.x + receiver.vel.x * leadSeconds,
      y: receiver.pos.y + receiver.vel.y * leadSeconds,
    };
  }

  private applyPassSkillToAim(kicker: SimPlayer, aim: Vec2, aerial: boolean): Vec2 {
    const d = dist(kicker.pos, aim);
    if (d < 2) return aim;
    const skill = clamp(this.effectiveAttr(kicker, 'pass') / 100, 0, 1);
    const sign = this.rng.next() < 0.5 ? -1 : 1;
    const noise = 0.55 + this.rng.next() * 0.45;
    // elite passers thread it (cone ~1°); poor/tired passers under-hit, over-hit
    // and drift behind the runner (cone widens toward ~6-8°), forcing turnovers
    const stam = 1 + (1 - kicker.stamina) * 0.5;
    const maxAngle = ((aerial ? 0.26 : 0.18) * Math.pow(1 - skill, 1.45) + (1 - skill) * 0.012) * stam * this.wfx.passErr;
    const angleErr = sign * maxAngle * noise;
    const rangeErr = (this.rng.next() - 0.5) * 2 * (aerial ? 0.11 : 0.05) * (1 - skill) * stam * d;
    const baseAngle = Math.atan2(aim.y - kicker.pos.y, aim.x - kicker.pos.x);
    const range = Math.max(2, d + rangeErr);
    return {
      x: kicker.pos.x + Math.cos(baseAngle + angleErr) * range,
      y: kicker.pos.y + Math.sin(baseAngle + angleErr) * range,
    };
  }

  // ---------------------------------------------------------------- ball

  private dribbleTouch(p: SimPlayer, toward: Vec2) {
    const st = this.state;
    if (p.kickCooldown > 0) return;
    const d = dist(p.pos, st.ball.pos);
    if (d > CONTROL_RADIUS * 1.2) return;
    const dx = toward.x - p.pos.x, dy = toward.y - p.pos.y;
    const a = Math.atan2(dy, dx);
    const sp = len(p.vel.x, p.vel.y);
    const push = clamp(sp * 1.22 + 1.6, 2.6, 11.8);
    st.ball.vel.x = Math.cos(a) * push;
    st.ball.vel.y = Math.sin(a) * push;
    st.ball.spin *= 0.5;
    st.ball.kickDir = { x: Math.cos(a), y: Math.sin(a) };
    st.ball.lastTouchTeam = p.team;
    st.ball.lastKicker = p.idx;
    p.kickCooldown = TOUCH_COOLDOWN;
  }

  private kickBall(p: SimPlayer, aim: Vec2, speed: number, loft: number, passTargetIdx = -1, checkOffside = true) {
    const st = this.state;
    const finalAim = passTargetIdx >= 0 ? this.applyPassSkillToAim(p, aim, loft > 0.2) : aim;
    const dx = finalAim.x - p.pos.x, dy = finalAim.y - p.pos.y;
    const a = Math.atan2(dy, dx);
    st.ball.vel.x = Math.cos(a) * speed;
    st.ball.vel.y = Math.sin(a) * speed;
    st.ball.vz = speed * loft * 0.45;
    st.ball.spin = 0;
    st.ball.kickDir = { x: Math.cos(a), y: Math.sin(a) };
    st.ball.ownerIdx = -1;
    st.ball.held = false;
    st.ball.lastTouchTeam = p.team;
    st.ball.lastKicker = p.idx;
    this.longAerialSkidUntil = this.isLongAerialKick(speed, loft)
      ? st.tick + Math.round(LONG_AERIAL_SKID_SECONDS / DT)
      : -1;
    p.kickCooldown = 0.45;
    p.facing = a;
    // a struck ball reads as a kick unless the caller poses something more
    // specific (header, throw) straight after
    if (st.phase === 'play' && !p.isGK && (speed >= 17 || loft >= 0.3) && p.slideTimer <= 0) {
      p.anim = 'kick';
      p.actionTimer = 0.45;
    }
    this.pendingOffside = null;
    if (passTargetIdx >= 0) {
      this.recentReceivedFrom.set(passTargetIdx, { from: p.idx, tick: st.tick });
      this.livePassTargetIdx = passTargetIdx;
      // a high, lofted ball (cross / long punt) needs the whole flight to land,
      // so the lock window scales with the loft instead of a flat 3.2s
      this.livePassTargetUntil = st.tick + Math.round((loft > 0.55 ? 4.2 : loft > 0.2 ? 3.2 : 3.0) / DT);
      // let the receiver still take a driven long ball that hasn't fully bled its
      // pace — short passes keep the tight 28.5 default so they're not magnetised
      this.livePassMaxReceiveSpeed = clamp(speed * 0.9, 28.5, 40);
      this.livePassLofted = loft > 0.2;
      this.humans[p.team].passTargetIdx = passTargetIdx;
    } else {
      this.livePassTargetIdx = -1;
      this.livePassTargetUntil = -1;
      this.livePassMaxReceiveSpeed = 28.5;
      this.livePassLofted = false;
      this.humans[p.team].passTargetIdx = -1;
    }
    // Offside is judged on whoever first becomes involved, not just an intended
    // receiver — so a forward ball played up to a striker beyond the last defender
    // is flagged even when it's an untargeted clearance or keeper punt. Only
    // forward deliveries in open play can spring an offside; a high ball gets a
    // longer window because the flight takes longer to come down.
    if (checkOffside && st.phase === 'play' && st.ball.kickDir.x * this.attackSign(p.team) > 0.1) {
      const offsideWindow = st.tick + Math.round((loft > 0.55 ? 5.0 : loft > 0.2 ? 4.0 : 3.2) / DT);
      this.armPendingOffside(p, offsideWindow);
    }
  }

  /**
   * Forward-integrate a struck ball (same physics as integrateBall) to find how
   * far it travels — used to PICK a launch speed for long restarts and crosses so
   * the ball actually lands where it's aimed instead of sailing the length of the
   * pitch. Pure + deterministic (no rng), runs only at the moment of a kick.
   *  - carry: distance to the first bounce
   *  - stop:  total distance travelled (carry + roll), where the ball dies
   *  - reach: distance at which a lofted ball first drops into a controllable
   *           window (low + descending + slow), i.e. where a runner can take it
   */
  private simulateKick(speed: number, loft: number): { carry: number; stop: number; reach: number } {
    let s = speed;
    let z = 0;
    let vz = speed * loft * 0.45;
    let dist = 0;
    let carry = 0;
    let reach = 0;
    let landed = false;
    const fr = this.wfx.ballFriction;
    const longAerialSkid = this.isLongAerialKick(speed, loft);
    for (let i = 0; i < 600; i++) {
      if (z > 0.02) {
        vz += GRAVITY * DT;
        s *= 1 - BALL_AIR_DRAG * DT;
      } else if (s > 0) {
        const friction = BALL_GROUND_FRICTION * fr * (longAerialSkid ? LONG_AERIAL_FRICTION_MULT : 1);
        const rollingDrag = longAerialSkid ? LONG_AERIAL_GROUND_DRAG : 0.4;
        s = Math.max(0, s - (friction + s * rollingDrag) * DT);
      }
      dist += s * DT;
      z += vz * DT;
      if (z < 0) {
        z = 0;
        if (!landed) { landed = true; carry = dist; }
        if (longAerialSkid) s *= LONG_AERIAL_BOUNCE_DAMP;
        vz = -vz * this.bounceRestitution(longAerialSkid);
        if (Math.abs(vz) < 1.2) vz = 0;
      }
      if (!reach && i > 2 && vz <= 0.2 && z < 1.0 && s < 15) reach = dist;
      if (s < 0.25 && z <= 0.02) break;
    }
    if (!carry) carry = dist;
    if (!reach) reach = carry;
    return { carry, stop: dist, reach };
  }

  /** launch speed so a kick of this loft comes to rest ~`range` m away (long
   * restarts / goal kicks / clearances — keeps them off the opposition keeper). */
  private speedForStop(range: number, loft: number): number {
    let lo = 10, hi = 46;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (this.simulateKick(m, loft).stop < range) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /** launch speed so a lofted ball first drops to a controllable height ~`d` m
   * away — i.e. dips onto the cross/long-ball target instead of over his head. */
  private speedForReach(d: number, loft: number): number {
    let lo = 11, hi = loft >= LONG_AERIAL_MIN_LOFT ? 44 : 32;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (this.simulateKick(m, loft).reach < d) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /** Snapshot every team-mate in an offside position the instant `passer` plays
   * the ball forward. Covers any forward delivery — a threaded pass, a hopeful
   * hoof, a keeper's punt — not just a deliberately targeted receiver, so a
   * striker camped beyond the last defender is caught when the ball is launched
   * up to him. The first of these players to touch it is the one penalised. */
  private armPendingOffside(passer: SimPlayer, expires: number) {
    const offsideIdxs = this.state.players
      .filter((q) => q !== passer && this.isOffsideTarget(passer, q))
      .map((q) => q.idx);
    if (!offsideIdxs.length) return;
    this.pendingOffside = {
      defendingTeam: (1 - passer.team) as 0 | 1,
      passerIdx: passer.idx,
      offsideIdxs,
      expires,
    };
  }

  private maybeCallPendingOffside(toucher: SimPlayer): boolean {
    const pending = this.pendingOffside;
    if (!pending) return false;
    if (this.state.tick > pending.expires) {
      this.pendingOffside = null;
      return false;
    }
    // an opponent intercepting, or an onside team-mate getting there first, ends
    // the phase cleanly with no offside
    if (!pending.offsideIdxs.includes(toucher.idx)) {
      this.pendingOffside = null;
      return false;
    }
    const passer = this.state.players[pending.passerIdx];
    this.pendingOffside = null;
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    this.awardFreeKick(pending.defendingTeam, toucher.pos, 'offside', passer, toucher);
    return true;
  }

  private updateBallOwnership() {
    const st = this.state;
    const ball = st.ball;
    const livePenalty = this.isLivePenaltyShot();
    if (ball.z > 1.6) { ball.ownerIdx = -1; return; }
    const owner = this.owner();
    if (owner && !livePenalty && ball.z < 0.85 && this.tryStandingTackle(owner)) return;
    if (owner && dist(owner.pos, ball.pos) < CONTROL_RADIUS * 1.6) {
      // keep dribbling; ball loosely follows but physics still applies
    } else {
      ball.ownerIdx = -1;
    }
    if (ball.ownerIdx === -1) {
      const speed = len(ball.vel.x, ball.vel.y);
      if (this.tryReceiveLivePass()) return;
      let bestP: SimPlayer | null = null;
      let bestD = Infinity;
      const settleTicks = Math.round(0.22 / DT);
      const justSettled = st.tick - this.lastTurnover.tick < settleTicks;
      for (const p of st.players) {
        if (p.sentOff || p.injuredOff) continue;
        if (livePenalty && !p.isGK) continue;
        if (p.kickCooldown > 0.2 && p.idx === ball.lastKicker) continue;
        // the just-dispossessed side can't immediately re-collect the loose ball
        // (the keeper is always allowed to claim in his own box for safety)
        if (justSettled && p.team !== this.lastTurnover.team && !p.isGK) continue;
        const d = dist(p.pos, ball.pos);
        // good readers of the game cut out loose balls from further away — a
        // positioning/tackling bonus on the interception reach vs the other side
        const grab = CONTROL_RADIUS + (p.team !== ball.lastTouchTeam ? clamp(p.attrs.tackle - 60, 0, 38) * 0.013 : 0);
        if (d < grab && d < bestD) { bestD = d; bestP = p; }
      }
      const trapCap = bestP
        ? (bestP.isGK ? 16 + bestP.attrs.tackle * 0.06 : 9 + bestP.attrs.tackle * 0.05)
        : 0;
      if (bestP && speed < trapCap) {
        if (this.maybeCallPendingOffside(bestP)) return;
        const wasShot = this.shotLive;
        const fromOpponent = ball.lastTouchTeam !== bestP.team;
        if (!bestP.isGK && speed > 6.5) {
          const touch = this.firstTouchOutcome(bestP, speed, fromOpponent);
          if (touch.loose) {
            this.spillLooseFirstTouch(bestP, speed, touch);
            return;
          }
        }
        ball.ownerIdx = bestP.idx;
        this.autoFaceGoalIfSpace(bestP);
        this.shotLive = false;
        this.livePassTargetIdx = -1;
        this.livePassTargetUntil = -1;
        // trap: kill most velocity
        ball.vel.x = bestP.vel.x;
        ball.vel.y = bestP.vel.y;
        ball.vz = 0;
        ball.z = Math.min(ball.z, 0.1);
        ball.spin = 0;
        if (fromOpponent) this.lastTurnover = { tick: st.tick, team: bestP.team };
        ball.lastTouchTeam = bestP.team;
        if (bestP.isGK && (wasShot || fromOpponent)) {
          // a real catch (shot, cross or loose ball from the opposition):
          // face upfield and hold it in hand — the 92/93 backpass rule means a
          // ball played by his own team stays at his feet instead
          const up = this.attackSign(bestP.team);
          bestP.facing = up > 0 ? 0 : Math.PI;
          ball.pos.x = clamp(bestP.pos.x + up * 0.5, -HALF_LEN + 0.4, HALF_LEN - 0.4);
          ball.pos.y = bestP.pos.y;
          ball.vel.x = 0;
          ball.vel.y = 0;
          this.beginGkHold(bestP);
          if (wasShot) this.emit({ type: 'save', team: bestP.team });
        }
        // human pass-target assist fulfilled
        const h = this.humans[bestP.team];
        if (h.passTargetIdx === bestP.idx) h.passTargetIdx = -1;
      }
    }
    if (livePenalty) return;
    // slide tackles dispossess
    for (const p of st.players) {
      if (p.sentOff || p.isGK) continue;
      if (p.slideTimer <= 0) continue;
      if (dist(p.pos, ball.pos) < 1.25 && ball.z < 0.8) {
        const o = this.owner();
        if ((!o || o.team !== p.team) && !o?.isGK) {
          if (o) {
            // a foul depends on how cleanly he gets to the ball, not a coin flip:
            // a clean nick gets away with it, reaching through the man is whistled
            const fromBehind = this.isFromBehindTackle(p, o);
            const foulChance = this.tackleFoulChance(p, dist(p.pos, ball.pos), fromBehind);
            if (this.rng.next() < foulChance && !this.refereeWavesOn(o.team)) {
              this.commitFoul(p, o, fromBehind ? 0.72 : 0.28);
              continue;
            }
          }
          const a = p.facing;
          ball.ownerIdx = -1;
          ball.vel.x = Math.cos(a) * 9 + p.vel.x * 0.4;
          ball.vel.y = Math.sin(a) * 9 + p.vel.y * 0.4;
          if (ball.lastTouchTeam !== p.team) this.lastTurnover = { tick: this.state.tick, team: p.team };
          ball.lastTouchTeam = p.team;
          ball.lastKicker = p.idx;
          this.pendingOffside = null;
          // slid through and dispossessed — even a clean slide knocks the carrier off
          // his feet for a beat (a quick stumble; a from-behind one bundles him over harder)
          if (o) {
            const fb = this.isFromBehindTackle(p, o);
            this.knockDown(o, p, fb ? 1.25 : 1.05, fb ? 0.55 : 0.38);
          }
          this.emit({ type: 'tackle', team: p.team });
        }
      }
    }
  }

  private tryStandingTackle(owner: SimPlayer): boolean {
    if (owner.isGK || owner.sentOff) return false;
    const st = this.state;
    const ball = st.ball;
    // give a fresh winner a moment on the ball before the losing side can
    // challenge again — prevents the ball pinging back and forth every few ticks
    if (st.tick - this.lastTurnover.tick < Math.round(0.22 / DT) && owner.team === this.lastTurnover.team) return false;
    let best: { p: SimPlayer; score: number; d: number; fromBehind: boolean } | null = null;
    for (const p of st.players) {
      if (p.sentOff || p.team === owner.team || p.isGK || p.slideTimer > 0 || p.kickCooldown > 0.08
        || (p.downTimer && p.downTimer > 0)) continue;
      const speed = len(p.vel.x, p.vel.y);
      const d = Math.min(dist(p.pos, owner.pos), dist(p.pos, ball.pos));
      const tackleAttr = this.effectiveAttr(p, 'tackle');
      const reach = 0.5 + tackleAttr * 0.011 + clamp(speed, 0, 7) * 0.035;
      if (d > reach) continue;
      const toBallX = ball.pos.x - p.pos.x;
      const toBallY = ball.pos.y - p.pos.y;
      const toBallLen = len(toBallX, toBallY) || 1;
      const approach = speed > 0.2 ? (p.vel.x * toBallX + p.vel.y * toBallY) / (speed * toBallLen) : 0;
      if (approach < 0.08 && d > 0.52) continue;
      const fromBehind = this.isFromBehindTackle(p, owner);
      const duelEdge = this.duelScore(p, owner);
      const skill = clamp(tackleAttr / 100, 0, 1);
      const ownerSecurity = clamp(owner.attrs.pass / 180 + owner.attrs.pace / 260 + len(owner.vel.x, owner.vel.y) * 0.02, 0, 0.62);
      const score = skill * 1.02
        + clamp(speed / 8, 0, 0.34)
        + clamp((reach - d) * 0.9, 0, 0.32)
        + duelEdge * 0.3
        - ownerSecurity
        - (fromBehind ? 0.14 : 0);
      if (!best || score > best.score) best = { p, score, d, fromBehind };
    }
    if (!best || best.score < 0.68) return false;

    const tackler = best.p;
    const finalDuelEdge = this.duelScore(tackler, owner);
    if (best.fromBehind && best.score < 0.78 && this.rng.next() < this.tackleFoulChance(tackler, best.d, true)
      && !this.refereeWavesOn(owner.team)) {
      this.commitFoul(tackler, owner, 0.55);
      return true;
    }

    const cleanControl = (best.score > 0.96 || finalDuelEdge > 0.34) && best.d < 0.82;
    ball.ownerIdx = cleanControl ? tackler.idx : -1;
    if (cleanControl) {
      this.autoFaceGoalIfSpace(tackler);
    }
    const a = Math.atan2(ball.pos.y - tackler.pos.y, ball.pos.x - tackler.pos.x);
    const tackleAttr = this.effectiveAttr(tackler, 'tackle');
    if (cleanControl) {
      ball.vel.x = tackler.vel.x * 0.45;
      ball.vel.y = tackler.vel.y * 0.45;
    } else {
      // poked loose (no clean control): it runs on as a LOOSE ball — carried the way the
      // carrier was driving but knocked off his line by the challenge, so it escapes
      // rather than being shovelled straight back to his feet. It only comes back to him
      // if it physically rebounds off a body (the ball–player collision handles that).
      const carry = len(owner.vel.x, owner.vel.y);
      const fx = carry > 0.8 ? owner.vel.x / carry : Math.cos(owner.facing);
      const fy = carry > 0.8 ? owner.vel.y / carry : Math.sin(owner.facing);
      // veer off his running line, to the open side away from where the tackler came in
      const perpX = -fy;
      const perpY = fx;
      const sideSign = ((tackler.pos.x - owner.pos.x) * perpX + (tackler.pos.y - owner.pos.y) * perpY) >= 0 ? -1 : 1;
      let dx = fx + perpX * sideSign * 0.55;
      let dy = fy + perpY * sideSign * 0.55;
      const dl = len(dx, dy) || 1;
      const pokeSpeed = 5.8 + tackleAttr * 0.035;
      ball.vel.x = (dx / dl) * pokeSpeed + tackler.vel.x * 0.15;
      ball.vel.y = (dy / dl) * pokeSpeed + tackler.vel.y * 0.15;
    }
    ball.vz = 0;
    ball.z = 0;
    ball.spin = 0;
    if (ball.lastTouchTeam !== tackler.team) this.lastTurnover = { tick: this.state.tick, team: tackler.team };
    ball.lastTouchTeam = tackler.team;
    ball.lastKicker = tackler.idx;
    tackler.kickCooldown = cleanControl ? 0.12 : 0.26;
    owner.kickCooldown = Math.max(owner.kickCooldown, 0.42);
    tackler.facing = speedFacing(tackler) ?? a;
    tackler.anim = 'tackle';
    tackler.actionTimer = 0.5;
    this.pendingOffside = null;
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    this.emit({ type: 'tackle', team: tackler.team, player: tackler.idx, danger: this.isGoalSavingChallenge(tackler, owner) });
    return true;
  }

  /** A tackle/block deep in the defender's own third that dispossesses an attacker
   * driving at goal — the kind of last-ditch challenge a crowd applauds. */
  private isGoalSavingChallenge(tackler: SimPlayer, dispossessed: SimPlayer): boolean {
    const ownGoalDir = this.ownGoalDir(tackler.team);
    const ownGoalX = ownGoalDir * HALF_LEN;
    const nearOwnGoal = Math.abs(tackler.pos.x - ownGoalX) < 26 && Math.abs(tackler.pos.y) < 22;
    // the man dispossessed was bearing down on goal (driving toward it, or level/ahead)
    const wasThreat = dispossessed.vel.x * ownGoalDir > 1.2
      || (dispossessed.pos.x - tackler.pos.x) * ownGoalDir > -1.5;
    return nearOwnGoal && wasThreat;
  }

  private tryReceiveLivePass(): boolean {
    const st = this.state;
    const ball = st.ball;
    if (st.phase !== 'play' || ball.ownerIdx !== -1 || st.tick > this.livePassTargetUntil) return false;
    // a lofted cross / long ball is taken on the chest as it drops onto the
    // locked man; a ground pass still needs the ball at his feet
    const descending = ball.vz <= 0.5;
    const zCap = this.livePassLofted && descending ? HEADER_MIN_Z : 1.05;
    if (ball.z > zCap) return false;
    const target = st.players[this.livePassTargetIdx];
    if (!target || target.sentOff) return false;
    const speed = len(ball.vel.x, ball.vel.y);
    const targetD = dist(target.pos, ball.pos);
    const passedTarget = (ball.pos.x - target.pos.x) * ball.kickDir.x
      + (ball.pos.y - target.pos.y) * ball.kickDir.y > 0;
    const receiveRadius = passedTarget ? CONTROL_RADIUS * 1.35 : CONTROL_RADIUS * 1.24;
    if (targetD >= receiveRadius || speed >= this.livePassMaxReceiveSpeed) return false;

    if (this.maybeCallPendingOffside(target)) return true;

    const fromOpponent = ball.lastTouchTeam !== target.team;
    const touch = this.firstTouchOutcome(target, speed, fromOpponent);
    if (touch.loose) {
      this.spillLooseFirstTouch(target, speed, touch);
      const h = this.humans[target.team];
      if (h.passTargetIdx === target.idx) h.passTargetIdx = -1;
      return true;
    }

    ball.ownerIdx = target.idx;
    this.autoFaceGoalIfSpace(target);
    this.shotLive = false;
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    ball.vel.x = target.vel.x;
    ball.vel.y = target.vel.y;
    ball.vz = 0;
    ball.z = Math.min(ball.z, 0.1);
    ball.spin = 0;
    ball.lastTouchTeam = target.team;
    const h = this.humans[target.team];
    if (h.passTargetIdx === target.idx) h.passTargetIdx = -1;
    return true;
  }

  private integrateBall(inputs: [PadInput, PadInput]): BallFrameStart {
    const st = this.state;
    const ball = st.ball;
    const owner = this.owner();
    const prevBallPos = { ...ball.pos };
    const frameStart = { pos: prevBallPos, z: ball.z };

    // aftertouch curl from the kicker's stick
    for (let t = 0 as 0 | 1; t <= 1; t++) {
      const h = this.humans[t];
      if (st.tick < h.aftertouchUntil && ball.lastTouchTeam === t && ball.ownerIdx === -1) {
        const inp = inputs[t];
        const speed = len(ball.vel.x, ball.vel.y);
        if (speed > 6) {
          const kickLen = len(ball.kickDir.x, ball.kickDir.y);
          const dirX = kickLen > 0.1 ? ball.kickDir.x / kickLen : ball.vel.x / speed;
          const dirY = kickLen > 0.1 ? ball.kickDir.y / kickLen : ball.vel.y / speed;
          // lateral component of stick relative to ball direction -> spin
          const lat = inp.moveX * -dirY + inp.moveY * dirX;
          ball.spin += lat * 24 * DT;
        }
      }
    }

    if (owner && st.phase === 'play' && owner.isGK && ball.held) {
      // caught ball is carried in the keeper's HANDS: pinned to him, no dribble
      // physics. It rides at chest height when he's on his feet and lower while
      // he's still sprawled from a dive, rising smoothly as he gets up — so it's
      // never left sitting on the floor between his legs.
      const up = this.attackSign(owner.team);
      owner.facing = up > 0 ? 0 : Math.PI;
      ball.pos.x = clamp(owner.pos.x + up * 0.4, -HALF_LEN + 0.3, HALF_LEN - 0.3);
      ball.pos.y = clamp(owner.pos.y, -HALF_WID + 0.3, HALF_WID - 0.3);
      ball.vel.x = owner.vel.x;
      ball.vel.y = owner.vel.y;
      // hands cradle the ball at chest height standing (~1.3m on a ~1.9m keeper),
      // low and tucked when he's still sprawled from a dive.
      const handZ = owner.diving ? 0.6 : 1.3;
      ball.z += (handZ - ball.z) * 0.2;
      ball.vz = 0;
      ball.spin = 0;
    } else if (owner && st.phase === 'play') {
      // dribble: ball gently magnets ahead of owner's feet between touches.
      // GKs always shepherd it upfield, and the target stays inside the pitch
      // so possession can never drift over a line.
      const ownerSpeed = len(owner.vel.x, owner.vel.y);
      const fwd = owner.isGK
        ? (this.attackSign(owner.team) > 0 ? 0 : Math.PI)
        : ownerSpeed > 0.75 ? Math.atan2(owner.vel.y, owner.vel.x) : owner.facing;
      if (!owner.isGK && ownerSpeed > 0.75) owner.facing = fwd;
      const touchPulse = ownerSpeed > 0.7
        ? (Math.sin(st.tick * 0.42 + owner.idx) + 1) * 0.08
        : 0;
      const lead = clamp(0.42 + ownerSpeed * 0.018 + touchPulse, 0.42, 0.72);
      const ahead = {
        x: clamp(owner.pos.x + Math.cos(fwd) * lead, -HALF_LEN + 0.3, HALF_LEN - 0.3),
        y: clamp(owner.pos.y + Math.sin(fwd) * lead, -HALF_WID + 0.3, HALF_WID - 0.3),
      };
      const follow = clamp(0.18 + ownerSpeed * 0.008, 0.18, 0.26);
      ball.pos.x += (ahead.x - ball.pos.x) * follow;
      ball.pos.y += (ahead.y - ball.pos.y) * follow;
      ball.vel.x += (ahead.x - ball.pos.x) * 42 * DT;
      ball.vel.y += (ahead.y - ball.pos.y) * 42 * DT;
      ball.vel.x = ball.vel.x * (1 - 9 * DT) + owner.vel.x * 0.12;
      ball.vel.y = ball.vel.y * (1 - 9 * DT) + owner.vel.y * 0.12;
      const carryDx = ball.pos.x - owner.pos.x;
      const carryDy = ball.pos.y - owner.pos.y;
      const carryDist = len(carryDx, carryDy);
      const maxCarry = 0.94;
      if (carryDist > maxCarry) {
        ball.pos.x = owner.pos.x + (carryDx / carryDist) * maxCarry;
        ball.pos.y = owner.pos.y + (carryDy / carryDist) * maxCarry;
        ball.vel.x *= 0.55;
        ball.vel.y *= 0.55;
      }
    }

    // physics
    if (owner) this.clearLongAerialSkid();
    const longAerialSkid = !owner && this.longAerialSkidActive();
    const speed = len(ball.vel.x, ball.vel.y);
    if (ball.z > 0.02) {
      ball.vz += GRAVITY * DT;
      ball.vel.x *= 1 - BALL_AIR_DRAG * DT;
      ball.vel.y *= 1 - BALL_AIR_DRAG * DT;
    } else if (speed > 0) {
      const ns = this.groundBallSpeedAfterStep(speed, DT, longAerialSkid);
      ball.vel.x *= ns / (speed || 1);
      ball.vel.y *= ns / (speed || 1);
    }
    // curl
    if (Math.abs(ball.spin) > 0.01 && speed > 4) {
      const kickLen = len(ball.kickDir.x, ball.kickDir.y);
      const dirX = kickLen > 0.1 ? ball.kickDir.x / kickLen : ball.vel.x / speed;
      const dirY = kickLen > 0.1 ? ball.kickDir.y / kickLen : ball.vel.y / speed;
      const nx = -dirY, ny = dirX;
      ball.vel.x += nx * ball.spin * DT * 4;
      ball.vel.y += ny * ball.spin * DT * 4;
      const forward = ball.vel.x * dirX + ball.vel.y * dirY;
      if (forward < speed * 0.18) {
        const lateral = ball.vel.x * nx + ball.vel.y * ny;
        const safeForward = Math.max(speed * 0.18, 0.5);
        ball.vel.x = dirX * safeForward + nx * lateral;
        ball.vel.y = dirY * safeForward + ny * lateral;
      }
      ball.spin *= 1 - 1.2 * DT;
    }
    ball.pos.x += ball.vel.x * DT;
    ball.pos.y += ball.vel.y * DT;
    ball.z += ball.vz * DT;
    if (ball.z < 0) {
      ball.z = 0;
      if (Math.abs(ball.vz) > 2.5) this.emit({ type: 'bounce' });
      if (longAerialSkid) {
        ball.vel.x *= LONG_AERIAL_BOUNCE_DAMP;
        ball.vel.y *= LONG_AERIAL_BOUNCE_DAMP;
      }
      ball.vz = -ball.vz * this.bounceRestitution(longAerialSkid);
      if (Math.abs(ball.vz) < 1.2) ball.vz = 0;
    }
    this.handleBallPlayerContacts(prevBallPos);
    // post/crossbar collisions (simple): near goal mouth
    this.postCollision();
    this.tryReceiveLivePass();
    this.limitOpenPlayBallSnap(prevBallPos);
    return frameStart;
  }

  private limitOpenPlayBallSnap(prevBallPos: Vec2) {
    if (this.state.phase !== 'play') return;
    const ball = this.state.ball;
    const jump = dist(prevBallPos, ball.pos);
    const maxFrameMove = 2.85;
    if (jump <= maxFrameMove) return;
    const scale = maxFrameMove / jump;
    ball.pos.x = prevBallPos.x + (ball.pos.x - prevBallPos.x) * scale;
    ball.pos.y = prevBallPos.y + (ball.pos.y - prevBallPos.y) * scale;
    ball.vel.x *= 0.55;
    ball.vel.y *= 0.55;
  }

  private handleBallPlayerContacts(prevBallPos: Vec2) {
    const st = this.state;
    const ball = st.ball;
    if (st.phase !== 'play' || ball.ownerIdx !== -1 || ball.z > 1.65) return;
    const speed = len(ball.vel.x, ball.vel.y);
    if (speed < 0.4) return;
    const livePenalty = this.isLivePenaltyShot();

    let hit: SimPlayer | null = null;
    let hitD = Infinity;
    const contactRadius = PLAYER_RADIUS + BALL_RADIUS + 0.18;
    for (const p of st.players) {
      if (p.sentOff || p.injuredOff) continue;
      // a keeper beaten on his dive doesn't touch the ball — it flies past him
      if (p.isGK && p.diveBeaten) continue;
      if (livePenalty && !p.isGK) continue;
      if (p.kickCooldown > 0.2) continue;
      if (p.idx === ball.lastKicker && p.kickCooldown > 0.18) continue;
      if (p.idx === this.livePassTargetIdx && st.tick <= this.livePassTargetUntil) continue;
      const sweptD = pointSegDist(p.pos, prevBallPos, ball.pos);
      const currentD = dist(p.pos, ball.pos);
      const d = Math.min(sweptD, currentD);
      if (d < contactRadius && d < hitD) {
        hit = p;
        hitD = d;
      }
    }
    if (!hit) return;
    if (this.maybeCallPendingOffside(hit)) return;
    this.clearLongAerialSkid();

    const controlCap = (hit.isGK
      // a keeper gathers a comfortable shot into his body rather than parrying it —
      // a modest catch-ceiling lift so soft efforts are held, but fierce ones still
      // spill into a scramble (over-raising it turned the keeper into a brick wall)
      ? (11.5 + hit.attrs.keeping * 0.055) * this.wfx.gkCatch
      : 5.8 + hit.attrs.tackle * 0.035 + hit.attrs.pass * 0.025) * this.formFactor(hit);
    const fromOpponent = ball.lastTouchTeam !== hit.team;
    // a keeper committed to a beaten dive can't pull off a contact save either —
    // he is sprawling just short as the ball flies past
    const saveContact = (this.isGoalkeeperSaveContact(hit) || (hit.isGK && this.shotLive && fromOpponent)) && !hit.diveBeaten;
    const penaltySaveContact = saveContact && this.penaltyDiveGuess !== null;
    if (penaltySaveContact && !this.penaltyKeeperCoversShot()) return;
    if (ball.z < 1.05 && speed <= controlCap && !penaltySaveContact) {
      if (!hit.isGK && speed > 6.0) {
        const touch = this.firstTouchOutcome(hit, speed, fromOpponent);
        if (touch.loose) {
          this.spillLooseFirstTouch(hit, speed, touch);
          return;
        }
      }
      ball.ownerIdx = hit.idx;
      ball.vel.x = hit.vel.x;
      ball.vel.y = hit.vel.y;
      ball.vz = 0;
      ball.z = Math.min(ball.z, 0.1);
      ball.spin = 0;
      ball.lastTouchTeam = hit.team;
      ball.lastKicker = hit.idx;
      this.livePassTargetIdx = -1;
      this.livePassTargetUntil = -1;
      if (hit.isGK && (saveContact || fromOpponent || hit.diving)) this.beginGkHold(hit);
      if (saveContact) this.registerSave(hit);
      else this.shotLive = false;
      return;
    }

    if (saveContact) {
      const upfield = this.attackSign(hit.team);
      const wide = Math.sign(ball.pos.y || hit.pos.y || this.rng.range(-1, 1) || 1);
      ball.ownerIdx = -1;
      // push it out into the danger area for a scramble (not at his feet, not
      // upfield into a counter) — kept LOW so it rolls dead rather than skipping away
      ball.vel.x = upfield * this.rng.range(1.2, 2.6) + hit.vel.x * 0.08;
      ball.vel.y = wide * this.rng.range(2.4, 4.2) + hit.vel.y * 0.08;
      ball.vz = this.rng.range(0.1, 0.4);
      ball.spin = 0;
      ball.lastTouchTeam = hit.team;
      ball.lastKicker = hit.idx;
      ball.pos.x = clamp(hit.pos.x + upfield * (PLAYER_RADIUS + BALL_RADIUS + 0.3), -HALF_LEN + 0.25, HALF_LEN - 0.25);
      ball.pos.y = clamp(ball.pos.y, -HALF_WID + 0.4, HALF_WID - 0.4);
      this.livePassTargetIdx = -1;
      this.livePassTargetUntil = -1;
      this.registerSave(hit);
      return;
    }

    const nx0 = ball.pos.x - hit.pos.x;
    const ny0 = ball.pos.y - hit.pos.y;
    const nd = len(nx0, ny0);
    const ix = ball.vel.x / speed;
    const iy = ball.vel.y / speed;
    const nx = nd > 0.05 ? nx0 / nd : -ix;
    const ny = nd > 0.05 ? ny0 / nd : -iy;
    const tangent = { x: -ny, y: nx };
    const dot = ball.vel.x * nx + ball.vel.y * ny;
    const reboundBase = hit.isGK ? 0.22 : 0.42;
    // a keeper palms a fierce shot down into the danger area, he doesn't rocket it
    // back out — cap his rebound low so saves stay near goal for a scramble
    const outSpeed = clamp(speed * reboundBase, hit.isGK ? 2.6 : 4.2, hit.isGK ? 4.8 : 13);
    const side = this.rng.range(-1, 1) * (hit.isGK ? 1.8 : 1.2);
    if (dot < 0) {
      ball.vel.x = nx * outSpeed + tangent.x * side + hit.vel.x * 0.18;
      ball.vel.y = ny * outSpeed + tangent.y * side + hit.vel.y * 0.18;
    } else {
      ball.vel.x *= hit.isGK ? 0.28 : 0.36;
      ball.vel.y *= hit.isGK ? 0.28 : 0.36;
    }
    // a keeper's parry stays LOW and grounded — a lofted deflection skips and bounces
    // far (an airborne ball only feels weak air drag), which sent saves to halfway
    ball.vz = hit.isGK
      ? clamp(Math.max(0, ball.vz) * 0.1 + this.rng.range(0.1, 0.5), 0, 0.6)
      : clamp(Math.max(0, ball.vz) * 0.35 + this.rng.range(0.25, 1.5), 0, 2.2);
    ball.spin *= 0.15;
    ball.ownerIdx = -1;
    ball.lastTouchTeam = hit.team;
    ball.lastKicker = hit.idx;
    ball.pos.x = hit.pos.x + nx * (contactRadius + 0.03);
    ball.pos.y = hit.pos.y + ny * (contactRadius + 0.03);
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    if (saveContact) this.registerSave(hit);
    else this.shotLive = false;
  }

  private isGoalkeeperSaveContact(p: SimPlayer): boolean {
    if (!this.shotLive || !p.isGK) return false;
    const ball = this.state.ball;
    const sideSign = Math.sign(ball.vel.x || ball.kickDir.x || this.ownGoalDir(p.team));
    if (!sideSign) return false;
    const defendingTeam = (this.state.attackDir[0] === sideSign ? 1 : 0) as 0 | 1;
    if (p.team !== defendingTeam) return false;
    const goalX = -this.attackSign(p.team) * HALF_LEN;
    const distToLine = Math.abs(ball.pos.x - goalX);
    if (distToLine > 16 || Math.abs(ball.vel.x) < 0.5) return false;
    const tToLine = distToLine / Math.max(0.01, Math.abs(ball.vel.x));
    const yAtLine = ball.pos.y + ball.vel.y * tToLine;
    const zAtLine = ball.z + ball.vz * tToLine + 0.5 * GRAVITY * tToLine * tToLine;
    const nearFrame = Math.abs(yAtLine) <= GOAL_HALF_WIDTH + 0.85;
    const keeperWideBlock = Math.abs(p.pos.x - goalX) < 3.4
      && Math.abs(p.pos.y) <= GOAL_HALF_WIDTH + 2.7
      && Math.abs(yAtLine) <= GOAL_HALF_WIDTH + 3.0;
    return (nearFrame || keeperWideBlock) && zAtLine <= GOAL_HEIGHT + 0.65;
  }

  private penaltyKeeperCoversShot(): boolean {
    const guess = this.penaltyDiveGuess;
    if (guess === null) return true;
    const ball = this.state.ball;
    const sideSign = Math.sign(ball.vel.x || this.attackSign(this.state.restartTeam) || 1);
    const goalX = sideSign * HALF_LEN;
    const tToLine = Math.abs(goalX - ball.pos.x) / Math.max(0.01, Math.abs(ball.vel.x));
    const yAtLine = ball.pos.y + ball.vel.y * tToLine;
    if (Math.abs(yAtLine) < GOAL_HALF_WIDTH * 0.28) return guess === 0;
    return Math.sign(yAtLine) === guess;
  }

  private isLivePenaltyShot(): boolean {
    return this.state.phase === 'play'
      && this.shotLive
      && this.penaltyDiveGuess !== null
      && this.state.ball.ownerIdx === -1;
  }

  private registerSave(gk: SimPlayer) {
    this.shotLive = false;
    this.penaltyDiveGuess = null;
    this.lastSaveTick = this.state.tick;
    this.emit({ type: 'save', team: gk.team });
    this.state.excitement = Math.min(1, this.state.excitement + 0.25);
  }

  /**
   * A SPILLED save — the keeper got something to the ball but couldn't hold it. The rebound
   * is contextual to the body part it struck, read from the contact height:
   *  - low (legs/feet): blocked straight back OUT, low and quick.
   *  - mid (chest/body): parried DOWN and short, drops in front for a goalmouth scramble.
   *  - high (hands): tipped UP and away, over/around.
   * `outSign` points away from the keeper's goal; `lateral` is the side it spills toward.
   */
  private spillRebound(gk: SimPlayer, outSign: number, contactZ: number, lateral: number) {
    const ball = this.state.ball;
    const z = Math.max(0, contactZ);
    const side = Math.sign(lateral) || 1;
    if (z < 0.6) {
      ball.vel.x = outSign * this.rng.range(4.2, 6.8);
      ball.vel.y = side * this.rng.range(0, 1.4);
      ball.vz = this.rng.range(0.05, 0.25);
    } else if (z < 1.4) {
      ball.vel.x = outSign * this.rng.range(1.2, 2.8);
      ball.vel.y = side * this.rng.range(1.4, 3.2);
      ball.vz = this.rng.range(0.1, 0.35);
    } else {
      ball.vel.x = outSign * this.rng.range(2.0, 3.8);
      ball.vel.y = side * this.rng.range(2.0, 4.0);
      ball.vz = this.rng.range(0.5, 1.3);
    }
    ball.z = clamp(z, 0, 0.9);
    ball.spin = 0;
    ball.lastTouchTeam = gk.team;
    ball.lastKicker = gk.idx;
  }

  /**
   * The keeper has the ball safely in his hands. He holds it for a beat
   * before distributing; on a human team that window is longer so the player
   * can call the release: pass button = short throw, shoot button = long punt.
   */
  private beginGkHold(gk: SimPlayer) {
    this.state.ball.held = true;
    const humanTeam = this.cfg.teams[gk.team].controller !== 'ai';
    const holdSec = humanTeam ? 2.2 + this.rng.range(0, 1.2) : 0.9 + this.rng.range(0, 0.9);
    this.aiDecideAt.set(gk.idx, this.state.tick + Math.round(holdSec / DT));
  }

  private postCollision() {
    const ball = this.state.ball;
    for (const sx of [-1, 1]) {
      const gx = sx * HALF_LEN;
      for (const sy of [-1, 1]) {
        const post = { x: gx, y: sy * GOAL_HALF_WIDTH };
        const d = Math.hypot(ball.pos.x - post.x, ball.pos.y - post.y);
        if (d < 0.2 && ball.z < GOAL_HEIGHT) {
          // reflect
          const nx = (ball.pos.x - post.x) / (d || 1), ny = (ball.pos.y - post.y) / (d || 1);
          const dot = ball.vel.x * nx + ball.vel.y * ny;
          if (dot < 0) {
            ball.vel.x -= 2 * dot * nx;
            ball.vel.y -= 2 * dot * ny;
            ball.vel.x *= 0.55; ball.vel.y *= 0.55;
            this.emit({ type: 'post' });
            this.state.excitement = Math.min(1, this.state.excitement + 0.3);
          }
        }
      }
    }
  }

  private checkBounds(frameStart?: BallFrameStart) {
    const st = this.state;
    const ball = st.ball;
    // goals / byline
    if (Math.abs(ball.pos.x) > HALF_LEN + 0.05) {
      const sideSign = Math.sign(ball.pos.x);
      const crossing = this.goalLineCrossing(frameStart, sideSign);
      const isGoalMouth = crossing
        ? Math.abs(crossing.y) < GOAL_HALF_WIDTH && crossing.z < GOAL_HEIGHT
        : !frameStart && Math.abs(ball.pos.y) < GOAL_HALF_WIDTH && ball.z < GOAL_HEIGHT;
      if (isGoalMouth && Math.abs(ball.pos.x) < HALF_LEN + GOAL_HALF_WIDTH) {
        const scoringTeam = (st.attackDir[0] === sideSign ? 0 : 1) as 0 | 1;
        this.scoreGoal(scoringTeam);
        return;
      }
      if (Math.abs(ball.pos.x) > HALF_LEN + 0.4) {
        const defendingTeam = (st.attackDir[0] === sideSign ? 1 : 0) as 0 | 1;
        const attackingTeam = (1 - defendingTeam) as 0 | 1;
        // the shooter put it out himself (not deflected off a defender for a corner)
        const shooterMiss = ball.lastTouchTeam !== defendingTeam;
        const liveShotJustWide = this.shotLive
          && Math.abs(ball.pos.y) <= GOAL_HALF_WIDTH + 2.4
          && ball.z < GOAL_HEIGHT + 0.8;
        // skied into the stands or dragged miles wide — the crowd gives it the full
        // sarcastic "oooooh" mock cheer
        const liveShotWildMiss = this.shotLive && shooterMiss && !liveShotJustWide
          && (Math.abs(ball.pos.y) > GOAL_HALF_WIDTH + 5 || ball.z > GOAL_HEIGHT + 3);
        if (liveShotJustWide) {
          this.emit({ type: 'nearMiss' });
          st.excitement = Math.min(1, st.excitement + 0.24);
        } else if (liveShotWildMiss) {
          this.emit({ type: 'crowdMock', team: attackingTeam });
        }
        this.shotLive = false;
        this.penaltyDiveGuess = null;
        if (ball.lastTouchTeam === defendingTeam) {
          // corner for attackers
          const atk = (1 - defendingTeam) as 0 | 1;
          st.phase = 'corner';
          st.restartTeam = atk;
          st.restartPos = { x: sideSign * (HALF_LEN - 0.4), y: Math.sign(ball.pos.y || 1) * (HALF_WID - 0.4) };
        } else {
          st.phase = 'goalKick';
          st.restartTeam = defendingTeam;
          st.restartPos = { x: sideSign * (HALF_LEN - 6), y: 0 };
        }
        st.restartTimer = 1.0;
        this.pendingOffside = null;
        this.emit({ type: 'out' });
        this.emit({ type: 'whistle' });
        return;
      }
    }
    // touchlines
    if (Math.abs(ball.pos.y) > HALF_WID + 0.05) {
      const throwTeam = (1 - ball.lastTouchTeam) as 0 | 1;
      st.phase = 'throwIn';
      st.restartTeam = throwTeam;
      st.restartPos = { x: clamp(ball.pos.x, -HALF_LEN + 2, HALF_LEN - 2), y: Math.sign(ball.pos.y) * (HALF_WID - 0.2) };
      st.restartTimer = 1.0;
      this.pendingOffside = null;
      this.emit({ type: 'out' });
    }
  }

  private goalLineCrossing(frameStart: BallFrameStart | undefined, sideSign: number): { y: number; z: number } | null {
    if (!frameStart || !sideSign) return null;
    const ball = this.state.ball;
    const lineX = sideSign * HALF_LEN;
    const fromSide = (frameStart.pos.x - lineX) * sideSign;
    const toSide = (ball.pos.x - lineX) * sideSign;
    if (fromSide > 0) {
      const justBehindUncheckedLine = fromSide <= 0.06;
      if (justBehindUncheckedLine && toSide > 0 && Math.abs(frameStart.pos.y) < GOAL_HALF_WIDTH && frameStart.z < GOAL_HEIGHT) {
        return { y: frameStart.pos.y, z: frameStart.z };
      }
      return null;
    }
    if (toSide <= 0) return null;
    const dx = ball.pos.x - frameStart.pos.x;
    if (Math.abs(dx) < 0.0001) return null;
    const t = clamp((lineX - frameStart.pos.x) / dx, 0, 1);
    return {
      y: frameStart.pos.y + (ball.pos.y - frameStart.pos.y) * t,
      z: frameStart.z + (ball.z - frameStart.z) * t,
    };
  }

  private scoreGoal(team: 0 | 1) {
    const st = this.state;
    const goalSide = this.attackSign(team);
    const ballSpeed = len(st.ball.vel.x, st.ball.vel.y);
    st.score[team]++;
    this.pendingBurstGoal = this.lastGoalMinute[team] >= 0
      && (this.matchMinute() - this.lastGoalMinute[team]) <= BURST_WINDOW_MIN;
    this.lastGoalMinute[team] = this.matchMinute();
    this.shotLive = false;
    this.liveShotBigChance = false;
    this.liveShotTeam = -1;
    this.penaltyDiveGuess = null;
    const scorer = st.players[st.ball.lastKicker];
    const ownGoal = !!scorer && scorer.team !== team;
    const name = scorer ? `${scorer.attrs.name}${ownGoal ? ' (OG)' : ''}` : 'Unknown scorer';
    // credit an assist to the last DIFFERENT kicker (the passer) if they're a team-mate
    // of the scorer and the scorer has only had the ball briefly since the pass
    let assist: string | undefined;
    if (!ownGoal && scorer) {
      const prev = st.players[this.lastAssisterIdx];
      if (prev && prev.team === team && prev.idx !== scorer.idx && st.tick - this.lastAssisterTick < 900) {
        assist = prev.attrs.name;
      }
    }
    st.goals.push({ team, player: name, minute: this.matchMinute(), ownGoal, assist });
    st.phase = 'goalCelebration';
    st.restartTimer = 3.2;
    this.celebrationTeam = team;
    this.scoredGoalSide = goalSide;
    st.ball.ownerIdx = -1;
    st.ball.vel.x = goalSide * Math.max(Math.abs(st.ball.vel.x), ballSpeed * 0.65, 5.8);
    st.ball.vel.y *= 0.45;
    st.ball.spin = 0;
    this.pendingOffside = null;
    this.shotLive = false;
    st.excitement = 1;
    this.emit({ type: 'goal', team, player: scorer?.idx });
    this.pendingBurstGoal = false;
  }

  private settleBallInGoalNet() {
    const ball = this.state.ball;
    const side = this.scoredGoalSide || Math.sign(ball.pos.x || 1);
    const lineX = side * HALF_LEN;
    const backX = side * (HALF_LEN + GOAL_DEPTH);
    const behindLine = (ball.pos.x - lineX) * side;
    if (behindLine <= 0) return;

    ball.ownerIdx = -1;
    ball.spin = 0;
    const frontX = lineX + side * 0.08;
    if ((ball.pos.x - frontX) * side < 0) {
      ball.pos.x = frontX;
      if (ball.vel.x * side < 0) ball.vel.x = -ball.vel.x * 0.08;
    }

    if ((ball.pos.x - backX) * side > 0) {
      ball.pos.x = backX;
      if (ball.vel.x * side > 0) ball.vel.x = -ball.vel.x * 0.08;
    }

    const sideY = GOAL_HALF_WIDTH - 0.18;
    if (ball.pos.y > sideY) {
      ball.pos.y = sideY;
      if (ball.vel.y > 0) ball.vel.y = -ball.vel.y * 0.08;
    } else if (ball.pos.y < -sideY) {
      ball.pos.y = -sideY;
      if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * 0.08;
    }

    if (behindLine > GOAL_DEPTH * 0.35) {
      ball.vel.x *= 1 - 8 * DT;
      ball.vel.y *= 1 - 10 * DT;
    }
    if (Math.abs(ball.vel.x) < 0.25) ball.vel.x = 0;
    if (Math.abs(ball.vel.y) < 0.25) ball.vel.y = 0;
  }

  private matchMinute(): number {
    const halfLen = this.state.half <= 2 ? this.cfg.halfLengthSec : this.cfg.halfLengthSec / 3;
    const baseMin = this.state.half === 1 ? 0 : this.state.half === 2 ? 45 : this.state.half === 3 ? 90 : 105;
    const spanMin = this.state.half <= 2 ? 45 : 15;
    return Math.max(1, Math.ceil(baseMin + Math.min(spanMin, (this.state.clock / halfLen) * spanMin)));
  }

  /** Check if team should waste time (winning late in game, especially by 1 goal) */
  private shouldWasteTime(team: 0 | 1): boolean {
    const st = this.state;
    const minute = this.matchMinute();
    const goalDiff = st.score[team] - st.score[1 - team];
    const isLate = minute >= 80;
    const isVeryLate = minute >= 88;
    const winningBy1 = goalDiff === 1;
    const winningBy2Plus = goalDiff >= 2;
    // Waste time if: winning by 1 goal late, or winning by 2+ very late
    return (winningBy1 && isLate) || (winningBy2Plus && isVeryLate);
  }

  /** Check if team should go to corners to waste time (winning in opponent's half) */
  private shouldGoToCorner(p: SimPlayer): boolean {
    if (!this.shouldWasteTime(p.team)) return false;
    // Don't waste time if there's a clear scoring chance
    const myDir = this.attackSign(p.team);
    const goal = { x: myDir * HALF_LEN, y: 0 };
    if (this.isClearScoringChance(p, goal)) return false;
    const inOpponentHalf = p.pos.x * myDir > 0;
    const nearGoal = p.pos.x * myDir > HALF_LEN - 35;
    // Only go to corner if in opponent's half but not too close to goal (to avoid own goal risk)
    return inOpponentHalf && !nearGoal;
  }

  // ------------------------------------------------------------ goalkeeper

  private nearPostThreatSide(shooter: SimPlayer | undefined, gk: SimPlayer, yAtLine: number, distToLine: number, looseSave = false): -1 | 0 | 1 {
    if (!shooter || looseSave || shooter.team === gk.team) return 0;
    // A near-post chance can come after the runner has cut inside the post.
    // Classify by side and diagonal shape, not only by being outside the frame.
    if (Math.abs(shooter.pos.y) <= GOAL_HALF_WIDTH * 0.75) return 0;
    const side = Math.sign(shooter.pos.y || 0) as -1 | 0 | 1;
    if (!side || side !== Math.sign(yAtLine || 0)) return 0;
    if (Math.abs(shooter.pos.y) <= Math.abs(yAtLine) + 0.25) return 0;
    if (Math.abs(yAtLine) <= GOAL_HALF_WIDTH * 0.5) return 0;
    if (distToLine >= 12) return 0;
    return side;
  }

  private nearPostCoverageY(nearPostSide: -1 | 0 | 1, yAtLine: number, keeperY: number): number {
    if (!nearPostSide) return yAtLine;
    return nearPostSide * Math.max(
      Math.abs(yAtLine),
      Math.min(Math.abs(keeperY) + 0.16, GOAL_HALF_WIDTH + 0.2),
    );
  }

  private gkPosition(p: SimPlayer): Vec2 {
    const raw = this.gkPositionRaw(p);
    // The "go for the ball / stay on the line, over and over" twitch: as a man comes through,
    // one read says rush out (track the attacker) and another says hold the line (track the
    // ball, which a dribbler knocks ahead) — and they alternate every few ticks, strobing him
    // in and out. Fix is ASYMMETRIC on his depth off the line: he steps OUT fast (a decisive
    // rush is never blunted) but drifts BACK slowly, so once he commits ground toward the
    // attacker he holds it instead of snapping to his line the instant the read flips. Lateral
    // tracking is lightly smoothed. A live shot/dive must be instant, so it bypasses entirely.
    if (this.shotLive || this.state.phase !== 'play') {
      this.gkTargetMemo.set(p.idx, { x: raw.x, y: raw.y });
      return raw;
    }
    const prev = this.gkTargetMemo.get(p.idx);
    if (!prev) { this.gkTargetMemo.set(p.idx, { x: raw.x, y: raw.y }); return raw; }
    const ownGoalX = -this.attackSign(p.team) * HALF_LEN;
    const advancing = Math.abs(raw.x - ownGoalX) >= Math.abs(prev.x - ownGoalX);
    const ax = advancing ? 0.85 : 0.1; // out fast, back slow
    const next = { x: prev.x + (raw.x - prev.x) * ax, y: prev.y + (raw.y - prev.y) * 0.45 };
    this.gkTargetMemo.set(p.idx, next);
    return next;
  }

  private gkPositionRaw(p: SimPlayer): Vec2 {
    const st = this.state;
    const dir = this.attackSign(p.team);
    const goalX = -dir * (HALF_LEN - 0.9);
    const ball = st.ball;
    const owner = this.owner();
    const keeping = clamp(this.effectiveAttr(p, 'keeping') / 100, 0, 1);
    if (!this.shotLive) this.gkLineY = null;
    // At a penalty the keeper must hold his goal line until the kick is struck. He must
    // NOT rush out at — or "claim" — the dead ball sitting on the spot: the central-threat
    // rush-out and the loose-ball-claim branches below would otherwise march him out and
    // leave him standing in front of the ball. Once the shot is live the dive logic
    // (penaltyDiveGuess branch, just below) takes over.
    if (st.phase === 'penaltyKick') {
      return { x: goalX, y: 0 };
    }
    // a deliberate back-pass: come off the line and gather it on his feet (the dive
    // is already suppressed in looseBallGoalThreat). This is the SINGLE source of
    // his target while collecting, so he moves smoothly instead of twitching
    // between "claim the ball" and "hold the line".
    if (this.isBackPassToKeeper(p)) {
      const lead = clamp(dist(p.pos, ball.pos) / 14, 0.06, 0.34);
      const ownGoalX = -dir * HALF_LEN;
      const farOut = ownGoalX + dir * 17;
      return {
        x: clamp(ball.pos.x + ball.vel.x * lead, Math.min(ownGoalX, farOut), Math.max(ownGoalX, farOut)),
        y: clamp(ball.pos.y + ball.vel.y * lead, -GOAL_HALF_WIDTH * 2.4, GOAL_HALF_WIDTH * 2.4),
      };
    }
    if (this.shotLive && this.penaltyDiveGuess !== null) {
      return {
        x: goalX + dir * 0.5,
        y: this.penaltyDiveGuess * GOAL_HALF_WIDTH * 0.82,
      };
    }
    // a live shot at our goal: get set on the line and only EDGE toward the
    // ball's line — a keeper can't stroll across the whole goal to a corner
    // during a struck shot, he has to dive for it (and whether he reaches is
    // decided by the dive). Edging is capped so the dive does the real work.
    if (this.shotLive && ball.ownerIdx === -1 && Math.abs(ball.vel.x) > 2
      && Math.sign(ball.vel.x) === -dir && this.penaltyDiveGuess === null) {
      const myGoalX = -dir * HALF_LEN;
      const distToLine = Math.abs(ball.pos.x - myGoalX);
      if (distToLine < 26) {
        const tToLine = distToLine / Math.max(0.01, Math.abs(ball.vel.x));
        const yAtLine = ball.pos.y + ball.vel.y * tToLine;
        const shooter = st.players[ball.lastKicker];
        const nearPostSide = this.nearPostThreatSide(shooter, p, yAtLine, distToLine);
        const targetLineY = this.nearPostCoverageY(nearPostSide, yAtLine, p.pos.y);
        if (this.gkLineY == null) this.gkSetY = p.pos.y; // anchor at the moment the shot is struck
        this.gkLineY = this.gkLineY == null ? targetLineY : this.gkLineY + (targetLineY - this.gkLineY) * 0.35;
        // edge at most ~0.7m from his set position — no walking across to a corner
        const setY = clamp(this.gkLineY, this.gkSetY - 0.7, this.gkSetY + 0.7);
        return {
          x: goalX + dir * (0.4 + keeping * 0.8),
          y: clamp(setY, -GOAL_HALF_WIDTH - 0.6, GOAL_HALF_WIDTH + 0.6),
        };
      }
    }
    // The keeper's threat read follows the man in possession. But a dribbler knocks the
    // ball a couple of metres ahead between touches, and for those few ticks the ball is
    // un-owned (ownerIdx === -1) until he runs onto it again. The whole rush branch was
    // gated on a live owner, so it dropped out every touch and the keeper snapped back to
    // his line — the "jitter back and forth as if stuck between two rules". While a rush
    // commit is live, keep treating the committed attacker as the threat across that gap,
    // as long as he's still right on top of the (low) ball.
    let att: SimPlayer | null = owner && owner.team !== p.team && !owner.isGK ? owner : null;
    if (!att) {
      const c = this.gkRushCommit.get(p.idx);
      const a = c && c.until > st.tick ? st.players[c.ownerIdx] : null;
      if (a && !a.sentOff && a.team !== p.team && !a.isGK && dist(a.pos, ball.pos) < 3.0) att = a;
    }
    if (att && ball.z < 0.9) {
      const ownGoalX = -dir * HALF_LEN;
      const threatDepth = Math.abs(att.pos.x - ownGoalX);
      const threatWide = Math.abs(att.pos.y);
      // "ball at his feet" for the keeper's threat read is generous: a man dribbling at
      // pace pushes the ball a couple of metres ahead between touches, and a tight 1.45m
      // test flicked on/off every touch — that toggled roundingLane and snapped the rush
      // target between the aggressive charge and the measured rush. At ~3m it reads as
      // "he's carrying it" steadily.
      const ballAtFeet = dist(att.pos, ball.pos) < 3.0;
      const attSpeed = len(att.vel.x, att.vel.y);
      const closingGoal = (att.vel.x * (ownGoalX - att.pos.x)) > 0.45;
      const committed = this.gkRushCommit.get(p.idx);
      let rushTarget: Vec2 | null = null;
      const roundingLane = ballAtFeet
        && attSpeed > 1.1
        && closingGoal
        && threatDepth < 17 + keeping * 3
        && threatWide < GOAL_HALF_WIDTH + 5.8 + keeping * 2.2;
      if (roundingLane) {
        const lateralLimit = GOAL_HALF_WIDTH + 3.8 + keeping * 2.2;
        const stepOut = 0.9 + keeping * 1.25;
        const nearLine = ownGoalX + dir * 1.2;
        const farCharge = ownGoalX + dir * (9.6 + keeping * 3.6);
        rushTarget = {
          x: clamp(att.pos.x + dir * stepOut, Math.min(nearLine, farCharge), Math.max(nearLine, farCharge)),
          y: clamp(att.pos.y + att.vel.y * 0.12, -lateralLimit, lateralLimit),
        };
      }
      const depthScore = clamp((16 + keeping * 4.2 - threatDepth) / 5.5, 0, 1);
      const widthScore = clamp((12 + keeping * 5.2 - threatWide) / 6, 0, 1);
      const threatScore = depthScore * widthScore;
      if (!rushTarget && threatScore > 0) {
        const nearPost = ownGoalX + dir * 1.4;
        // only rush out to narrow the angle on a CENTRAL threat. For a wide attacker
        // the angle is already tight from the post, so coming out just abandons the
        // goal — hold near the line and let him shoot across an empty net instead.
        const centralFactor = clamp(1 - Math.abs(att.pos.y) / 12, 0.18, 1);
        const farLimit = ownGoalX + dir * (3 + (5.5 + keeping * 3.4) * centralFactor);
        const lo = Math.min(nearPost, farLimit);
        const hi = Math.max(nearPost, farLimit);
        // shade TOWARD the attacker but stay inside the frame so the far corner is
        // always coverable — mirroring his y 1:1 (and clamping a metre past the post)
        // left the keeper standing wide of his near post with the whole far side open
        const angleClamp = GOAL_HALF_WIDTH * 0.97;
        const advance = 0.6 + keeping * 1.45;
        const lineX = goalX + dir * (1.2 + keeping * 0.85);
        const attSide = Math.sign(att.pos.y || 0) as -1 | 0 | 1;
        const nearPostPreShot = attSide !== 0
          && ballAtFeet
          && threatDepth < 18 + keeping * 2.5
          && threatWide > GOAL_HALF_WIDTH * 0.72
          && threatWide < PENALTY_BOX_HALF_WIDTH + 2;
        const nearPostSetY = nearPostPreShot
          ? attSide * GOAL_HALF_WIDTH * (0.84 + keeping * 0.18)
          : 0;
        const lineYRaw = att.pos.y * 0.46;
        const lineY = clamp(
          nearPostPreShot
            ? attSide * Math.max(Math.abs(lineYRaw), Math.abs(nearPostSetY))
            : lineYRaw,
          -angleClamp,
          angleClamp,
        );
        const rushX = clamp(att.pos.x + dir * advance, lo, hi);
        const rushYRaw = att.pos.y * (0.62 + keeping * 0.1);
        const rushY = clamp(
          nearPostPreShot
            ? attSide * Math.max(Math.abs(rushYRaw), Math.abs(nearPostSetY))
            : rushYRaw,
          -angleClamp,
          angleClamp,
        );
        rushTarget = {
          x: lineX + (rushX - lineX) * threatScore,
          y: lineY + (rushY - lineY) * threatScore,
        };
      }
      // Once committed to a charge at THIS attacker, hold it for the full commit window
      // (~0.55s) regardless of a momentary dip in the threat read — only the window
      // expiring or the owner changing (a pass) ends it. This, with the generous
      // ballAtFeet above, stops the keeper snapping between his charge and his line.
      if (committed && committed.ownerIdx === att.idx && committed.until > st.tick) {
        if (!rushTarget) return committed.target;
        const committedDepth = Math.abs(committed.target.x - ownGoalX);
        const nextDepth = Math.abs(rushTarget.x - ownGoalX);
        if (nextDepth < committedDepth - 0.55) return committed.target;
        const followTarget = {
          x: committed.target.x + (rushTarget.x - committed.target.x) * 0.42,
          y: committed.target.y + (rushTarget.y - committed.target.y) * 0.42,
        };
        this.gkRushCommit.set(p.idx, {
          ownerIdx: att.idx,
          target: followTarget,
          until: st.tick + Math.round(0.55 / DT),
        });
        return followTarget;
      }
      if (committed) this.gkRushCommit.delete(p.idx);
      if (rushTarget) {
        this.gkRushCommit.set(p.idx, {
          ownerIdx: att.idx,
          target: rushTarget,
          until: st.tick + Math.round(0.55 / DT),
        });
        return rushTarget;
      }
      this.gkRushCommit.delete(p.idx);
    } else {
      this.gkRushCommit.delete(p.idx);
    }
    // claim loose ball near box
    const dBall = dist(p.pos, ball.pos);
    const ballInBox = Math.abs(ball.pos.x - -dir * HALF_LEN) < 14 && Math.abs(ball.pos.y) < 18;
    if (!this.owner() && ballInBox && dBall < 9 && len(ball.vel.x, ball.vel.y) < 9) {
      return { ...ball.pos };
    }
    // Position off the THREAT, not the loose ball: a dribbler knocks the ball a couple of
    // metres ahead between touches, so reading the ball's live spot jittered the keeper's
    // line. When an opponent is carrying it (att, smooth), shade off him; otherwise off the
    // ball (a real loose ball / shot to read).
    const ref = att ? att.pos : ball.pos;
    const t = clamp((ref.x * -dir + HALF_LEN) / PITCH_FACT, 0, 1);
    // sit on the near-post line, not the centre of the goal: shifting further
    // toward the ball's side narrows the near-post angle (the easy chance) and
    // makes goals feel earned. Wider/closer attackers pull the keeper across more.
    const y = clamp(ref.y * (0.42 + 0.12 * (1 - t)), -GOAL_HALF_WIDTH * 0.84, GOAL_HALF_WIDTH * 0.84);
    const advance = (1 - t) * (2.4 + keeping * 1.4);
    return { x: goalX + dir * advance, y };
  }

  private looseBallGoalThreat(): { defTeam: 0 | 1; sideSign: number } | null {
    const st = this.state;
    const ball = st.ball;
    if (st.phase !== 'play' || ball.ownerIdx >= 0 || ball.z > GOAL_HEIGHT + 0.45) return null;
    const speed = len(ball.vel.x, ball.vel.y);
    // react to slower goalward balls too — a pass/scuff rolling at goal at ~1.2-1.8
    // m/s of closing pace used to be ignored and trickle in unchallenged
    if (speed < 2.2 || Math.abs(ball.vel.x) < 1.2) return null;
    const sideSign = Math.sign(ball.vel.x);
    if (!sideSign) return null;
    const goalX = sideSign * HALF_LEN;
    if ((goalX - ball.pos.x) * sideSign < -0.05) return null;
    const distToLine = Math.abs(ball.pos.x - goalX);
    if (distToLine > 18) return null;
    const tToLine = distToLine / Math.max(0.01, Math.abs(ball.vel.x));
    if (tToLine > 2.2) return null;
    const yAtLine = ball.pos.y + ball.vel.y * tToLine;
    const zAtLine = ball.z + ball.vz * tToLine + 0.5 * GRAVITY * tToLine * tToLine;
    if (Math.abs(yAtLine) > GOAL_HALF_WIDTH + 0.75 || zAtLine > GOAL_HEIGHT + 0.35) return null;
    const defTeam = (st.attackDir[0] === sideSign ? 1 : 0) as 0 | 1;
    // a ball his own team DELIBERATELY played back to him is his to gather, not a
    // shot to dive at — suppress the loose-shot threat so he collects it on his
    // feet (92/93 back-pass rule). A deflection clears the live pass target, so it
    // is NOT treated as a back-pass and still draws a save.
    const defGk = st.players.find((p) => p.team === defTeam && p.isGK && !p.sentOff);
    if (defGk && this.isBackPassToKeeper(defGk)) return null;
    return { defTeam, sideSign };
  }

  /**
   * True when the ball is a DELIBERATE back-pass to this keeper — his own team
   * last touched it and named him the live pass target (a real pass sets that;
   * a deflection clears it). He collects such a ball on his feet rather than
   * flinging himself at it as though it were a shot. Movement to gather it is
   * handled in gkPosition, so there is a single source of his target (no twitch).
   */
  private isBackPassToKeeper(gk: SimPlayer): boolean {
    const st = this.state;
    const ball = st.ball;
    if (st.phase !== 'play' || ball.ownerIdx >= 0 || this.shotLive) return false;
    if (ball.z > GOAL_HEIGHT || gk.diving || gk.sentOff) return false;
    return ball.lastTouchTeam === gk.team
      && this.livePassTargetIdx === gk.idx
      && st.tick <= this.livePassTargetUntil;
  }

  private goalkeeperLogic() {
    const st = this.state;
    // stamp when a shot became live so the keeper's reaction window can run, and
    // grade the chance: a composed finisher with space can pick out the corner;
    // a pressured, scrappy or low-skill effort is much easier to keep out
    if (this.shotLive && !this.shotLivePrev) {
      this.shotLiveSince = st.tick;
      const shooter = st.players[st.ball.lastKicker];
      if (shooter) {
        const press = this.nearestOpponentDist(shooter);
        const skill = clamp(shooter.attrs.shoot / 100, 0, 1);
        const goalX = this.attackSign(shooter.team) * HALF_LEN;
        this.shotStruckDist = Math.hypot(goalX - shooter.pos.x, shooter.pos.y);
        // a shot struck from distance is a lower-quality chance even with space:
        // the keeper has more flight time to set and the angle is unforgiving, so
        // long-range efforts are kept out more often (but not impossible)
        const distPenalty = Math.max(0, this.shotStruckDist - 18) * 0.017;
        this.shotOpenness = clamp(0.22 + clamp(press / 5.5, 0, 1) * 0.45 + skill * 0.34 - distPenalty, 0.15, 1);
        const goalCenter = { x: goalX, y: 0 };
        const oppKeeper = st.players.find((p) => p.team !== shooter.team && p.isGK && !p.sentOff);
        const keeperGap = oppKeeper ? Math.abs(oppKeeper.pos.x - goalCenter.x) : 99;
        // genuine clean-through one-on-one — mirrors aiShoot's oneOnOne test
        this.liveShotBigChance = this.isClearScoringChance(shooter, goalCenter)
          && this.shotStruckDist < 22 && keeperGap > 1.5;
        this.liveShotTeam = this.liveShotBigChance ? (shooter.team as 0 | 1) : -1;
      } else {
        this.shotOpenness = 0.7;
        this.shotStruckDist = 14;
        this.liveShotBigChance = false;
        this.liveShotTeam = -1;
      }
    }
    if (!this.shotLive && this.shotLivePrev && this.liveShotBigChance) {
      this.liveShotBigChance = false;
      this.liveShotTeam = -1;
    }
    this.shotLivePrev = this.shotLive;
    if (!this.shotLive && this.penaltyDiveGuess !== null) this.penaltyDiveGuess = null;
    if (this.goalkeeperCloseDown()) return;
    const ball = st.ball;
    const looseThreat = this.looseBallGoalThreat();
    const looseSave = !this.shotLive && !!looseThreat;
    if (!this.shotLive && !looseThreat) return;
    const speed = len(ball.vel.x, ball.vel.y);
    if (speed < (looseSave ? 2.6 : 5)) { if (this.shotLive) this.shotLive = false; return; }
    const sideSign = Math.sign(ball.vel.x || looseThreat?.sideSign || 0);
    if (!sideSign) return;
    const defTeam = looseThreat?.defTeam ?? ((st.attackDir[0] === sideSign ? 1 : 0) as 0 | 1);
    const gk = st.players.find((p) => p.team === defTeam && p.isGK);
    if (!gk) return;
    const keepingAttr = this.effectiveAttr(gk, 'keeping');
    const keepingQuality = clamp(keepingAttr / 100, 0, 1);
    // a keeper committed to a beaten dive is out of this shot — he can't recover
    // to save it as a "loose ball" as it rolls into the net behind him
    if (gk.diving && gk.diveBeaten) return;
    const goalX = sideSign * HALF_LEN;
    const distToLine = Math.abs(ball.pos.x - goalX);
    if (distToLine > 18 || (ball.pos.x - gk.pos.x) * sideSign > 2) return;
    const tToLine = distToLine / Math.max(0.01, Math.abs(ball.vel.x));
    const yAtLine = ball.pos.y + ball.vel.y * tToLine;
    const zAtLine = ball.z + ball.vz * tToLine + 0.5 * GRAVITY * tToLine * tToLine;
    if (!looseSave && this.goalkeeperRushShotBlock(gk, sideSign, goalX, tToLine, yAtLine, zAtLine, speed, keepingAttr, keepingQuality)) return;
    if (distToLine > 12) return;
    // only a keeper who is actually at home can make a line save
    if (Math.abs(gk.pos.x - goalX) > 3.5) return;
    if (Math.abs(yAtLine) > GOAL_HALF_WIDTH + 1 || zAtLine > GOAL_HEIGHT + 0.5) { return; }
    const shooter = st.players[ball.lastKicker];
    const nearPostSide = this.nearPostThreatSide(shooter, gk, yAtLine, distToLine, looseSave);
    const nearPostThreat = nearPostSide !== 0;
    if (looseSave && distToLine < 10 && dist(gk.pos, ball.pos) > 2.1) {
      const toBallX = ball.pos.x - gk.pos.x;
      const toBallY = ball.pos.y - gk.pos.y;
      const toBallD = len(toBallX, toBallY) || 1;
      gk.vel.x = toBallX / toBallD * (4.6 + keepingAttr * 0.026);
      gk.vel.y = toBallY / toBallD * (4.6 + keepingAttr * 0.026);
      gk.facing = Math.atan2(toBallY, toBallX);
    }
    // a penalty keeper dives the corner he picked, not the one the ball took.
    // For an open-play shot, dive relative to his SET anchor, not his live position:
    // while edging across the line `yAtLine - gk.pos.y` can flip sign and send him
    // the WRONG way on an angled effort.
    const diveDir = this.penaltyDiveGuess !== null
      ? this.penaltyDiveGuess
      : (Math.sign(yAtLine - (this.shotLive ? this.gkSetY : gk.pos.y)) || (yAtLine >= 0 ? 1 : -1));
    // positioning first: a ball within a step of him is covered on foot
    // (gkPosition is already walking him across the line); the full-stretch
    // dive is for balls a step can't reach, and only at proper shot pace
    const gapNow = Math.abs(yAtLine - gk.pos.y);
    // the shot is heading into the frame (inside the posts, under the bar)
    // within the posts and under the bar (no lower z bound — a low rolling shot
    // whose projectile dips below zero before the line is still a ground shot)
    const onTarget = Math.abs(yAtLine) <= GOAL_HALF_WIDTH + 0.15
      && zAtLine <= GOAL_HEIGHT + 0.2;
    // The keeper commits to a dive for ANY on-target shot with real pace that
    // isn't drilled straight at him — including ones he won't reach. A goal then
    // looks like he was beaten at full stretch, not like he stood and watched.
    // Whether it is actually kept out is still settled by the save resolution.
    const mustDive = this.penaltyDiveGuess !== null
      || (onTarget && speed >= 6 && (gapNow > 0.5 || nearPostThreat));
    // Only dive if ball is still outside the goal (not already in the net)
    const ballPastGoalLine = (ball.pos.x - goalX) * Math.sign(goalX) > 0;
    const timeToBallAtLine = distToLine / Math.max(0.01, speed);
    const ballBeyondKeeper = (ball.pos.x - gk.pos.x) * sideSign > 0.2;
    const diveTargetX = ballBeyondKeeper
      ? goalX - sideSign * 0.5
      : gk.pos.x - sideSign * 0.08;
    // From a tight angle the keeper should stay big on the near post. If he is
    // already set wider than the ball's projected line, diving inward looks like
    // he has abandoned that post, so hold/drop toward the post-side shape instead.
    const lineDiveY = this.nearPostCoverageY(nearPostSide, yAtLine, gk.pos.y);
    const keeperDistToTarget = dist(gk.pos, { x: diveTargetX, y: lineDiveY });
    // a touch more spring in the dive so the keeper reaches shots he was
    // previously a fraction short of
    const diveSpeed = 10.6 + keepingAttr * 0.04;
    // Time the leap to the shot's arrival, whether or not he can actually get
    // there: he reaches the ones in range and is beaten full-stretch by the
    // rest. Diving so early he arrives before the ball is the only thing that
    // looks daft, so that is all we gate out.
    const ballImminent = timeToBallAtLine < 0.6;
    // Can he genuinely get there in time? If yes, it's a real save attempt; if
    // no, it's a committed-but-beaten dive — he still throws himself at it, but
    // the diving-reach save is suppressed so it doesn't become a brick wall.
    // reflex window: elite keepers spring almost instantly; poor keepers freeze
    // for a beat, so quick, fierce shots are past them before they leave their feet
    const reactionDelay = (1 - keepingQuality) * 0.28;
    const canReact = this.penaltyDiveGuess !== null || this.shotLiveSince < 0 || (st.tick - this.shotLiveSince) * DT >= reactionDelay;
    const armReach = 1.24 + keepingAttr * 0.014;
    if (diveDir && distToLine < 12 && mustDive && !gk.diving && !ballPastGoalLine && ballImminent && canReact) {
      // Does the shot beat him? Placement and pace decide: a firm, well-placed
      // shot into the corner beats even a good keeper a fair share of the time,
      // while tame or central efforts are kept out. A beaten keeper still throws
      // himself full-length but comes up short, so it reads as a real goal —
      // not a ball squirming through a brick wall.
      // how far he must dive from where he is set, relative to his reach — a ball
      // close to him is kept out, one flung toward the corner beats him more often,
      // and a fierce strike beats him more than a tame one. Better keepers save more.
      const hardFrac = clamp(speed / 34, 0, 1);
      const kq = keepingQuality;
      const reachSpan = armReach + 1.6;
      const stretchFrac = clamp(gapNow / reachSpan, 0, 1.3);
      const withinArmReach = gapNow <= 1.1; // point-blank, straight at him — always kept out
      const nearPostCovered = nearPostThreat && gapNow <= armReach + 0.85;
      // steep in placement: only a genuine corner (high stretch) with pace beats
      // him; mid efforts are mostly kept out, central ones always. Scaled by the
      // quality of the chance so the keeper isn't beaten by every speculative shot.
      const beatProb = withinArmReach || nearPostCovered || this.penaltyDiveGuess !== null ? 0 : clamp(
        Math.pow(stretchFrac, 2.6) * (0.28 + hardFrac * 0.22) * (1.18 - kq * 0.5) * this.shotOpenness - 0.02,
        0, 0.38,
      );
      const beaten = beatProb > 0 && this.rng.next() < beatProb;
      // window long enough for load -> spring -> full stretch -> back to feet
      gk.slideTimer = Math.max(gk.slideTimer, 0.78);
      gk.diving = true;
      gk.diveBeaten = beaten;
      // a beaten dive falls just short of the ball; a save reaches it
      const reachFrac = beaten ? 0.8 : 1;
      // Dive across the line. Only move backwards toward the goal if the ball
      // has already gone beyond the keeper.
      const toTargetX = diveTargetX - gk.pos.x;
      const toTargetY = (lineDiveY - gk.pos.y) * reachFrac;
      const distToTarget = len(toTargetX, toTargetY) || 1;
      // On a near-post effort from a tight / cut-in angle the keeper SQUARES UP to
      // his goal line, so the dive reads as a clean sideways stop toward the post.
      // Facing the ball on a sharp angle put his chest ALONG the dive line, leaving
      // the sideways roll no defined side — he flung himself away from the ball even
      // as he saved it ("dived out of the way"). Central shots still face the strike.
      const toShotX = ball.pos.x - gk.pos.x;
      const toShotY = ball.pos.y - gk.pos.y;
      if (nearPostThreat) {
        gk.facing = sideSign > 0 ? Math.PI : 0; // chest square to the goal line
      } else if (len(toShotX, toShotY) > 0.01) {
        gk.facing = Math.atan2(toShotY, toShotX);
      }
      // Dive side = facing × dive-velocity, the renderer's own convention. With the
      // chest squared this is stable (the dive is perpendicular to his facing) and
      // the roll matches the way he actually moves to the ball.
      const sideFromBall = Math.sign(diveDir) as -1 | 0 | 1;
      const diveCross = Math.cos(gk.facing) * toTargetY - Math.sin(gk.facing) * toTargetX;
      gk.diveSide = (Math.sign(diveCross) || sideFromBall || 1) as -1 | 1;
      gk.diveKind = 'line';
      // Adjust speed so we arrive as ball arrives (not too early)
      const adjustedSpeed = Math.min(diveSpeed, keeperDistToTarget / Math.max(0.15, timeToBallAtLine * 0.9));
      gk.vel.x = (toTargetX / distToTarget) * adjustedSpeed;
      gk.vel.y = (toTargetY / distToTarget) * adjustedSpeed;
      gk.anim = 'dive';
    }
    const penaltyShot = this.penaltyDiveGuess !== null;
    const reach = penaltyShot
      ? 0.9 + keepingAttr * 0.008
      // a recognised near-post effort: the keeper genuinely competes for his near
      // post even when he is a fraction off it, so a shot squeezed in at the post
      // is contested rather than handed a zero-chance window
      : (nearPostThreat ? 1.62 + keepingAttr * 0.016 : 1.24 + keepingAttr * 0.014);
    const gap = Math.abs(yAtLine - gk.pos.y);
    // resolve only once the ball is genuinely at the keeper, so a save never
    // visibly teleports the ball across the box; until then keep tracking
    if (dist(gk.pos, ball.pos) > 2.0) return;
    if (distToLine < (looseSave ? 3.8 : 2.8)) {
      const hard = clamp(speed / 30, 0, 1);
      const guessedPenaltySide = !penaltyShot
        || this.penaltyDiveGuess === 0
        || Math.sign(yAtLine || 0.001) === this.penaltyDiveGuess;
      if (penaltyShot && !guessedPenaltySide) return;
      if (!looseSave && !penaltyShot) this.shotLive = false; // one attempt
      // a committed-but-beaten dive: he made the full attempt and is left
      // sprawling as the ball flies past — no diving-reach save here
      if (gk.diveBeaten && !looseSave && !penaltyShot) return;
      const penaltyFactor = penaltyShot ? (guessedPenaltySide ? 0.52 : 0.04) : 1;
      const stretch = clamp(gap / (reach + 0.001), 0, 1.45);
      // keepingFloor: even a weak keeper (quality 0.4) saves routine, central,
      // slow shots most of the time — you don't get 8-0 hammerings just because
      // the keeper stat is below 50. The floor ensures a baseline competence.
      const keepingFloor = 0.28 + keepingQuality * 0.12;
      const saveProb = clamp(
        Math.max(keepingFloor, keepingQuality * 1.15)
          * this.diff.keeper
          * this.wfx.gkCatch
          * penaltyFactor
          * (1.06 - hard * 0.42)
          * (1.14 - stretch * 0.5)
          * (1 - Math.max(0, stretch - 0.62) * 0.1)
          + (nearPostThreat ? 0.26 : 0),
        0.06,
        penaltyShot ? 0.38 : nearPostThreat ? 0.92 : 0.86,
      );
      const looseGather = looseSave && speed < 13 && gap < reach + 0.95 && Math.max(0, zAtLine) < 1.35;
      if ((gap < reach + 0.75 && this.rng.next() < saveProb) || looseGather) {
        // hold or push away? An easy ball into the body is held; a screamer at
        // full stretch is beaten out. Weighted by shot power, how far the
        // keeper had to dive, his keeping stat and a greasy ball in the rain.
        const ballDistNow = dist(gk.pos, ball.pos);
        const bodyBehindBall = gap < reach * 0.42 && ballDistNow < 1.15;
        // power makes a shot harder to hold — but good HANDLING grips it. The penalty for
        // pace scales DOWN with keeping quality, so an elite keeper holds a firm shot he's
        // set behind while a poor keeper parries it back into danger.
        const hardHoldFactor = 1 - hard * (bodyBehindBall ? 0.48 : 0.82) * (1 - keepingQuality * 0.6);
        const stretchHoldFactor = clamp(1.08 - stretch * 0.82, 0.08, 1.08);
        const holdProb = clamp(
          // Handling, driven by the keeper's rating: a great keeper grips nearly everything
          // catchable, a poor keeper spills fierce/stretched shots back into danger. The shot
          // difficulty is already in hardHoldFactor/stretchHoldFactor, so an EASY shot lands
          // near the rating-only top end (a 96 keeper ~0.97) while a screamer at full stretch
          // drops near the floor regardless of who's in goal.
          (0.30 + keepingQuality * 0.68)
            * this.wfx.gkCatch
            * hardHoldFactor
            * stretchHoldFactor,
          0.05, 0.97,
        );
        // Anything he can actually get hold of (not over his head, not a near-post fingertip)
        // is decided by holdProb above — NOT gated on being perfectly body-behind-the-ball,
        // which made even good keepers spill routine saves they were a hair off-line for.
        const catchable = !nearPostThreat && Math.max(0, zAtLine) < 1.7;
        if (looseGather || (catchable && this.rng.next() < holdProb)) {
          // catch: keeper gathers it, faces upfield, ball held safely in hand
          const up = this.attackSign(gk.team);
          ball.ownerIdx = gk.idx;
          gk.facing = up > 0 ? 0 : Math.PI;
          // gather the ball INTO his hands (at his own y), not wherever it crossed — a ball
          // caught at full stretch must end up with him, never sitting off to one side.
          ball.pos.x = clamp(gk.pos.x + up * 0.5, -HALF_LEN + 0.4, HALF_LEN - 0.4);
          ball.pos.y = clamp(gk.pos.y, -HALF_WID + 0.5, HALF_WID - 0.5);
          ball.vel = { x: 0, y: 0 };
          ball.vz = 0; ball.z = 0; ball.spin = 0;
          ball.lastTouchTeam = gk.team;
          this.beginGkHold(gk);
        } else if (stretch > 0.42 && Math.abs(yAtLine) > GOAL_HALF_WIDTH - 2.6) {
          // a stretching fingertip save on a corner-bound shot — tipped round the post. Start
          // it at his reach, just OUTSIDE the post (so it can never sneak in for a goal), and
          // give it real pace so it visibly ROLLS over the line for a corner rather than just
          // teleporting behind the goal.
          const postSide = Math.sign(yAtLine || 1);
          ball.ownerIdx = -1;
          ball.pos.x = sideSign * (HALF_LEN - 0.4);
          ball.pos.y = postSide * (GOAL_HALF_WIDTH + 0.2);
          ball.z = clamp(Math.max(zAtLine, 0.15), 0.15, 1.2);
          ball.vel.x = sideSign * this.rng.range(2.2, 3.8); // carry it over the line
          ball.vel.y = postSide * this.rng.range(1.6, 3.2); // drifting further wide
          ball.vz = this.rng.range(0.3, 0.8);
          ball.spin = 0;
          ball.lastTouchTeam = gk.team;
          ball.lastKicker = gk.idx;
        } else {
          // parried out — the rebound depends on where it struck him (height at the line):
          // off his legs it's blocked back out, off his chest it drops in front, off his
          // hands it's tipped up and away.
          gk.pos.y = clamp(yAtLine, -GOAL_HALF_WIDTH - 1, GOAL_HALF_WIDTH + 1);
          this.spillRebound(gk, -sideSign, zAtLine, yAtLine || 1);
        }
        this.registerSave(gk);
      } else if (Math.abs(yAtLine) > GOAL_HALF_WIDTH || zAtLine > GOAL_HEIGHT) {
        this.emit({ type: 'nearMiss' });
        st.excitement = Math.min(1, st.excitement + 0.2);
      }
    }
  }

  private goalkeeperRushShotBlock(
    gk: SimPlayer,
    sideSign: number,
    goalX: number,
    tToLine: number,
    yAtLine: number,
    zAtLine: number,
    speed: number,
    keepingAttr: number,
    keepingQuality: number,
  ): boolean {
    const ball = this.state.ball;
    if (!this.shotLive || gk.diving || ball.ownerIdx !== -1 || speed < 6) return false;
    const offLine = Math.abs(gk.pos.x - goalX) > 3.2;
    if (!offLine) return false;
    const betweenBallAndGoal = (gk.pos.x - ball.pos.x) * sideSign > -0.45
      && (goalX - gk.pos.x) * sideSign > -0.8;
    if (!betweenBallAndGoal) return false;

    const pathWindow = Math.min(tToLine, 0.45);
    const speedSq = Math.max(0.001, speed * speed);
    const rawT = ((gk.pos.x - ball.pos.x) * ball.vel.x + (gk.pos.y - ball.pos.y) * ball.vel.y) / speedSq;
    const tToKeeper = clamp(rawT, 0, pathWindow);
    const closest = {
      x: ball.pos.x + ball.vel.x * tToKeeper,
      y: ball.pos.y + ball.vel.y * tToKeeper,
    };
    const pathD = dist(gk.pos, closest);
    const zAtKeeper = ball.z + ball.vz * tToKeeper + 0.5 * GRAVITY * tToKeeper * tToKeeper;
    const onTarget = Math.abs(yAtLine) <= GOAL_HALF_WIDTH + 0.55 && zAtLine <= GOAL_HEIGHT + 0.45;
    const rushReach = 1.45 + keepingAttr * 0.018;
    // This branch is for a keeper spreading himself in front of a shot, not for
    // pre-solving the save from a projected path. Wait until the ball is close
    // enough to make the block read as body contact on screen.
    const currentBallDist = dist(gk.pos, ball.pos);
    if (rawT > 0.075 && currentBallDist > 2.4) return false;
    if (!onTarget || pathD > rushReach || zAtKeeper > GOAL_HEIGHT + 0.65) return false;

    const toTargetX = closest.x - gk.pos.x;
    const toTargetY = closest.y - gk.pos.y;
    const toTargetD = len(toTargetX, toTargetY) || 1;
    const spreadSpeed = 6.2 + keepingAttr * 0.038;
    gk.slideTimer = Math.max(gk.slideTimer, 0.68);
    gk.diving = true;
    // a rushed-out spread, not a lateral line dive — the renderer slides him out at the
    // attacker (legs trailing) instead of laying him on his side with a running cycle
    gk.diveKind = 'spread';
    gk.diveSide = (Math.sign(-sideSign * (closest.y - gk.pos.y)) || 1) as -1 | 1;
    gk.anim = 'dive';
    gk.facing = Math.atan2(ball.pos.y - gk.pos.y, ball.pos.x - gk.pos.x);
    gk.vel.x = (toTargetX / toTargetD) * spreadSpeed;
    gk.vel.y = (toTargetY / toTargetD) * spreadSpeed;

    const hard = clamp(speed / 34, 0, 1);
    const stretch = clamp(pathD / Math.max(0.01, rushReach), 0, 1.35);
    const bodyBlock = pathD < PLAYER_RADIUS + BALL_RADIUS + 0.55;
    const saveProb = clamp(
      (0.42 + keepingQuality * 0.46)
        * (1.08 - hard * 0.22)
        * (1.16 - stretch * 0.45),
      0.16,
      0.88,
    );
    if (!bodyBlock && this.rng.next() >= saveProb) {
      gk.diveBeaten = true;
      return true;
    }

    const upfield = this.attackSign(gk.team);
    const wide = Math.sign(yAtLine || ball.pos.y || this.rng.range(-1, 1) || 1);
    if (bodyBlock) {
      // he got his BODY to it — collapse on the ball and GATHER it at his chest, rather
      // than letting it squirt several metres into the box ("the ball miles away from him").
      ball.ownerIdx = gk.idx;
      ball.pos.x = clamp(gk.pos.x + upfield * 0.4, -HALF_LEN + 0.4, HALF_LEN - 0.4);
      ball.pos.y = clamp(gk.pos.y, -HALF_WID + 0.4, HALF_WID - 0.4);
      ball.vel.x = 0;
      ball.vel.y = 0;
      ball.vz = 0;
      ball.z = 0;
      ball.spin = 0;
      ball.lastTouchTeam = gk.team;
      ball.lastKicker = gk.idx;
      this.beginGkHold(gk);
    } else {
      // a fingertip/leg block at full stretch spills loose — the rebound is contextual to
      // where it struck him (the ball's height at the keeper): legs block it back out, body
      // drops it in front, hands tip it up and away.
      ball.ownerIdx = -1;
      ball.pos.x = clamp(gk.pos.x + upfield * (PLAYER_RADIUS + BALL_RADIUS + 0.35), -HALF_LEN + 0.4, HALF_LEN - 0.4);
      ball.pos.y = clamp(gk.pos.y + wide * 0.48, -HALF_WID + 0.4, HALF_WID - 0.4);
      this.spillRebound(gk, upfield, zAtKeeper, wide);
    }
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;
    this.registerSave(gk);
    return true;
  }

  private goalkeeperCloseDown(): boolean {
    const st = this.state;
    if (st.phase !== 'play') return false;
    const owner = this.owner();
    if (!owner || owner.isGK || st.ball.z > 0.8) return false;
    const gk = st.players.find((p) => p.team !== owner.team && p.isGK && !p.sentOff);
    if (!gk) return false;
    if (gk.diving) return false;
    const dir = this.attackSign(gk.team);
    const ownGoalX = -dir * HALF_LEN;
    const keepingAttr = this.effectiveAttr(gk, 'keeping');
    const keeping = clamp(keepingAttr / 100, 0, 1);
    const ownerD = dist(gk.pos, owner.pos);
    const ballD = dist(gk.pos, st.ball.pos);
    const ballAtFeet = dist(owner.pos, st.ball.pos) < 1.35;
    const ownerSpeed = len(owner.vel.x, owner.vel.y);
    const closingGoal = (owner.vel.x * (ownGoalX - owner.pos.x)) > 0.45;
    const toGoalSign = Math.sign(ownGoalX - owner.pos.x) || -dir;
    const keeperGoalSide = (gk.pos.x - owner.pos.x) * toGoalSign >= -0.12;
    const keeperBallSide = (gk.pos.x - st.ball.pos.x) * toGoalSign >= -0.18;
    const sixYardDanger = Math.abs(owner.pos.x - ownGoalX) < 7.2 + keeping * 3.9
      && Math.abs(owner.pos.y) < 8.8 + keeping * 3.4;
    const centralOneOnOne = keeping >= 0.62
      && ballAtFeet
      && keeperGoalSide
      && keeperBallSide
      && ownerSpeed > 1.15
      && closingGoal
      && Math.abs(owner.pos.x - ownGoalX) < 10.5 + keeping * 2.8
      && Math.abs(owner.pos.y) < GOAL_HALF_WIDTH + 5.2 + keeping * 2.2
      && ownerD < 4.2 + keeping * 1.6
      && ballD < 4.5 + keeping * 1.6;
    if (!sixYardDanger && !centralOneOnOne) return false;
    const reach = 1.15 + keeping * 0.55;
    const lungeReach = centralOneOnOne ? 3.8 + keeping * 2.0 : 3.0 + keeping * 1.85;
    const atFeet = ownerD <= reach && ballD <= reach + 0.2;
    const canLunge = ballAtFeet && ownerD <= lungeReach && ballD <= lungeReach + 0.35;
    if (!atFeet && !canLunge) return false;
    if (!keeperGoalSide || !keeperBallSide) return false;

    const upfield = dir;
    // lunge at the BALL itself (not at the man) at a pace that actually covers the
    // gap within the slide window — so he arrives ON it instead of the ball being
    // teleported to him.
    const toBallX = st.ball.pos.x - gk.pos.x;
    const toBallY = st.ball.pos.y - gk.pos.y;
    const toBallD = len(toBallX, toBallY) || 1;
    const smotherSpeed = clamp(toBallD / 0.42, 5.4 + keepingAttr * 0.042, 12.5);
    gk.slideTimer = Math.max(gk.slideTimer, 0.55);
    gk.diving = true;
    gk.diveSide = 0;
    gk.diveKind = 'smother';
    gk.anim = 'smother';
    gk.facing = Math.atan2(toBallY, toBallX);
    gk.vel.x = (toBallX / toBallD) * smotherSpeed;
    gk.vel.y = (toBallY / toBallD) * smotherSpeed;
    owner.kickCooldown = Math.max(owner.kickCooldown, 0.5);
    this.livePassTargetIdx = -1;
    this.livePassTargetUntil = -1;

    if (atFeet) {
      // already on the ball — he collapses on it and gathers it to his body now.
      st.ball.ownerIdx = gk.idx;
      st.ball.pos.x = clamp(gk.pos.x + upfield * 0.4, -HALF_LEN + 0.4, HALF_LEN - 0.4);
      st.ball.pos.y = clamp(gk.pos.y, -HALF_WID + 0.4, HALF_WID - 0.4);
      st.ball.vel.x = 0;
      st.ball.vel.y = 0;
      st.ball.vz = 0;
      st.ball.z = 0;
      st.ball.spin = 0;
      st.ball.lastTouchTeam = gk.team;
      st.ball.lastKicker = gk.idx;
      this.beginGkHold(gk);
      this.registerSave(gk);
      return true;
    }
    // lunging from a step or two away: knock it off the attacker and TOWARD the keeper,
    // so it rolls to him (out of the attacker's reach) and he gathers it as he sprawls in
    // to meet it. No teleport — the ball travels — and the attacker can't simply re-collect
    // it at his own feet. integrateBall hands the diving keeper the ball on contact.
    const tkx = gk.pos.x - st.ball.pos.x;
    const tky = gk.pos.y - st.ball.pos.y;
    const tkd = len(tkx, tky) || 1;
    const knock = clamp(tkd / 0.32, 4.5, 11);
    st.ball.ownerIdx = -1;
    st.ball.lastTouchTeam = gk.team;
    st.ball.lastKicker = gk.idx;
    this.lastTurnover = { tick: st.tick, team: gk.team };
    st.ball.vel.x = (tkx / tkd) * knock;
    st.ball.vel.y = (tky / tkd) * knock;
    st.ball.vz = 0;
    st.ball.spin = 0;
    this.registerSave(gk);
    return true;
  }

  // ------------------------------------------------------------- restarts

  private findTaker(team: 0 | 1): SimPlayer | null {
    const st = this.state;
    if (st.phase === 'goalKick') {
      return st.players.find((p) => p.team === team && p.isGK && !p.sentOff) ?? null;
    }
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const p of st.players) {
      // a player still on the ground (just fouled) can't get up to take it — a
      // team-mate steps over the ball instead
      if (p.team !== team || p.isGK || p.sentOff || (p.downTimer && p.downTimer > 0)) continue;
      const d = dist(p.pos, st.restartPos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** once the taker is set at the spot, face the play and adopt the right stance */
  private applyRestartTakerPose() {
    const st = this.state;
    const taker = this.findTaker(st.restartTeam);
    if (!taker) return;
    const spot = this.restartTakerSpot();
    if (dist(taker.pos, spot) > 2.5) return;
    let target: Vec2;
    if (st.phase === 'throwIn') {
      target = { x: st.restartPos.x, y: st.restartPos.y * 0.2 }; // square on, facing the pitch
    } else {
      // every kicking restart: face the ball (the taker stands behind it)
      target = st.restartPos;
    }
    if (dist(taker.pos, target) > 0.25) {
      taker.facing = Math.atan2(target.y - taker.pos.y, target.x - taker.pos.x);
    }
    if (len(taker.vel.x, taker.vel.y) < 0.6) {
      taker.anim = st.phase === 'throwIn' ? 'throw' : 'idle';
    }
  }

  private moveTakerToBall() {
    const st = this.state;
    const taker = this.findTaker(st.restartTeam);
    if (!taker) return;
    const spot = this.restartTakerSpot();
    const d = dist(taker.pos, spot);
    if (d > 1.0 && st.restartTimer <= 0.5) {
      // snap if dawdling; throwers stand beyond the touchline, other restarts
      // stand just inside the pitch.
      taker.pos = { ...spot };
      taker.vel = { x: 0, y: 0 };
    }
    // at a penalty, every player except the kicker and the two keepers must be
    // OUTSIDE the box and BEHIND the penalty mark (laws of the game). The old
    // code kept opponents on a 9.2m ring around the spot while preserving their
    // angle, which pinned any goal-side defender at ~1.8m from the goal line —
    // a man stood beside the post as the kick was taken. Clear everyone straight
    // back behind the box edge instead so the area is empty bar the keeper.
    if (st.phase === 'penaltyKick') {
      const atkDir = this.attackSign(st.restartTeam);
      const taker = this.findTaker(st.restartTeam);
      // just outside the box AND at least 9.15m behind the mark
      const clearProg = Math.min(HALF_LEN - PENALTY_BOX_DEPTH - 1.5, HALF_LEN - PENALTY_SPOT - 9.2);
      for (const p of st.players) {
        if (p.sentOff) continue;
        if (p.isGK) {
          p.pos.x = -this.attackSign(p.team) * (HALF_LEN - 0.9);
          p.pos.y = 0;
          p.vel.x = 0;
          p.vel.y = 0;
          continue;
        }
        if (p === taker) continue;
        // a just-fouled player lies where he fell — don't drag him out of the box
        // while he's on the ground (he clears out himself once he's back up). Without
        // this the victim teleports to the box edge mid-fall, so the foul never reads
        // as "he went down here" and a downed body slides across to the line.
        if (p.downTimer && p.downTimer > 0) continue;
        if (p.pos.x * atkDir > clearProg) {
          p.pos.x = atkDir * clearProg;
          p.vel.x = 0;
          p.vel.y = 0;
        }
      }
      return;
    }
    // opponents keep distance (a player on the ground stays put — he's not shoved
    // off the spot mid-fall)
    for (const p of st.players) {
      if (p.team === st.restartTeam || (p.downTimer && p.downTimer > 0)) continue;
      const dd = dist(p.pos, st.restartPos);
      const minDist = 5;
      if (dd < minDist) {
        const a = Math.atan2(p.pos.y - st.restartPos.y, p.pos.x - st.restartPos.x);
        p.pos.x = st.restartPos.x + Math.cos(a) * minDist;
        p.pos.y = st.restartPos.y + Math.sin(a) * minDist;
      }
    }
    // teammates don't pile onto the taker — only one man stands over the ball.
    // Without this, support runners and stragglers would walk into the taker and
    // get jammed against him (he holds the spot, so the collision never resolves).
    {
      const clearR = 3.6;
      for (const p of st.players) {
        if (p.team !== st.restartTeam || p === taker || p.isGK || p.sentOff
          || (p.downTimer && p.downTimer > 0)) continue;
        const ddx = p.pos.x - taker.pos.x;
        const ddy = p.pos.y - taker.pos.y;
        const d = Math.hypot(ddx, ddy);
        if (d < clearR) {
          const a = d > 0.05 ? Math.atan2(ddy, ddx) : (p.idx % 2 ? 0.9 : -0.9);
          p.pos.x = taker.pos.x + Math.cos(a) * clearR;
          p.pos.y = taker.pos.y + Math.sin(a) * clearR;
        }
      }
    }
  }

  private restartTakerSpot(): Vec2 {
    const st = this.state;
    if (st.phase === 'throwIn') {
      const side = Math.sign(st.restartPos.y || 1);
      return {
        x: clamp(st.restartPos.x, -HALF_LEN + 1, HALF_LEN - 1),
        y: side * (HALF_WID + 0.8),
      };
    }
    if (st.phase === 'corner') {
      const sideX = Math.sign(st.restartPos.x || 1);
      const sideY = Math.sign(st.restartPos.y || 1);
      return {
        x: sideX * (HALF_LEN + 0.8),
        y: sideY * (HALF_WID + 0.8),
      };
    }
    if (st.phase === 'penaltyKick') {
      const dir = this.attackSign(st.restartTeam);
      return {
        x: clamp(st.restartPos.x - dir * 1.4, -HALF_LEN + 1, HALF_LEN - 1),
        y: 0,
      };
    }
    if (st.phase === 'kickoff') {
      const dir = this.attackSign(st.restartTeam);
      return {
        x: -dir * 0.85,
        y: 0.35,
      };
    }
    const dir = this.attackSign(st.restartTeam);
    return {
      x: clamp(st.restartPos.x - dir * 1.25, -HALF_LEN + 1, HALF_LEN - 1),
      y: clamp(st.restartPos.y * 0.97, -HALF_WID + 0.5, HALF_WID - 0.5),
    };
  }

  private attackingRestartTarget(p: SimPlayer): Vec2 | null {
    const st = this.state;
    const taker = this.findTaker(st.restartTeam);
    if (!taker || p === taker || p.team !== st.restartTeam || p.isGK || p.sentOff) return null;
    const dir = this.attackSign(st.restartTeam);
    const mates = st.players
      .filter((q) => q.team === st.restartTeam && !q.isGK && !q.sentOff && q !== taker)
      .sort((a, b) => {
        const roleA = a.attrs.pos === 'FW' ? 0 : a.attrs.pos === 'MF' ? 1 : 2;
        const roleB = b.attrs.pos === 'FW' ? 0 : b.attrs.pos === 'MF' ? 1 : 2;
        return roleA - roleB || a.idx - b.idx;
      });
    const idx = Math.max(0, mates.indexOf(p));

    if (st.phase === 'throwIn') {
      const side = Math.sign(st.restartPos.y || 1);
      const patterns = [
        { dx: -4, dy: -5.2 },
        { dx: 5.5, dy: -7.2 },
        { dx: 11.5, dy: -10.5 },
        { dx: -10, dy: -9.2 },
        { dx: 17, dy: -14 },
        { dx: 2, dy: -16 },
      ];
      const pat = patterns[idx % patterns.length];
      return {
        x: clamp(st.restartPos.x + dir * pat.dx, -HALF_LEN + 3, HALF_LEN - 3),
        y: clamp(side * (HALF_WID + pat.dy), -HALF_WID + 3, HALF_WID - 3),
      };
    }

    if (st.phase === 'corner') {
      const goalX = dir * HALF_LEN;
      const patterns = [
        { x: goalX - dir * 6.2, y: -5.5 },
        { x: goalX - dir * 8.8, y: 0 },
        { x: goalX - dir * 11.5, y: 5.5 },
        { x: goalX - dir * 19.5, y: -8.5 },
        { x: goalX - dir * 22, y: 8.5 },
        { x: goalX - dir * 15, y: 12 },
      ];
      const pat = patterns[idx % patterns.length];
      return { x: clamp(pat.x, -HALF_LEN + 2, HALF_LEN - 2), y: clamp(pat.y, -HALF_WID + 4, HALF_WID - 4) };
    }

    if (st.phase === 'freeKick') {
      const distanceToGoal = HALF_LEN - st.restartPos.x * dir;
      const inShootingRange = this.isFreeKickShootingRange(st.restartTeam, st.restartPos);
      const patterns = inShootingRange
        ? [
            { dx: -5, dy: -6 },
            { dx: 7, dy: 5 },
            { dx: distanceToGoal - 10, dy: -8 },
            { dx: distanceToGoal - 12, dy: 3 },
            { dx: 18, dy: 12 },
          ]
        : [
            { dx: -6, dy: -5 },
            { dx: 8, dy: 4 },
            { dx: 17, dy: -7 },
            { dx: 25, dy: 5 },
            { dx: 12, dy: 12 },
          ];
      const pat = patterns[idx % patterns.length];
      return {
        x: clamp(st.restartPos.x + dir * pat.dx, -HALF_LEN + 3, HALF_LEN - 3),
        y: clamp(st.restartPos.y + pat.dy, -HALF_WID + 4, HALF_WID - 4),
      };
    }

    return null;
  }

  private maybeTakeRestart(inputs: [PadInput, PadInput]) {
    const st = this.state;
    if (st.restartTimer > 0) return;
    // a kick won by a foul waits for the felled player to pick himself up — you can't
    // take the free kick or penalty while he's still on the floor mid-get-up
    if ((st.phase === 'freeKick' || st.phase === 'penaltyKick')
      && st.players.some((p) => p.downTimer && p.downTimer > 0)) return;
    const team = st.restartTeam;
    const taker = this.findTaker(team);
    if (!taker) return;
    if (dist(taker.pos, st.restartPos) > 2.5) return; // walking over
    const human = this.cfg.teams[team].controller !== 'ai';
    const inp = inputs[team];
    const prev = this.prevInputs[team];
    const h = this.humans[team];
    const passEdge = inp.pass && !prev.pass;
    const shootEdge = inp.shoot && !prev.shoot;
    const passIntent = human ? inp.pass : false;
    const shootIntent = human ? inp.shoot : false;
    const waited = (this.restartWaitTicks += 1) > (human ? 60 * 8 : Math.round(this.rng.range(30, 60)));

    if (!human && !waited) return;

    // corners, throws and free kicks charge on hold: tap = flat/driven,
    // longer press = lofted delivery
    const chargedPhase = st.phase === 'corner' || st.phase === 'throwIn' || st.phase === 'freeKick' || st.phase === 'goalKick';
    let heldSec = 0;
    let chargeBtn: 'pass' | 'shoot' | null = null;
    if (human && chargedPhase) {
      if (h.restartChargeBtn === null) {
        if (passEdge) { h.restartChargeBtn = 'pass'; h.restartChargeSince = st.tick; return; }
        if (shootEdge) { h.restartChargeBtn = 'shoot'; h.restartChargeSince = st.tick; return; }
        // button already held before the spot was ready: instant tap take
        if (inp.pass) { chargeBtn = 'pass'; }
        else if (inp.shoot) { chargeBtn = 'shoot'; }
        else if (!waited) return;
      } else {
        const stillHeld = h.restartChargeBtn === 'pass' ? inp.pass : inp.shoot;
        heldSec = (st.tick - h.restartChargeSince) * DT;
        if (stillHeld && heldSec < 1.0 && !waited) return; // charging
        chargeBtn = h.restartChargeBtn;
        h.restartChargeBtn = null;
        h.restartChargeSince = -1;
      }
    } else if (human && !passIntent && !shootIntent && !passEdge && !shootEdge && !waited) {
      return;
    }
    this.restartWaitTicks = 0;
    const lofted = heldSec >= 0.18;
    let armedCurl = false;

    const phase = st.phase;
    st.phase = 'play';
    st.ball.pos = { ...st.restartPos };

    if (phase === 'penaltyKick') {
      const dir = this.attackSign(team);
      const aimY = human && Math.abs(inp.moveY) > 0.1
        ? clamp(inp.moveY * GOAL_HALF_WIDTH * 0.92, -GOAL_HALF_WIDTH * 0.94, GOAL_HALF_WIDTH * 0.94)
        : this.rng.pick([-0.92, -0.74, -0.56, 0.56, 0.74, 0.92]) * GOAL_HALF_WIDTH;
      const power = human && passIntent ? 21.5 : this.rng.range(22, 25);
      this.kickBall(taker, { x: dir * HALF_LEN, y: aimY }, power, 0.12);
      this.shotLive = true;
      // the keeper picks a corner and goes — he cannot read the ball mid-flight,
      // otherwise every penalty gets saved
      this.penaltyDiveGuess = this.rng.pick([-1, -1, 0, 1, 1]);
      this.emit({ type: 'shot', team, power: power / 30 });
      st.excitement = Math.min(1, st.excitement + 0.35);
    } else if (phase === 'corner') {
      const sideX = Math.sign(st.restartPos.x);
      const boxMate = this.crossTargetInBox(taker);
      const stickY = human ? clamp(inp.moveY * 8, -9, 9) : this.rng.range(-5, 5);
      const target = boxMate
        ? this.passAimForReceiver(taker, boxMate, lofted)
        : { x: sideX * (HALF_LEN - (lofted ? PENALTY_SPOT : 8)), y: stickY };
      if (human && chargeBtn === 'pass' && !lofted && inp.moveX === 0 && inp.moveY === 0) {
        // tap with a neutral stick: short corner to the nearest teammate
        const opt = this.restartPassOption(taker, false);
        const d = dist(taker.pos, opt?.aim ?? target);
        this.kickBall(taker, opt ? opt.aim : target, clamp(14 + d * 0.58, 16, 25), 0.08, opt?.targetIdx ?? -1, false);
        this.emitPass(taker, opt?.targetIdx ?? -1, 0.4);
      } else if (human && !lofted) {
        // driven corner, flat and quick to the near post
        this.kickBall(taker, target, 25, 0.12, boxMate?.idx ?? -1, false);
        this.emitPass(taker, boxMate?.idx ?? -1, 0.6);
        this.triggerBoxRuns(team, taker.idx, taker.pos.y || st.restartPos.y);
      } else {
        // lofted corner, hangs for headers; AI deliveries carry a mid charge so
        // they apex inside the headable band rather than dying at chest height
        const lift = human ? heldSec : 0.55;
        this.kickBall(taker, target, clamp(19 + lift * 5, 19, 25), clamp(0.78 + lift * 0.2, 0.78, 0.98), boxMate?.idx ?? -1, false);
        this.emitPass(taker, boxMate?.idx ?? -1, 0.5);
        this.triggerBoxRuns(team, taker.idx, taker.pos.y || st.restartPos.y);
      }
    } else if (phase === 'goalKick') {
      const gkDir = this.attackSign(taker.team);
      if (human) {
        if (chargeBtn === 'shoot') {
          this.kickGoalkeeperLong(taker, inp, true, false);
        } else if (chargeBtn === 'pass' && lofted) {
          this.kickGoalkeeperLong(taker, inp, false, false);
        } else {
          // pass tap: a short/medium restart in the aimed direction. Holding pass
          // or pressing shoot uses the long-ball helper above to clear the press.
          let dx = inp.moveX, dy = inp.moveY;
          const mag = Math.hypot(dx, dy);
          const reach = mag > 0.15 ? 22 : 30;
          let aimX: number, aimY: number;
          if (mag > 0.15) {
            dx /= mag; dy /= mag;
            aimX = taker.pos.x + dx * reach;
            aimY = taker.pos.y + dy * reach;
          } else {
            aimX = taker.pos.x + gkDir * reach;
            aimY = taker.pos.y * 0.5;
          }
          // lock onto a teammate down the aimed line so the kick is directed to a
          // player with a skill/fatigue margin of error, like any other pass
          const mate = this.teammateInCone(taker, Math.atan2(aimY - taker.pos.y, aimX - taker.pos.x), Math.PI / 2.6, 34);
          let targetIdx = -1;
          if (mate) { aimX = mate.pos.x; aimY = mate.pos.y; targetIdx = mate.idx; }
          aimX = clamp(aimX, -HALF_LEN + 3, HALF_LEN - 3);
          aimY = clamp(aimY, -HALF_WID + 4, HALF_WID - 4);
          const loft = 0.3;
          const d = Math.min(dist(taker.pos, { x: aimX, y: aimY }), 34);
          const speed = targetIdx >= 0 ? this.speedForReach(d, loft) : this.speedForStop(d, loft);
          this.kickBall(taker, { x: aimX, y: aimY }, speed, loft, targetIdx, false);
          this.emitPass(taker, targetIdx, 0.55);
        }
      } else {
        const opt = this.bestPassOption(taker, true);
        if (opt) {
          const recv = st.players[opt.targetIdx];
          const d = Math.min(recv ? dist(taker.pos, recv.pos) : 40, MAX_LONG_KICK_RANGE);
          this.kickBall(taker, opt.aim, this.speedForReach(d, 0.55), 0.55, opt.targetIdx, false);
        } else {
          const aimX = clamp(taker.pos.x + gkDir * MAX_LONG_KICK_RANGE, -HALF_LEN + 3, HALF_LEN - 3);
          this.kickBall(taker, { x: aimX, y: this.rng.range(-18, 18) }, this.speedForStop(MAX_LONG_KICK_RANGE, 0.55), 0.55, -1, false);
        }
        this.emitPass(taker, opt?.targetIdx ?? -1, 0.85);
      }
    } else if (phase === 'throwIn') {
      const opt = this.restartPassOption(taker, false);
      const reachMul = lofted ? 1.6 : 1;
      const aimDir = human && (inp.moveX || inp.moveY)
        ? { x: taker.pos.x + inp.moveX * 14 * reachMul, y: taker.pos.y + inp.moveY * 14 * reachMul }
        : (opt?.aim ?? { x: taker.pos.x + this.attackSign(team) * 8 * reachMul, y: taker.pos.y * 0.8 });
      // always throw towards the field of play, never along/over the line
      aimDir.x = clamp(aimDir.x, -HALF_LEN + 3, HALF_LEN - 3);
      aimDir.y = clamp(aimDir.y, -HALF_WID + 4, HALF_WID - 4);
      const d = dist(taker.pos, aimDir);
      // tap: quick flat throw to feet; hold: long looping throw downfield
      this.kickBall(
        taker,
        aimDir,
        lofted ? clamp(16 + heldSec * 7, 17, 25) : clamp(14 + d * 0.55, 16, 22),
        lofted ? 0.3 : 0.07,
        human && (inp.moveX || inp.moveY) ? -1 : opt?.targetIdx ?? -1,
        false,
      );
      this.emitPass(taker, human && (inp.moveX || inp.moveY) ? -1 : opt?.targetIdx ?? -1, 0.4);
      st.ball.z = 1.66;
      // it left the hands, not the boot
      taker.anim = 'throw';
      taker.actionTimer = 0.4;
    } else if (phase === 'freeKick') {
      const canShoot = this.isFreeKickShootingRange(team, st.restartPos);
      const aiShoots = !human && canShoot && (Math.abs(st.restartPos.y) < 18 || this.rng.next() < 0.55);
      if (canShoot && (chargeBtn === 'shoot' || aiShoots)) {
        this.takeFreeKickShot(taker, human ? inp : NULL_INPUT, heldSec);
        if (human) {
          this.humans[team].aftertouchUntil = st.tick + Math.round(0.5 / DT);
          armedCurl = true;
        }
      } else if (human && chargeBtn === 'shoot') {
        // out of range: lofted ball dropped onto a box runner, not a blind launch
        const dir = this.attackSign(team);
        const mate = this.crossTargetInBox(taker);
        const aim = mate
          ? this.passAimForReceiver(taker, mate, true)
          : { x: dir * (HALF_LEN - PENALTY_SPOT), y: clamp(inp.moveY * 9, -10, 10) };
        aim.x = clamp(aim.x, -HALF_LEN + 3, HALF_LEN - 3);
        aim.y = clamp(aim.y, -HALF_WID + 3, HALF_WID - 3);
        const d = Math.min(dist(taker.pos, aim), MAX_LONG_KICK_RANGE);
        this.kickBall(taker, aim, this.speedForReach(d, 0.7), 0.7, mate?.idx ?? -1);
        this.emitPass(taker, mate?.idx ?? -1, 0.6);
        this.triggerBoxRuns(team, taker.idx, taker.pos.y || st.restartPos.y);
      } else if (human && lofted) {
        // held pass: hanging delivery aimed at a team-mate (box runner first,
        // then whoever is down the stick ray), not just an area
        const dir = this.attackSign(team);
        let mate: SimPlayer | null = null;
        if (inp.moveX || inp.moveY) {
          mate = this.teammateInCone(taker, Math.atan2(inp.moveY, inp.moveX), Math.PI / 2.1, 60);
        }
        if (!mate) mate = this.crossTargetInBox(taker);
        const aim = mate
          ? this.passAimForReceiver(taker, mate, true)
          : (inp.moveX || inp.moveY)
            ? { x: taker.pos.x + inp.moveX * 26, y: taker.pos.y + inp.moveY * 26 }
            : { x: dir * (HALF_LEN - PENALTY_SPOT), y: clamp(taker.pos.y * 0.3, -10, 10) };
        aim.x = clamp(aim.x, -HALF_LEN + 3, HALF_LEN - 3);
        aim.y = clamp(aim.y, -HALF_WID + 3, HALF_WID - 3);
        const d = Math.min(dist(taker.pos, aim), MAX_LONG_KICK_RANGE);
        // a hanging delivery that still drops onto the man rather than flying past
        this.kickBall(taker, aim, this.speedForReach(d, 0.74), 0.74, mate?.idx ?? -1);
        this.emitPass(taker, mate?.idx ?? -1, 0.5);
        this.triggerBoxRuns(team, taker.idx, taker.pos.y || st.restartPos.y);
      } else {
        // tap pass: a human aiming the stick drives the ball down the ARROW,
        // locking onto a team-mate along that ray (like goal kicks / throw-ins).
        // A neutral stick falls back to the best available short option.
        let aim: Vec2;
        let targetIdx: number;
        if (human && (inp.moveX || inp.moveY)) {
          const mag = Math.hypot(inp.moveX, inp.moveY) || 1;
          const ang = Math.atan2(inp.moveY, inp.moveX);
          const mate = this.teammateInCone(taker, ang, Math.PI / 2.6, 48);
          if (mate) { aim = { ...mate.pos }; targetIdx = mate.idx; }
          else { aim = { x: taker.pos.x + (inp.moveX / mag) * 24, y: taker.pos.y + (inp.moveY / mag) * 24 }; targetIdx = -1; }
          aim.x = clamp(aim.x, -HALF_LEN + 3, HALF_LEN - 3);
          aim.y = clamp(aim.y, -HALF_WID + 3, HALF_WID - 3);
        } else {
          const opt = this.restartPassOption(taker, false);
          aim = opt?.aim ?? { x: taker.pos.x + this.attackSign(team) * 16, y: taker.pos.y };
          targetIdx = opt?.targetIdx ?? -1;
        }
        const d = dist(taker.pos, aim);
        const loft = d > 30 ? 0.34 : 0.06;
        const speed = loft > 0.2
          ? this.speedForReach(Math.min(d, MAX_LONG_KICK_RANGE), loft)
          : clamp(14 + d * 0.6, 16.5, 27);
        this.kickBall(taker, aim, speed, loft, targetIdx);
        this.emitPass(taker, targetIdx, 0.4);
      }
    } else {
      const kickoff = this.chooseKickoffPass(taker, human ? inp : NULL_INPUT);
      const d = dist(taker.pos, kickoff.aim);
      this.kickBall(taker, kickoff.aim, clamp(16 + d * 0.62, 19.5, 26), 0, kickoff.targetIdx, false);
      this.emitPass(taker, kickoff.targetIdx, 0.4);
    }
    this.emit({ type: 'kick', team, power: 0.4 });
    if (human && !armedCurl) this.humans[team].aftertouchUntil = -1;
  }

  private isFreeKickShootingRange(team: 0 | 1, pos: Vec2): boolean {
    const dir = this.attackSign(team);
    const distanceToGoal = HALF_LEN - pos.x * dir;
    return distanceToGoal <= 32 && distanceToGoal > 7 && Math.abs(pos.y) < 26;
  }

  private restartPassOption(taker: SimPlayer, longOnly: boolean): { aim: Vec2; score: number; targetIdx: number } | null {
    const openPlay = this.bestPassOption(taker, longOnly);
    if (openPlay) return openPlay;
    const dir = this.attackSign(taker.team);
    const maxRange = longOnly ? 58 : 42;
    let best: { aim: Vec2; score: number; targetIdx: number } | null = null;
    for (const q of this.state.players) {
      if (q.team !== taker.team || q === taker || q.isGK || q.sentOff) continue;
      if (this.isOffsideTarget(taker, q)) continue;
      const d = dist(taker.pos, q.pos);
      if (d < 3 || d > maxRange) continue;
      const forward = (q.pos.x - taker.pos.x) * dir;
      const central = 1 - Math.min(1, Math.abs(q.pos.y) / HALF_WID);
      const role = q.attrs.pos === 'MF' ? 1.2 : q.attrs.pos === 'FW' ? 0.8 : 0.2;
      const score = -Math.abs(d - 14) * 0.12 + forward * 0.04 + central * 0.5 + role;
      if (!best || score > best.score) {
        best = { aim: this.passAimForReceiver(taker, q, longOnly), score, targetIdx: q.idx };
      }
    }
    return best;
  }

  private takeFreeKickShot(taker: SimPlayer, inp: PadInput, heldSec = 0) {
    const st = this.state;
    const dir = this.attackSign(taker.team);
    const distanceToGoal = HALF_LEN - st.restartPos.x * dir;
    const aimY = Math.abs(inp.moveY) > 0.1
      ? clamp(inp.moveY * GOAL_HALF_WIDTH * 0.92, -GOAL_HALF_WIDTH * 0.94, GOAL_HALF_WIDTH * 0.94)
      : clamp(-st.restartPos.y * 0.16 + this.rng.range(-1.1, 1.1), -GOAL_HALF_WIDTH, GOAL_HALF_WIDTH);
    const power = clamp(20.8 + heldSec * 1.1 + distanceToGoal * 0.06 + taker.attrs.shoot * 0.018, 22, 25.4);
    const tGoal = distanceToGoal / Math.max(1, power);
    const tWall = 9.15 / Math.max(1, power);
    const skill = clamp(taker.attrs.shoot / 100, 0, 1);
    const targetZ = 1.35 + skill * 0.58 + clamp((distanceToGoal - 18) / 16, 0, 1) * 0.32;
    const idealVz = (targetZ - 0.5 * GRAVITY * tGoal * tGoal) / Math.max(0.01, tGoal);
    const wallVz = (1.78 - 0.5 * GRAVITY * tWall * tWall) / Math.max(0.01, tWall);
    const launchVz = Math.max(idealVz, wallVz);
    const loft = clamp(launchVz / Math.max(0.01, power * 0.45), 0.5, 0.72);
    this.kickBall(taker, { x: dir * HALF_LEN, y: aimY }, power, loft, -1, false);
    this.shotLive = true;
    this.emit({ type: 'shot', team: taker.team, power: power / 30 });
    st.excitement = Math.min(1, st.excitement + 0.32);
  }

  private freeKickWallTarget(p: SimPlayer): Vec2 | null {
    const st = this.state;
    if (st.phase !== 'freeKick' || p.team === st.restartTeam) return null;
    if (!this.isFreeKickShootingRange(st.restartTeam, st.restartPos)) return null;
    const wall = this.freeKickWallPlayers(p.team);
    const idx = wall.findIndex((q) => q.idx === p.idx);
    if (idx < 0) return null;

    const dir = this.attackSign(st.restartTeam);
    const toGoal = { x: dir * HALF_LEN - st.restartPos.x, y: -st.restartPos.y };
    const d = len(toGoal.x, toGoal.y) || 1;
    const nx = toGoal.x / d;
    const ny = toGoal.y / d;
    const lateral = { x: -ny, y: nx };
    const offset = (idx - (wall.length - 1) / 2) * 0.78;
    const wallDist = 9.15;
    return {
      x: clamp(st.restartPos.x + nx * wallDist + lateral.x * offset, -HALF_LEN + 1, HALF_LEN - 1),
      y: clamp(st.restartPos.y + ny * wallDist + lateral.y * offset, -HALF_WID + 1, HALF_WID - 1),
    };
  }

  private freeKickWallPlayers(team: 0 | 1): SimPlayer[] {
    const rp = this.state.restartPos;
    // membership + order are fixed for the duration of one dead ball, otherwise
    // the wall re-sorts by live distance every frame and the players visibly
    // jitter sideways as their order swaps while they walk into the wall
    const cache = this.wallCache;
    if (!cache || cache.team !== team || Math.abs(cache.posX - rp.x) > 0.1 || Math.abs(cache.posY - rp.y) > 0.1) {
      const order = this.state.players
        .filter((p) => p.team === team && !p.isGK && !p.sentOff)
        .sort((a, b) => {
          const roleA = a.attrs.pos === 'DF' ? 0 : a.attrs.pos === 'MF' ? 1 : 2;
          const roleB = b.attrs.pos === 'DF' ? 0 : b.attrs.pos === 'MF' ? 1 : 2;
          return roleA - roleB
            || dist(a.pos, rp) - dist(b.pos, rp)
            || a.idx - b.idx;
        })
        .slice(0, 5)
        .map((p) => p.idx);
      this.wallCache = { posX: rp.x, posY: rp.y, team, order };
    }
    return this.wallCache!.order.map((idx) => this.state.players[idx]).filter((p) => p && !p.sentOff);
  }

  private chooseKickoffPass(taker: SimPlayer, inp: PadInput): { aim: Vec2; targetIdx: number } {
    const dir = this.attackSign(taker.team);
    const side = Math.abs(inp.moveY) > 0.15
      ? Math.sign(inp.moveY)
      : (this.rng.next() < 0.5 ? -1 : 1);
    const candidates = this.state.players
      .filter((p) => p.team === taker.team && p !== taker && !p.isGK && !p.sentOff)
      .filter((p) => p.pos.x * dir <= -0.2)
      .map((p) => {
        const d = dist(p.pos, taker.pos);
        const sideScore = Math.sign(p.pos.y || side) === side ? 8 : -4;
        const backScore = clamp((taker.pos.x - p.pos.x) * dir, -4, 8);
        const widthScore = clamp(Math.abs(p.pos.y) * 0.15, 0, 2.5);
        const distancePenalty = Math.abs(d - 12) * 0.35;
        return { p, score: sideScore + backScore + widthScore - distancePenalty };
      })
      .sort((a, b) => b.score - a.score);
    const target = candidates[0]?.p ?? null;
    if (!target) return { aim: { x: -dir * 8, y: side * 8 }, targetIdx: -1 };
    return {
      aim: {
        x: target.pos.x - dir * 0.8,
        y: target.pos.y + side * 0.7,
      },
      targetIdx: target.idx,
    };
  }

  // --------------------------------------------------------- human control

  private handleHumanKicks(inputs: [PadInput, PadInput]) {
    const st = this.state;
    for (let t = 0 as 0 | 1; t <= 1; t++) {
      if (this.cfg.teams[t].controller === 'ai') continue;
      const inp = inputs[t];
      const prev = this.prevInputs[t];
      const h = this.humans[t];
      const ballOwner = this.owner();
      const passDown = inp.pass && !prev.pass;
      const passUp = !inp.pass && prev.pass;
      const shootDown = inp.shoot && !prev.shoot;
      const shootUp = !inp.shoot && prev.shoot;

      // your keeper holds a caught ball: the usual buttons release it with
      // the same mechanics as outfield passes — tap pass throws short to a free
      // defender, hold pass launches long, shoot clears immediately.
      if (ballOwner && ballOwner.team === t && ballOwner.isGK && st.ball.held) {
        if (shootDown) {
          h.passHeldSince = -1;
          this.gkBigKick(ballOwner, inp);
        } else if (passDown) {
          h.passHeldSince = st.tick;
        } else if (passUp && h.passHeldSince >= 0) {
          const held = (st.tick - h.passHeldSince) * DT;
          h.passHeldSince = -1;
          if (held >= 0.18) {
            this.kickGoalkeeperLong(ballOwner, inp, false);
          } else {
            this.gkDistribute(ballOwner, 'short');
          }
        }
        continue;
      }

      const ctl = st.players[st.controlledIdx[t]];
      if (!ctl) continue;
      const hasBall = st.ball.ownerIdx === ctl.idx;
      // near-ball kicks work on free balls and as poke-tackles on rival dribblers,
      // but never steal a ball held by the goalkeeper
      const ballHeight = st.ball.z;
      const nearBall = dist(ctl.pos, st.ball.pos) < CONTROL_RADIUS * 1.4 && ballHeight < AERIAL_REACH_Z
        && (!ballOwner || ballOwner.idx === ctl.idx || (ballOwner.team !== t && !ballOwner.isGK));

      if (passDown && (hasBall || nearBall)) {
        h.passHeldSince = st.tick;
        // off the ball, pass switches player instead (updateControlledIndices)
      }

      if (passUp && h.passHeldSince >= 0) {
        const held = (st.tick - h.passHeldSince) * DT;
        h.passHeldSince = -1;
        if (st.ball.ownerIdx === ctl.idx || dist(ctl.pos, st.ball.pos) < CONTROL_RADIUS * 1.5) {
          if (this.maybeCallPendingOffside(ctl)) {
            h.passTargetIdx = -1;
            continue;
          }
          const aerial = held >= 0.18;
          const zNow = st.ball.z;
          const dir = this.attackSign(t);

          // headed / volleyed first-touch passes when the ball is in the air
          if (zNow >= 0.9) {
            if (zNow >= AERIAL_REACH_Z) continue; // sailing overhead — nobody can reach it
            const headed = zNow >= HEADER_MIN_Z;
            const assistedAir = this.assistedPassTarget(ctl, inp, false);
            const aimAir = assistedAir?.aim
              ?? { x: ctl.pos.x + Math.cos(ctl.facing) * 12, y: ctl.pos.y + Math.sin(ctl.facing) * 12 };
            const dAir = dist(ctl.pos, aimAir);
            this.kickBall(ctl, aimAir, clamp((headed ? 10 : 13) + dAir * 0.45, 11, headed ? 17 : 21), headed ? 0.18 : 0.12, assistedAir?.targetIdx ?? -1);
            if (headed) { ctl.anim = 'header'; ctl.actionTimer = 0.55; }
            h.passTargetIdx = assistedAir?.targetIdx ?? -1;
            h.aftertouchUntil = -1;
            this.emitPass(ctl, assistedAir?.targetIdx ?? -1, 0.5);
            this.emit(headed ? { type: 'header', team: t } : { type: 'kick', team: t, power: 0.5 });
            continue;
          }

          // wide in the final third: the pass button whips in a cross
          const inCrossZone = ctl.pos.x * dir > HALF_LEN - 34
            && Math.abs(ctl.pos.y) > PENALTY_BOX_HALF_WIDTH - 1;
          const stickAngle = (inp.moveX || inp.moveY) ? Math.atan2(inp.moveY, inp.moveX) : ctl.facing;
          const stickBackward = Math.cos(stickAngle) * dir < -0.35;
          if (inCrossZone && !stickBackward) {
            const boxMate = this.crossTargetInBox(ctl);
            const lofted = aerial;
            const fallbackAim = lofted
              ? { x: dir * (HALF_LEN - PENALTY_SPOT), y: clamp(inp.moveY * 8 - Math.sign(ctl.pos.y) * 3, -9, 9) }
              : { x: dir * (HALF_LEN - 7.5), y: clamp(inp.moveY * 6 - Math.sign(ctl.pos.y) * 4, -8, 8) };
            const aimCross = boxMate ? this.passAimForReceiver(ctl, boxMate, lofted) : fallbackAim;
            const dCross = dist(ctl.pos, aimCross);
            // dipping cross pitched to drop onto the target (pace solved from the
            // physics), not a hot moon-ball that flies over everyone's head
            const crossLoft = lofted ? clamp(0.5 + dCross * 0.006, 0.48, 0.64) : 0.12;
            const crossSpeed = lofted
              ? clamp(this.speedForReach(dCross, crossLoft), 13, 25)
              : clamp(21 + dCross * 0.18, 22, 26);
            this.kickBall(ctl, aimCross, crossSpeed, crossLoft, boxMate?.idx ?? -1);
            h.passTargetIdx = boxMate?.idx ?? -1;
            // a cross is run onto, not curled — no aftertouch (steering it to meet the
            // ball would otherwise bend the cross away), and hand control to the man in
            // the box so the stick runs HIM onto it
            h.aftertouchUntil = -1;
            if (boxMate) this.handControlToReceiver(t, boxMate.idx);
            this.triggerBoxRuns(t, ctl.idx, ctl.pos.y);
            this.emitPass(ctl, boxMate?.idx ?? -1, 0.6);
            this.emit({ type: 'kick', team: t, power: 0.65 });
            continue;
          }

          const assisted = this.assistedPassTarget(ctl, inp, aerial);
          let aim = assisted?.aim ?? null;
          let targetIdx = assisted?.targetIdx ?? -1;
          if (!aim) aim = { x: ctl.pos.x + Math.cos(ctl.facing) * 14, y: ctl.pos.y + Math.sin(ctl.facing) * 14 };
          const d = dist(ctl.pos, aim);
          const passSpeed = aerial
            ? clamp(17 + d * 0.68, 19, 30.5)
            : targetIdx >= 0
              ? clamp(13.5 + d * 0.62, 15, 27.5)
              : clamp(12 + d * 0.55, 12.5, 24);
          this.kickBall(
            ctl,
            aim,
            passSpeed,
            aerial ? 0.66 : 0.03,
            targetIdx,
          );
          h.passTargetIdx = targetIdx;
          // a forward through-ball (lofted or driven into space ahead) is run onto, not
          // curled — kill the aftertouch so steering a man onto it doesn't bend it away.
          // A square/back lofted pass keeps the brief aftertouch; ground passes never had it.
          const throughBall = targetIdx >= 0 && (aim.x - ctl.pos.x) * dir > 4;
          h.aftertouchUntil = aerial && !throughBall ? st.tick + Math.round(0.28 / DT) : -1;
          if (throughBall) this.handControlToReceiver(t, targetIdx);
          this.emitPass(ctl, targetIdx, 0.5);
          this.emit({ type: 'kick', team: t, power: 0.5 });
        }
      }

      if (shootDown) {
        const oppControlsBall = (!!ballOwner && ballOwner.team !== t)
          || (st.ball.z < 1.1 && !hasBall
            && st.players.some((q) => q.team !== t && !q.sentOff && !q.isGK && dist(q.pos, st.ball.pos) < 1.15));
        if ((hasBall || nearBall) && !oppControlsBall) h.shootHeldSince = st.tick;
        else {
          // slide tackle
          const a = (inp.moveX || inp.moveY) ? Math.atan2(inp.moveY, inp.moveX) : ctl.facing;
          ctl.slideTimer = (0.34 + (1 - ctl.attrs.tackle / 100) * 0.5) * this.wfx.slide;
          ctl.vel.x = Math.cos(a) * 9.5;
          ctl.vel.y = Math.sin(a) * 9.5;
          ctl.facing = a;
        }
      }
      if (shootUp && h.shootHeldSince >= 0) {
        const held = (st.tick - h.shootHeldSince) * DT;
        h.shootHeldSince = -1;
        if (st.ball.ownerIdx === ctl.idx || dist(ctl.pos, st.ball.pos) < CONTROL_RADIUS * 1.5) {
          if (this.maybeCallPendingOffside(ctl)) continue;
          const zNow = st.ball.z;
          if (zNow >= AERIAL_REACH_Z) continue; // sailing overhead — nobody can reach it
          if (zNow >= 0.9) {
            // first-time header or volley
            const headed = zNow >= HEADER_MIN_Z;
            const dirA = this.attackSign(t);
            const goalA = { x: dirA * HALF_LEN, y: 0 };
            const dGoalA = dist(ctl.pos, goalA);
            const aFaceA = (inp.moveX || inp.moveY) ? Math.atan2(inp.moveY, inp.moveX) : ctl.facing;
            const aGoalA = Math.atan2(goalA.y - ctl.pos.y, goalA.x - ctl.pos.x);
            const atGoal = Math.abs(angleDiff(aFaceA, aGoalA)) < Math.PI / 2.6 && dGoalA < (headed ? 26 : 32);
            if (atGoal) {
              const powerAir = headed
                ? clamp(13 + held * 9 + ctl.attrs.shoot * 0.045, 13, 22)
                : clamp(18 + held * 14 + ctl.attrs.shoot * 0.06, 18, 30);
              const aimYAir = this.applyShotSkillToAimY(ctl, clamp((inp.moveY || 0) * GOAL_HALF_WIDTH, -GOAL_HALF_WIDTH, GOAL_HALF_WIDTH), dGoalA, this.nearestOpponentDist(ctl));
              this.kickBall(ctl, { x: goalA.x, y: aimYAir }, powerAir, headed ? 0.02 : 0.1);
              if (headed) { ctl.anim = 'header'; ctl.actionTimer = 0.55; }
              this.shotLive = true;
              this.emit(headed ? { type: 'header', team: t } : { type: 'kick', team: t, power: 0.9 });
              this.emit({ type: 'shot', team: t, power: powerAir / 30 });
              st.excitement = Math.min(1, st.excitement + 0.3);
            } else {
              // defensive header / volleyed clearance in the facing direction
              const aimClear = { x: ctl.pos.x + Math.cos(aFaceA) * 24, y: ctl.pos.y + Math.sin(aFaceA) * 24 };
              this.kickBall(ctl, aimClear, headed ? 15 : 19, headed ? 0.32 : 0.2);
              if (headed) { ctl.anim = 'header'; ctl.actionTimer = 0.55; }
              this.emit(headed ? { type: 'header', team: t } : { type: 'kick', team: t, power: 0.7 });
            }
            h.aftertouchUntil = -1;
            continue;
          }
          // higher ceiling + hold multiplier so a charged shot really travels
          const power = clamp(19.5 + held * 38 + ctl.attrs.shoot * 0.07, 20, 42);
          const dir = this.attackSign(t);
          const goal = { x: dir * HALF_LEN, y: 0 };
          // shoot toward goal when roughly facing it, otherwise launch a long ball / clearance
          const aFace = (inp.moveX || inp.moveY) ? Math.atan2(inp.moveY, inp.moveX) : ctl.facing;
          const aGoal = Math.atan2(goal.y - ctl.pos.y, goal.x - ctl.pos.x);
          const useGoal = Math.abs(angleDiff(aFace, aGoal)) < Math.PI / 3 && dist(ctl.pos, goal) < 36;
          if (useGoal) {
            const intendedAimY = clamp((inp.moveY || 0) * GOAL_HALF_WIDTH * 1.04, -GOAL_HALF_WIDTH * 1.04, GOAL_HALF_WIDTH * 1.04);
            const aimY = this.applyShotSkillToAimY(ctl, intendedAimY, dist(ctl.pos, goal), this.nearestOpponentDist(ctl));
            this.kickBall(ctl, { x: goal.x, y: aimY }, power, 0.16 + held * 0.25);
            this.shotLive = true;
            this.emit({ type: 'shot', team: t, power: power / 30 });
          } else {
            // not a shot on goal: a directed long ball / clearance. Lock onto a
            // teammate down the aimed line — same skill/fatigue margin of error as
            // any pass — and cap the range so it doesn't fly the whole pitch
            const loft = clamp(0.42 + held * 0.3, 0.42, 0.72);
            const mate = this.teammateInCone(ctl, aFace, Math.PI / 2.2, MAX_LONG_KICK_RANGE);
            const aimLong = mate
              ? { x: mate.pos.x, y: mate.pos.y }
              : { x: ctl.pos.x + Math.cos(aFace) * MAX_LONG_KICK_RANGE, y: ctl.pos.y + Math.sin(aFace) * MAX_LONG_KICK_RANGE };
            aimLong.x = clamp(aimLong.x, -HALF_LEN + 2, HALF_LEN - 2);
            aimLong.y = clamp(aimLong.y, -HALF_WID + 2, HALF_WID - 2);
            const d = Math.min(dist(ctl.pos, aimLong), MAX_LONG_KICK_RANGE);
            const speed = mate ? this.speedForReach(d, loft) : this.speedForStop(d, loft);
            this.kickBall(ctl, aimLong, speed, loft, mate?.idx ?? -1);
            this.shotLive = false;
            this.emit({ type: 'kick', team: t, power: speed / 40 });
          }
          h.aftertouchUntil = st.tick + Math.round(0.5 / DT);
          st.excitement = Math.min(1, st.excitement + 0.3);
        }
      }
      if (inp.shoot && h.shootHeldSince >= 0 && (st.tick - h.shootHeldSince) * DT > 1.0) {
        // auto-release at max power
        const fake = { ...inp, shoot: false };
        const fakePrev = { ...inp, shoot: true };
        this.prevInputs[t] = fakePrev;
        // handled next tick naturally; just cap here by forcing release
        inputs[t] = fake;
      }
    }
  }

  /** send the most advanced teammates attacking the posts and the spot */
  private triggerBoxRuns(team: 0 | 1, excludeIdx: number, crossSide = 0) {
    const st = this.state;
    const dir = this.attackSign(team);
    const side = Math.sign(crossSide || 1);
    const targets = [
      { x: dir * (HALF_LEN - 7.2), y: side * 6.1 }, // near post
      { x: dir * (HALF_LEN - 5.4), y: -side * 6.4 }, // far post
      { x: dir * (HALF_LEN - PENALTY_SPOT), y: 0 }, // spot
    ];
    const runners = st.players
      .filter((p) => p.team === team && !p.isGK && !p.sentOff && p.idx !== excludeIdx)
      .filter((p) => p.attrs.pos === 'FW' || p.attrs.pos === 'MF')
      .sort((a, b) => b.pos.x * dir - a.pos.x * dir)
      .slice(0, 3);
    runners.forEach((p, i) => {
      this.forwardRuns.set(p.idx, {
        until: st.tick + Math.round(1.8 / DT),
        target: targets[i % targets.length],
      });
    });
  }

  /** the most dangerous teammate inside the box, for crosses */
  private crossTargetInBox(crosser: SimPlayer): SimPlayer | null {
    const dir = this.attackSign(crosser.team);
    let best: SimPlayer | null = null;
    let bestScore = -Infinity;
    for (const q of this.state.players) {
      if (q.team !== crosser.team || q === crosser || q.isGK || q.sentOff) continue;
      const prog = q.pos.x * dir;
      if (this.isOffsideTarget(crosser, q)) continue;
      if (prog < HALF_LEN - 20 || Math.abs(q.pos.y) > 17) continue;
      const crosserSide = Math.sign(crosser.pos.y || 1);
      const farPost = Math.sign(q.pos.y || q.slot.y || 0) === -crosserSide;
      const score = prog - Math.abs(q.pos.y) * 0.34
        + (q.attrs.pos === 'FW' ? 2.6 : q.attrs.pos === 'MF' ? 0.8 : 0)
        + q.attrs.shoot * 0.025
        + (farPost ? 0.55 : 0);
      if (score > bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  private teammateInCone(p: SimPlayer, angle: number, cone: number, maxRange = 42): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestScore = -Infinity;
    for (const q of this.state.players) {
      if (q.team !== p.team || q === p || q.sentOff) continue;
      const d = dist(p.pos, q.pos);
      if (d < 2 || d > maxRange) continue;
      const a = Math.atan2(q.pos.y - p.pos.y, q.pos.x - p.pos.x);
      const off = Math.abs(angleDiff(a, angle));
      if (off > cone) continue;
      const score = -off * 8 - d * 0.06;
      if (score > bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  private assistedPassTarget(p: SimPlayer, inp: PadInput, aerial: boolean): PassChoice | null {
    const stick = len(inp.moveX, inp.moveY);
    if (stick > 0.18) {
      const angle = Math.atan2(inp.moveY, inp.moveX);
      const cand = this.teammateInCone(p, angle, aerial ? Math.PI / 2 : Math.PI / 2.15, aerial ? 62 : 42);
      if (cand) {
        return { aim: this.passAimForReceiver(p, cand, aerial), targetIdx: cand.idx, aerial };
      }
      if (aerial) {
        // a long ball to nobody is a turnover — sweep a wider arc first
        const wide = this.teammateInCone(p, angle, Math.PI / 1.5, 62);
        if (wide) return { aim: this.passAimForReceiver(p, wide, true), targetIdx: wide.idx, aerial };
      }
      const rawAim = { x: p.pos.x + Math.cos(angle) * (aerial ? 42 : 18), y: p.pos.y + Math.sin(angle) * (aerial ? 42 : 18) };
      const nudge = this.aimlessPassNudge(p, angle, rawAim, aerial);
      if (nudge) return nudge;
      return { aim: rawAim, targetIdx: -1, aerial };
    }
    if (!aerial) {
      const short = this.shortPassOption(p);
      if (short) return { aim: short.aim, targetIdx: short.targetIdx, aerial };
    }
    const opt = this.bestPassOption(p, aerial);
    if (opt) return { aim: opt.aim, targetIdx: opt.targetIdx, aerial };
    let nearest: SimPlayer | null = null;
    let nd = Infinity;
    for (const q of this.state.players) {
      if (q.team !== p.team || q === p || q.isGK || q.sentOff) continue;
      const d = dist(p.pos, q.pos);
      if (d < nd) { nd = d; nearest = q; }
    }
    if (!nearest) return null;
    return { aim: this.passAimForReceiver(p, nearest, aerial), targetIdx: nearest.idx, aerial };
  }

  private aimlessPassNudge(p: SimPlayer, angle: number, rawAim: Vec2, aerial: boolean): PassChoice | null {
    const normalCone = aerial ? Math.PI / 2 : Math.PI / 2.15;
    const wideCone = aerial ? Math.PI / 1.35 : Math.PI / 1.55;
    const maxRange = aerial ? 62 : 34;
    let best: SimPlayer | null = null;
    let bestScore = -Infinity;
    for (const q of this.state.players) {
      if (q.team !== p.team || q === p || q.isGK || q.sentOff) continue;
      const d = dist(p.pos, q.pos);
      if (d < 4 || d > maxRange) continue;
      const a = Math.atan2(q.pos.y - p.pos.y, q.pos.x - p.pos.x);
      const off = Math.abs(angleDiff(a, angle));
      if (off <= normalCone || off > wideCone) continue;
      const score = -off * 7 - d * 0.05 + (q.attrs.pos === 'MF' ? 0.4 : q.attrs.pos === 'FW' ? 0.2 : 0);
      if (score > bestScore) { bestScore = score; best = q; }
    }
    if (!best) return null;
    const assistedAim = this.passAimForReceiver(p, best, aerial);
    const assist = aerial ? 0.42 : 0.48;
    return {
      aim: {
        x: rawAim.x * (1 - assist) + assistedAim.x * assist,
        y: rawAim.y * (1 - assist) + assistedAim.y * assist,
      },
      targetIdx: best.idx,
      aerial,
    };
  }

  /** Apply a substitution. `force` mirrors a peer's already-validated sub across
   *  the net (the originating side enforced phase + cap), skipping those gates so
   *  the two sides never diverge on a timing race; the validity checks below
   *  (player exists, not already on, GK↔GK) always run. */
  substitute(team: 0 | 1, offPlayerIdx: number, onSquadIdx: number, force = false): boolean {
    const st = this.state;
    if (st.phase === 'finished' || st.phase === 'fullTime') return false;
    if (!force) {
      // Subs are only allowed during a stoppage — never in open play or mid-penalty.
      if (!isBreakPhase(st.phase)) return false;
      if (st.substitutionsUsed[team] >= this.maxSubstitutions()) return false;
    }
    const off = st.players[offPlayerIdx];
    if (!off || off.team !== team) return false;
    const incoming = this.cfg.teams[team].data.players[onSquadIdx];
    if (!incoming) return false;
    if (st.players.some((p) => p.team === team && p.squadIdx === onSquadIdx)) return false;
    // a player who has already been subbed off can never come back on
    if (st.subbedOff[team].includes(onSquadIdx)) return false;
    if ((incoming.pos === 'GK') !== off.isGK) return false;
    const lineupSlot = this.cfg.teams[team].lineup.starters.indexOf(off.squadIdx);
    const offSquadIdx = off.squadIdx;
    if (!off.isGK) {
      const opp = (1 - team) as 0 | 1;
      const overall = (a: { pace: number; pass: number; shoot: number; tackle: number }) =>
        a.pace + a.pass + a.shoot + a.tackle;
      const outfield = st.players
        .filter((p) => p.team === team && !p.isGK && !p.sentOff)
        .map((p) => overall(p.attrs));
      const loss = substitutionMomentumLoss(
        overall(off.attrs), outfield,
        st.score[team] - st.score[opp], this.matchMinute(),
      );
      if (loss < 0) this.applyMomentum(team, { self: loss, opp: 0 });
    }
    off.attrs = incoming;
    off.squadIdx = onSquadIdx;
    off.isGK = incoming.pos === 'GK';
    off.stamina = 1;
    off.staminaCeiling = 1; // fresh legs off the bench
    off.kickCooldown = 0;
    off.slideTimer = 0;
    if (lineupSlot >= 0) this.cfg.teams[team].lineup.starters[lineupSlot] = onSquadIdx;
    st.subbedOff[team].push(offSquadIdx);
    st.subbedOn[team].push(onSquadIdx);
    st.substitutionsUsed[team]++;
    return true;
  }

  /** At a break, replace each injured-off player: sub a like-for-like bench player if one is
   * available, else take him off (man down) — and if he was the keeper with no GK sub, move
   * the best emergency outfielder into goal. Runs for AI and user teams alike; the user's
   * voluntary choice is handled separately in the match-runner, but this guarantees the game
   * never proceeds with a player frozen on the turf. */
  private resolveInjuredOff(): void {
    const st = this.state;
    if (!isBreakPhase(st.phase)) return;
    for (const team of [0, 1] as const) {
      const injured = st.players.find((p) => p.team === team && p.injuredOff);
      if (!injured) continue;
      const squad = this.cfg.teams[team].data.players;
      const onSquad = new Set(st.players.filter((p) => p.team === team).map((p) => p.squadIdx));
      const wantGK = injured.isGK;
      const bench = squad.map((_, i) => i).filter((i) =>
        (squad[i].pos === 'GK') === wantGK
        && !onSquad.has(i)
        && !st.subbedOff[team].includes(i)
        && !st.subbedOn[team].includes(i));
      const canSub = st.substitutionsUsed[team] < this.maxSubstitutions() && bench.length > 0;
      if (canSub) {
        const overall = (i: number) => squad[i].pace + squad[i].pass + squad[i].shoot + squad[i].tackle;
        const on = bench.reduce((a, b) => (overall(b) > overall(a) ? b : a));
        injured.injuredOff = false;        // substitute() reuses this SimPlayer slot for the incoming player
        this.substitute(team, injured.idx, on);
      } else {
        // no replacement: he leaves the pitch (man down)
        injured.injuredOff = false;
        injured.sentOff = true;
        if (this.redCardMinute[team] < 0) {
          this.redCardMinute[team] = this.matchMinute(); // backs-to-the-wall: man down for any reason
          this.redCardRewardBlock[team] = 0;
        }
        // an injured keeper with no GK sub: move the best emergency outfielder into goal
        if (wantGK) {
          injured.isGK = false; // he's off injured; the makeshift outfielder is now the only keeper
          const outfield = st.players.filter((p) => p.team === team && !p.isGK && !p.sentOff);
          if (outfield.length) {
            const emergency = outfield.reduce((a, b) => (b.attrs.keeping > a.attrs.keeping ? b : a));
            emergency.isGK = true;
            const goalX = this.attackSign(team) * -HALF_LEN; // own goal line
            emergency.pos = { x: goalX, y: 0 };
          }
        }
      }
    }
  }

  /** The CPU manager makes substitutions: in the second half it pulls off its most tired
   * outfielder for a fresh, like-for-like player off the bench, paced out and capped by the
   * era's sub limit. Subs are only legal in a stoppage, so this runs during breaks. */
  private aiConsiderSubstitutions() {
    const st = this.state;
    if (!isBreakPhase(st.phase) || st.half < 2) return;
    for (const team of [0, 1] as const) {
      if (this.cfg.teams[team].controller !== 'ai') continue;
      if (st.substitutionsUsed[team] >= this.maxSubstitutions()) continue;
      if (st.tick - this.aiLastSubTick[team] < Math.round(22 / DT)) continue; // pace them out
      const onField = st.players.filter((p) => p.team === team && !p.isGK && !p.sentOff);
      if (onField.length < 6) continue; // don't thin out an already short-handed side
      const tired = onField.reduce((a, b) => (b.stamina < a.stamina ? b : a));
      if (tired.stamina > 0.68) continue; // wait until someone is genuinely flagging
      const squad = this.cfg.teams[team].data.players;
      const onSquad = new Set(st.players.filter((p) => p.team === team).map((p) => p.squadIdx));
      const bench = squad
        .map((_, i) => i)
        .filter((i) => squad[i].pos !== 'GK'
          && !onSquad.has(i)
          && !st.subbedOff[team].includes(i)
          && !st.subbedOn[team].includes(i));
      if (!bench.length) continue;
      const overall = (i: number) => squad[i].pace + squad[i].pass + squad[i].shoot + squad[i].tackle;
      const samePos = bench.filter((i) => squad[i].pos === tired.attrs.pos);
      const pool = samePos.length ? samePos : bench;
      const on = pool.reduce((a, b) => (overall(b) > overall(a) ? b : a));
      if (this.substitute(team, tired.idx, on)) this.aiLastSubTick[team] = st.tick;
    }
  }

  /** AI attacks loose airborne balls: defensive headers, attacking headers, volleys */
  private aiAerialPlay() {
    const st = this.state;
    const ball = st.ball;
    // genuine head-height only: a ball bouncing up off the floor is played
    // with the feet, not jumped at
    if (ball.ownerIdx >= 0 || ball.z < HEADER_MIN_Z || ball.z > HEADER_MAX_Z) return;
    if (ball.vz > 0.6) return; // climbing — wait for it to drop, never jump at a rising ball
    for (const p of st.players) {
      if (p.isGK || p.sentOff || p.injuredOff || p.kickCooldown > 0 || p.slideTimer > 0 || (p.downTimer && p.downTimer > 0)) continue;
      if (p.control && this.cfg.teams[p.team].controller !== 'ai') continue; // human decides
      if (dist(p.pos, ball.pos) > 0.85) continue;
      if (this.rng.next() > 0.3) continue; // not every man attacks every frame
      const dir = this.attackSign(p.team);
      const ownDir = this.ownGoalDir(p.team);
      const nearOwnGoal = p.pos.x * ownDir > HALF_LEN - 30;
      const nearTheirGoal = p.pos.x * dir > HALF_LEN - 22;
      if (nearOwnGoal) {
        // defensive header: up and away, towards the flank
        const aim = { x: p.pos.x + dir * 18, y: p.pos.y + Math.sign(p.pos.y || 1) * 10 };
        this.kickBall(p, aim, this.rng.range(13, 16), 0.32);
      } else if (nearTheirGoal && Math.abs(p.pos.y) < 16) {
        // attacking header on goal
        const aimY = this.applyShotSkillToAimY(p, this.rng.range(-GOAL_HALF_WIDTH * 0.8, GOAL_HALF_WIDTH * 0.8), dist(p.pos, { x: dir * HALF_LEN, y: 0 }));
        this.kickBall(p, { x: dir * HALF_LEN, y: aimY }, this.rng.range(13, 17), 0.03);
        this.shotLive = true;
        this.emit({ type: 'shot', team: p.team, power: 0.55 });
        st.excitement = Math.min(1, st.excitement + 0.25);
      } else {
        // nod it on towards the attack
        const aim = { x: p.pos.x + dir * 12, y: p.pos.y + this.rng.range(-5, 5) };
        this.kickBall(p, aim, this.rng.range(11, 14), 0.2);
      }
      this.emit({ type: 'header', team: p.team });
      p.anim = 'header';
      p.actionTimer = 0.55;
      p.kickCooldown = 0.5;
      break;
    }
  }

  private updateAITackles() {
    const st = this.state;
    if (st.phase !== 'play') return;
    const owner = this.owner();
    if (!owner || owner.isGK || st.ball.z > 0.7) return;
    const settleTicks = Math.round(0.22 / DT);
    const justSettled = st.tick - this.lastTurnover.tick < settleTicks;
    for (const p of st.players) {
      if (p.sentOff || p.injuredOff || p.team === owner.team || p.isGK || p.kickCooldown > 0 || p.slideTimer > 0
        || (p.downTimer && p.downTimer > 0)) continue; // a man on the ground can't tackle
      // CPU defenders AND uncontrolled team-mates on a human team defend;
      // only the actively controlled player is left to the human
      if (p.control && this.cfg.teams[p.team].controller !== 'ai') continue;
      // the side that just lost the ball can't snatch it straight back the next
      // frame — a brief settle window stops possession ping-ponging tick to tick
      if (justSettled && p.team !== this.lastTurnover.team) continue;
      const d = dist(p.pos, owner.pos);
      // In his OWN box a defender stays on his feet and shepherds the carrier instead of
      // diving in — a mistimed challenge here is a penalty. Only a tackle right on the ball
      // (very close, low foul risk) is worth it; otherwise he contains and trusts the keeper
      // and cover. This is what stops the CPU conceding a hatful of soft box penalties.
      const ownGoalX = this.ownGoalDir(p.team) * HALF_LEN;
      const inOwnBox = Math.abs(owner.pos.x - ownGoalX) < PENALTY_BOX_DEPTH
        && Math.abs(owner.pos.y) < PENALTY_BOX_HALF_WIDTH;
      if (inOwnBox && d > 0.7) continue;
      if (d > 1.25) {
        // out of standing-tackle range but close: a carrier bursting past
        // gets a slide thrown at the ball rather than a jog in his wake
        if (d < 3.0 && st.ball.z < 0.6) {
          const ownerSpeed = len(owner.vel.x, owner.vel.y);
          const escaping = ownerSpeed > 3.2
            && (owner.pos.x - p.pos.x) * owner.vel.x + (owner.pos.y - p.pos.y) * owner.vel.y > 0;
          const inOwnHalf = owner.pos.x * this.ownGoalDir(p.team) > 0;
          const caution = p.yellowCards > 0 ? 0.4 : 1;
          const tackleAttr = this.effectiveAttr(p, 'tackle');
          const desire = (escaping ? 0.022 : 0.003)
            * (inOwnHalf ? 1.6 : 0.8)
            * (0.55 + (tackleAttr / 100) * 0.7)
            * caution;
          if (this.rng.next() < desire) {
            const aimX = st.ball.pos.x + owner.vel.x * 0.22;
            const aimY = st.ball.pos.y + owner.vel.y * 0.22;
            const a = Math.atan2(aimY - p.pos.y, aimX - p.pos.x);
            p.slideTimer = (0.34 + (1 - tackleAttr / 100) * 0.5) * this.wfx.slide;
            p.vel.x = Math.cos(a) * 9.5;
            p.vel.y = Math.sin(a) * 9.5;
            p.facing = a;
          }
        }
        continue;
      }
      const tackleQuality = this.effectiveAttr(p, 'tackle') / 100;
      const fromBehind = this.isFromBehindTackle(p, owner);
      const ownerProgress = owner.pos.x * this.attackSign(owner.team);
      const immediateDanger = ownerProgress > HALF_LEN - 20 && Math.abs(owner.pos.y) < 22;
      const bookedCaution = p.yellowCards > 0 && !immediateDanger;
      if (bookedCaution && d > 0.72) continue;
      const cautionFactor = bookedCaution ? 0.48 : 1;
      const duelEdge = this.duelScore(p, owner);
      // foul if he reaches through the man rather than the ball — booked players
      // are more careful (cautionFactor), losing the duel makes contact likelier
      const foulChance = this.tackleFoulChance(p, d, fromBehind) * cautionFactor * (1 + Math.max(0, -duelEdge) * 0.4);
      if (d > 0.45 && this.rng.next() < foulChance && !this.refereeWavesOn(owner.team)) {
        this.commitFoul(p, owner, fromBehind ? 0.75 : 0.35);
        return;
      }
      const autoWinDistance = (bookedCaution ? 0.42 : 0.55) + clamp(duelEdge, -0.32, 0.36) * 0.14;
      const tackleChance = clamp((0.45 + tackleQuality * 0.5 + duelEdge * 0.24) * cautionFactor, 0.05, 0.96);
      if (d < autoWinDistance || this.rng.next() < tackleChance) {
        // a poor referee may wrongly penalise a clean tackle — a soft phantom foul
        // (midfield only, never a phantom penalty). The tackler's side is wronged,
        // so they boo and stew rather than treat the free kick as a decision earned.
        if (this.refereePhantomFoul(p.pos)) {
          this.registerGrievance(p.team);
          this.commitFoul(p, owner, 0.3, true);
          return;
        }
        const a = Math.atan2(st.ball.pos.y - p.pos.y, st.ball.pos.x - p.pos.x);
        st.ball.ownerIdx = -1;
        st.ball.vel.x = Math.cos(a) * 8 + p.vel.x * 0.35;
        st.ball.vel.y = Math.sin(a) * 8 + p.vel.y * 0.35;
        st.ball.vz = 0;
        st.ball.z = 0;
        if (st.ball.lastTouchTeam !== p.team) this.lastTurnover = { tick: st.tick, team: p.team };
        st.ball.lastTouchTeam = p.team;
        st.ball.lastKicker = p.idx;
        p.kickCooldown = 0.35;
        owner.kickCooldown = Math.max(owner.kickCooldown, 0.3);
        p.facing = a;
        p.anim = 'tackle';
        p.actionTimer = 0.5;
        this.pendingOffside = null;
        this.emit({ type: 'tackle', team: p.team, player: p.idx });
        return;
      }
    }
  }

  private isFromBehindTackle(tackler: SimPlayer, victim: SimPlayer): boolean {
    const victimSpeed = len(victim.vel.x, victim.vel.y);
    if (victimSpeed < 0.4) return false;
    const vx = victim.vel.x / victimSpeed;
    const vy = victim.vel.y / victimSpeed;
    const tx = tackler.pos.x - victim.pos.x;
    const ty = tackler.pos.y - victim.pos.y;
    return tx * vx + ty * vy < -0.1;
  }

  /**
   * How likely a tackle is whistled as a foul. Driven by how cleanly the
   * challenger actually reaches the ball — a clean nick (right on the ball) is
   * almost never given, while reaching through the man (late, lunging, or from
   * behind) almost always is. This makes fouls read as deserved rather than a
   * coin flip on an identical-looking challenge. `ballDist` is how far the
   * challenger is from the ball at contact.
   */
  private tackleFoulChance(p: SimPlayer, ballDist: number, fromBehind: boolean): number {
    const skill = clamp(this.effectiveAttr(p, 'tackle') / 100, 0, 1);
    const lunge = clamp(len(p.vel.x, p.vel.y) / 11, 0, 1);
    // 0 when he is right on the ball (clean), ramps up as he reaches through it
    const cleanReach = clamp((ballDist - 0.62) / 0.7, 0, 1.4);
    const base = (fromBehind ? 0.16 : 0.025)
      + cleanReach * (fromBehind ? 0.42 : 0.34)
      + lunge * 0.1
      - skill * 0.1;
    return clamp(base, 0.01, fromBehind ? 0.85 : 0.5) * this.refereeFoulMul(p.team, fromBehind);
  }

  /** How this referee scales a foul's likelihood. A lenient ref lets marginal
   * (front/contested) contact go to keep play flowing, while a clear from-behind
   * challenge swings much less; the home side is whistled a touch less than the away. */
  private refereeFoulMul(offenderTeam: 0 | 1, fromBehind: boolean): number {
    const r = this.referee;
    const weight = fromBehind ? 0.3 : 1; // marginal challenges move most with strictness
    const strict = 1 + (r.foulBias - 1) * weight;
    const home = offenderTeam === 0 ? 1 - r.homeBias : 1 + r.homeBias;
    return Math.max(0.25, strict) * home;
  }

  /** A less accurate referee occasionally waves on a clear foul he should have
   * given. When he does, the crowd jeers and the wronged side's grievance grows. */
  private refereeWavesOn(victimTeam: 0 | 1): boolean {
    if (this.refRng.next() >= (1 - this.referee.accuracy) * 0.5) return false;
    this.registerGrievance(victimTeam);
    return true;
  }

  /** ...and occasionally gives a soft phantom foul on a clean challenge — but never
   * in the box (no game-ruining phantom penalties). */
  private refereePhantomFoul(at: Vec2): boolean {
    if (Math.abs(Math.abs(at.x) - HALF_LEN) < PENALTY_BOX_DEPTH + 4) return false;
    return this.refRng.next() < (1 - this.referee.accuracy) * 0.22;
  }

  /** A clearly wrong decision has gone against `team`: the crowd boos and that
   * side's grievance with the referee deepens (capped so it can't run away). */
  private registerGrievance(team: 0 | 1) {
    this.teamGrievance[team] = Math.min(this.teamGrievance[team] + 1, 4);
    this.emit({ type: 'crowdBoo', team });
  }

  /** A decision has correctly gone `team`'s way. If they've been stewing over a
   * run of calls against them, the crowd greets it with sarcastic, ironic
   * applause; either way the grievance is settled. */
  private settleGrievance(team: 0 | 1) {
    if (this.teamGrievance[team] >= 2) this.emit({ type: 'crowdIronic', team });
    this.teamGrievance[team] = 0;
  }

  /** Put a player on the ground after contact — he topples away from the challenge
   * and lies there (anim 'fall') for `duration` seconds before getting up. Used so
   * a foul or a hard tackle reads clearly: someone visibly goes down. */
  private knockDown(p: SimPlayer, by: SimPlayer, duration: number, power = 0.5) {
    if (p.isGK || p.sentOff) return;
    const dx = p.pos.x - by.pos.x;
    const dy = p.pos.y - by.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    // flung away from the challenge — harder the bigger the hit — carrying a little of
    // his own momentum so he's launched in the direction he was already moving + the
    // shove, then skids out (the down block bleeds it off slowly so he slides).
    const push = 1.6 + clamp(power, 0, 1) * 4;
    // does the shove go WITH the way he's facing (clipped from behind → pitches onto his
    // front) or INTO it (a tackle he ran into → toppled backward)?
    p.fallForward = (dx / d) * Math.cos(p.facing) + (dy / d) * Math.sin(p.facing) > 0;
    p.vel.x = p.vel.x * 0.35 + (dx / d) * push;
    p.vel.y = p.vel.y * 0.35 + (dy / d) * push;
    p.downTimer = duration;
    p.fallPower = clamp(power, 0, 1);
    p.anim = 'fall';
    p.slideTimer = 0;
    p.diving = false;
    p.kickCooldown = Math.max(p.kickCooldown, duration);
    // a man going to ground loses the ball
    if (this.state.ball.ownerIdx === p.idx) this.state.ball.ownerIdx = -1;
  }

  private commitFoul(offender: SimPlayer, victim: SimPlayer, severity: number, phantom = false) {
    const st = this.state;
    st.ball.ownerIdx = -1;
    st.ball.vel = { x: 0, y: 0 };
    st.ball.vz = 0;
    st.ball.z = 0;
    const fouledTeam = victim.team;
    offender.foulsCommitted++;
    // the fouled player goes down — a clear, readable signal that a foul happened, the
    // fall scaled to how heavy the challenge was. Down ~2s: the mocap fall lays him
    // out, he holds it a beat, then the get-up clip lifts him (play is stopped anyway).
    this.knockDown(victim, offender, 2.0, clamp((severity - 0.15) / 0.7, 0.3, 1));
    const fromBehind = this.isFromBehindTackle(offender, victim);
    this.applyInjury(victim, rollInjury({ contactSeverity: severity, fromBehind, nonContact: false, rng: () => this.rng.next() }));
    this.emit({ type: 'foul', team: offender.team, player: offender.idx });
    // a genuine decision the fouled side's way settles any grievance they've built
    // up (with sarcastic applause if it had been festering); a phantom call is the
    // referee getting it wrong, so it never counts as their decision earned.
    if (!phantom) this.settleGrievance(fouledTeam);

    const progressToGoal = st.ball.pos.x * this.attackSign(fouledTeam);
    const dangerousPosition = progressToGoal > HALF_LEN - 24 && Math.abs(st.ball.pos.y) < 22;
    // a persistent offender is booked once he's racked up enough fouls
    const repeatWarning = offender.foulsCommitted >= 4 && severity >= 0.4;
    // DOGSO: a foul that denies an obvious goal-scoring chance — the victim was
    // through on goal with only the keeper to beat (no covering defender in the
    // lane) and the offender hauled him down. A straight red. In the box a genuine
    // attempt to play the ball is a yellow + penalty (no triple punishment);
    // a cynical drag-back is still a red.
    const attackGoal = { x: this.attackSign(victim.team) * HALF_LEN, y: 0 };
    const insideBox = Math.abs(victim.pos.x - attackGoal.x) < PENALTY_BOX_DEPTH && Math.abs(victim.pos.y) < PENALTY_BOX_HALF_WIDTH;
    const toGoalLen = dist(victim.pos, attackGoal) || 1;
    const goalwardSpeed = ((attackGoal.x - victim.pos.x) * victim.vel.x + (attackGoal.y - victim.pos.y) * victim.vel.y) / toGoalLen;
    const deniedClearChance = severity >= 0.5               // a real, cynical foul — not a clean clip
      && toGoalLen < 24 && Math.abs(victim.pos.y) < 13       // a genuine chance, central and close-ish
      && goalwardSpeed > 2.8                                 // he was actually running at goal
      && this.isClearScoringChance(victim, attackGoal)       // only the keeper to beat
      && (!insideBox || severity >= 0.66);                   // box DOGSO only if cynical (no triple jeopardy)
    const directRed = severity >= 0.96
      || (severity >= 0.88 && dangerousPosition && progressToGoal > HALF_LEN - 16)
      || deniedClearChance;
    // otherwise most fouls are just a free kick; a booking is for a genuinely
    // reckless or cynical challenge (steep in severity), so cards don't rain
    // down on every clip from behind. A strict referee books more readily; a
    // home-biased one cautions the home side (team 0) less than the away side.
    const cardHomeMul = offender.team === 0 ? 1 - this.referee.homeBias : 1 + this.referee.homeBias;
    const cardChance = clamp(((severity - 0.5) * 0.85 + (dangerousPosition ? 0.1 : 0)) * this.referee.cardBias * cardHomeMul, 0, 0.85);
    const yellow = !directRed && (repeatWarning || this.rng.next() < cardChance);

    if (yellow) {
      offender.yellowCards++;
      this.emit({ type: 'yellowCard', team: offender.team, player: offender.idx });
    }
    if (directRed || offender.yellowCards >= 2) {
      offender.sentOff = true;
      offender.control = false;
      this.emit({ type: 'redCard', team: offender.team, player: offender.idx });
    }

    if (this.isPenaltyFoul(offender, victim, st.ball.pos)) {
      this.awardPenalty(fouledTeam, offender, victim);
    } else {
      this.awardFreeKick(fouledTeam, st.ball.pos, 'foul', offender, victim);
    }
  }

  private awardFreeKick(team: 0 | 1, pos: Vec2, reason: 'foul' | 'offside', offender?: SimPlayer, subject?: SimPlayer) {
    const st = this.state;
    st.phase = 'freeKick';
    st.restartTeam = team;
    st.restartPos = {
      x: clamp(pos.x, -HALF_LEN + 2, HALF_LEN - 2),
      y: clamp(pos.y, -HALF_WID + 2, HALF_WID - 2),
    };
    st.restartTimer = 0.9;
    st.ball.pos = { ...st.restartPos };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.vz = 0;
    st.ball.z = 0;
    st.ball.spin = 0;
    st.ball.ownerIdx = -1;
    this.pendingOffside = null;
    this.restartWaitTicks = 0;
    if (reason === 'offside') this.emit({ type: 'offside', team, player: subject?.idx });
    this.emit({ type: 'whistle', team: offender?.team });
  }

  private isPenaltyFoul(offender: SimPlayer, victim: SimPlayer, pos: Vec2): boolean {
    if (offender.team === victim.team) return false;
    const ownGoalX = -this.attackSign(offender.team) * HALF_LEN;
    return Math.abs(pos.x - ownGoalX) <= 16.5 && Math.abs(pos.y) <= 20.2;
  }

  private awardPenalty(team: 0 | 1, offender?: SimPlayer, subject?: SimPlayer) {
    const st = this.state;
    const dir = this.attackSign(team);
    st.phase = 'penaltyKick';
    st.restartTeam = team;
    st.restartPos = { x: dir * (HALF_LEN - PENALTY_SPOT), y: 0 };
    st.restartTimer = 0.9;
    st.ball.pos = { ...st.restartPos };
    st.ball.vel = { x: 0, y: 0 };
    st.ball.vz = 0;
    st.ball.z = 0;
    st.ball.spin = 0;
    st.ball.ownerIdx = -1;
    this.shotLive = false;
    this.shotLivePrev = false;
    this.shotLiveSince = -1;
    this.penaltyDiveGuess = null;
    this.pendingOffside = null;
    this.restartWaitTicks = 0;
    this.emit({ type: 'penalty', team, player: subject?.idx });
    this.emit({ type: 'whistle', team: offender?.team });
  }

  private isOffsideTarget(passer: SimPlayer, target: SimPlayer): boolean {
    if (target.team !== passer.team || target.isGK || target.sentOff) return false;
    const dir = this.attackSign(passer.team);
    const targetProgress = target.pos.x * dir;
    const ballProgress = this.state.ball.pos.x * dir;
    if (targetProgress <= 0) return false; // only in the attacking half
    if (targetProgress <= ballProgress + 0.5) return false;
    const defenders = this.state.players
      .filter((p) => p.team !== passer.team && !p.sentOff)
      .map((p) => p.pos.x * dir)
      .sort((a, b) => b - a);
    const secondLast = defenders[1] ?? defenders[0] ?? HALF_LEN;
    return targetProgress > Math.max(ballProgress, secondLast) + 0.5;
  }

  // ------------------------------------------------------------- penalties

  private beginPenalties() {
    const st = this.state;
    st.phase = 'penalties';
    st.penalties = {
      shooterTeam: 0,
      round: 0,
      scores: [[], []],
      stage: 'place',
      timer: 1.5,
      aim: 0,
      dive: 0,
      winner: -1,
    };
    // park everyone near the centre circle
    st.players.forEach((p, i) => {
      p.pos = { x: -8 + (i % 11) * 1.6, y: p.team === 0 ? -8 : 8 };
      p.vel = { x: 0, y: 0 };
      p.anim = 'idle';
    });
    this.emit({ type: 'whistle' });
  }

  private stepPenalties(inputs: [PadInput, PadInput]) {
    const st = this.state;
    const pen = st.penalties!;
    const goalX = HALF_LEN;
    const spot = { x: goalX - PENALTY_SPOT, y: 0 };
    const shooterTeam = pen.shooterTeam;
    const keeperTeam = (1 - shooterTeam) as 0 | 1;
    const shooter = st.players.filter((p) => p.team === shooterTeam && !p.isGK)[pen.round % 10];
    const keeper = st.players.find((p) => p.team === keeperTeam && p.isGK)!;
    pen.timer -= DT;

    if (pen.stage === 'place') {
      st.penaltyAim = 0;
      shooter.pos = { x: spot.x - 2.5, y: 0 };
      shooter.facing = 0;
      keeper.pos = { x: goalX - 0.8, y: 0 };
      st.ball.pos = { ...spot };
      st.ball.z = 0; st.ball.vel = { x: 0, y: 0 }; st.ball.vz = 0;
      st.ball.ownerIdx = -1;
      if (pen.timer <= 0) { pen.stage = 'aim'; pen.timer = 2.0; }
      return;
    }
    if (pen.stage === 'aim') {
      // human shooter aims with stick Y; human keeper pre-commits with stick Y
      if (this.cfg.teams[shooterTeam].controller !== 'ai') pen.aim = clamp(inputs[shooterTeam].moveY, -1, 1);
      if (this.cfg.teams[keeperTeam].controller !== 'ai') pen.dive = clamp(inputs[keeperTeam].moveY, -1, 1);
      st.penaltyAim = pen.aim;
      const shootPress = inputs[shooterTeam].shoot && !this.prevInputs[shooterTeam].shoot;
      if (pen.timer <= 0 || (this.cfg.teams[shooterTeam].controller !== 'ai' && shootPress)) {
        if (this.cfg.teams[shooterTeam].controller === 'ai') {
          pen.aim = this.rng.pick([-0.85, -0.5, 0, 0.5, 0.85]);
        }
        if (this.cfg.teams[keeperTeam].controller === 'ai') {
          pen.dive = this.rng.pick([-0.8, 0, 0.8]);
        }
        // strike
        const shotSkill = clamp(this.effectiveAttr(shooter, 'shoot') / 100, 0.42, 0.98);
        const aimPressure = Math.abs(pen.aim);
        const aimY = pen.aim * GOAL_HALF_WIDTH * 0.92;
        const errorWidth = 0.24 + (1 - shotSkill) * 0.95 + aimPressure * 0.26;
        let finalY = aimY + this.rng.range(-errorWidth, errorWidth);
        const pressureMissChance = clamp(0.018 + (1 - shotSkill) * 0.075 + aimPressure * 0.032, 0.018, 0.12);
        let highMiss = false;
        if (this.rng.next() < pressureMissChance) {
          if (this.rng.next() < 0.72) {
            const side = Math.sign(finalY || (this.rng.next() < 0.5 ? -1 : 1));
            finalY = side * this.rng.range(GOAL_HALF_WIDTH * 1.02, GOAL_HALF_WIDTH * 1.16);
          } else {
            highMiss = true;
          }
        }
        finalY = clamp(finalY, -GOAL_HALF_WIDTH * 1.18, GOAL_HALF_WIDTH * 1.18);
        st.ball.vel = { x: 24, y: (finalY / PENALTY_SPOT) * 24 };
        st.ball.vz = highMiss ? this.rng.range(6.8, 7.4) : this.rng.range(1, 4.8);
        keeper.vel.y = pen.dive * 8;
        pen.stage = 'strike';
        pen.timer = 0.9;
        this.emit({ type: 'shot', team: shooterTeam, power: 0.9 });
      }
      return;
    }
    if (pen.stage === 'strike') {
      st.penaltyAim = pen.aim;
      // integrate ball + keeper
      st.ball.pos.x += st.ball.vel.x * DT;
      st.ball.pos.y += st.ball.vel.y * DT;
      st.ball.z = Math.max(0, st.ball.z + st.ball.vz * DT);
      st.ball.vz += GRAVITY * 0.5 * DT;
      keeper.pos.y = clamp(keeper.pos.y + keeper.vel.y * DT, -GOAL_HALF_WIDTH - 0.5, GOAL_HALF_WIDTH + 0.5);
      keeper.diving = true;
      keeper.anim = 'dive';
      if (st.ball.pos.x >= goalX - 0.6) {
        const yAt = st.ball.pos.y;
        const guessedSide = Math.sign(pen.dive || 0.0001) === Math.sign(pen.aim || 0.0001);
        const saved = Math.abs(yAt - keeper.pos.y) < 1.65 && guessedSide || Math.abs(yAt) < 0.95 && Math.abs(pen.dive) < 0.3;
        const wide = Math.abs(yAt) > GOAL_HALF_WIDTH;
        const high = st.ball.z > GOAL_HEIGHT;
        const saveChance = clamp(
          0.72 * this.diff.keeper * (this.effectiveAttr(keeper, 'keeping') / 100) * (1 - Math.min(0.24, Math.abs(pen.aim) * 0.14)),
          0.08,
          0.62,
        );
        const scored = !wide && !high && !(saved && this.rng.next() < saveChance);
        pen.scores[shooterTeam].push(scored ? 1 : 0);
        if (scored) {
          st.score[shooterTeam]++;
          st.goals.push({ team: shooterTeam, player: shooter.attrs.name, minute: this.matchMinute() });
          this.emit({ type: 'penScored', team: shooterTeam });
          this.emit({ type: 'goal', team: shooterTeam });
        } else {
          this.emit({ type: 'penMissed', team: shooterTeam });
          st.ball.vel = { x: -6, y: this.rng.range(-3, 3) };
        }
        pen.stage = 'result';
        pen.timer = 1.6;
      }
      return;
    }
    if (pen.stage === 'result') {
      if (pen.timer > 0) return;
      // decide winner / continue
      const a = pen.scores[0], b = pen.scores[1];
      const sa = a.reduce((s: number, v: number) => s + v, 0);
      const sb = b.reduce((s: number, v: number) => s + v, 0);
      const ka = a.length, kb = b.length;
      let winner: -1 | 0 | 1 = -1;
      if (ka >= 5 || kb >= 5) {
        if (ka === kb && sa !== sb) winner = sa > sb ? 0 : 1;
      }
      if (ka < 5 && kb < 5) {
        // early decision: can't catch up
        const remA = 5 - ka, remB = 5 - kb;
        if (sa > sb + remB) winner = 0;
        if (sb > sa + remA) winner = 1;
      }
      if (winner >= 0) {
        pen.winner = winner;
        pen.stage = 'done';
        st.winner = winner;
        st.phase = 'finished';
        this.emit({ type: 'fullWhistle' });
        this.emit({ type: 'matchEnd' });
        return;
      }
      pen.shooterTeam = (1 - pen.shooterTeam) as 0 | 1;
      if (pen.shooterTeam === 0) pen.round++;
      pen.stage = 'place';
      pen.timer = 1.2;
      pen.aim = 0;
      pen.dive = 0;
      st.penaltyAim = 0;
      return;
    }
  }

  private decayExcitement() {
    const st = this.state;
    const nearBox = Math.abs(st.ball.pos.x) > HALF_LEN - 24 ? 0.12 : 0;
    st.excitement = clamp(st.excitement * (1 - 0.12 * DT) + nearBox * DT, 0.15, 1);
  }
}

const PITCH_FACT = 105;

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function speedFacing(p: SimPlayer): number | null {
  const speed = Math.hypot(p.vel.x, p.vel.y);
  return speed > 0.35 ? Math.atan2(p.vel.y, p.vel.x) : null;
}

/** finishMatch needs a short delayed transition; sim is tick-driven so emulate with restartTimer. */
function setTimeoutTick(sim: MatchSim, fn: () => void) {
  // executes on the next step via a micro-queue carried on the instance
  const anySim = sim as unknown as { _pending?: (() => void)[] };
  anySim._pending = anySim._pending || [];
  anySim._pending.push(fn);
  // patch step once
  const patched = sim as unknown as { _patched?: boolean };
  if (!patched._patched) {
    patched._patched = true;
    const orig = sim.step.bind(sim);
    sim.step = (inputs: [PadInput, PadInput]) => {
      const st = sim.state;
      if (st.phase === 'fullTime') {
        st.restartTimer -= DT;
        if (st.restartTimer <= 0) {
          const q = anySim._pending || [];
          anySim._pending = [];
          q.forEach((f) => f());
        }
        return;
      }
      orig(inputs);
    };
  }
}
