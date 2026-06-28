export interface Vec2 {
  x: number;
  y: number;
}

export type Pos = 'GK' | 'DF' | 'MF' | 'FW';

export type HairStyle = 'short' | 'crop' | 'curly' | 'bald' | 'long';
export type FacialHair = 'none' | 'stubble' | 'moustache' | 'beard';
export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'sleeves';
export type BadgeShape = 'shield' | 'round' | 'crest';

export interface PlayerAppearance {
  /** Cosmetic only. Use skinTone for rendering; never feed appearance into gameplay. */
  skinTone: string;
  hairColor: string;
  hairStyle: HairStyle;
  facialHair?: FacialHair;
  bootColor?: string;
  /** Optional descriptive metadata for editors/search; no gameplay effect. */
  ethnicity?: string;
}

export interface KitStyle {
  pattern: KitPattern;
  secondary?: string;
  trim?: string;
  numberColor?: string;
  badgeShape?: BadgeShape;
  badgeText?: string;
  /** Optional manifest key for offline/generated badge art. */
  badgeAssetKey?: string;
  /** Optional manifest key for offline/generated full kit overlay art. */
  kitAssetKey?: string;
}

/** Specific on-pitch role, finer than the coarse `pos` (GK/DF/MF/FW). Used by the
 * lineup slotter to place a player in his real position (e.g. a fast centre-back
 * stays central instead of being guessed into full-back from his pace). Optional —
 * players without it fall back to the coarse `pos` + attribute heuristic.
 *   CB centre-back · FB full-back · WB wing-back · DM holding mid · CM central mid
 *   AM attacking mid · W wide mid/winger · WF wide forward/inside forward · ST striker */
export type PlayerPosition = 'GK' | 'CB' | 'FB' | 'WB' | 'DM' | 'CM' | 'AM' | 'W' | 'WF' | 'ST';

export interface PlayerAttrs {
  name: string;
  pos: Pos;
  age: number;
  pace: number;
  pass: number;
  shoot: number;
  tackle: number;
  keeping: number;
  shirtNumber?: number;
  /** Specific role; finer than `pos`. See PlayerPosition. */
  position?: PlayerPosition;
  appearance?: Partial<PlayerAppearance>;
}

export interface KitColors {
  shirt: string;
  shorts: string;
  socks: string;
  style?: Partial<KitStyle>;
}

export interface TeamData {
  id: string;
  name: string;
  short: string;
  stadium: string;
  strength: number;
  colors: { home: KitColors; away: KitColors };
  /** Optional real-world tournament default; squad indices in formation slot order. */
  defaultLineup?: Lineup;
  visuals?: {
    badgeAssetKey?: string;
    kitStyles?: Partial<Record<'home' | 'away', Partial<KitStyle>>>;
  };
  players: PlayerAttrs[];
}

export type TacticalMentality = 'defensive' | 'balanced' | 'attacking';
export type PressingStyle = 'low' | 'mid' | 'high';
export type BuildUpStyle = 'patient' | 'balanced' | 'direct';

export interface TeamTactics {
  mentality: TacticalMentality;
  /** 0 narrow/compact .. 100 stretch the pitch */
  width: number;
  /** 0 low block .. 100 high line */
  defensiveDepth: number;
  pressing: PressingStyle;
  buildUp: BuildUpStyle;
}

/** Eleven players (squad indices) in formation slot order: GK first. */
export interface Lineup {
  formation: FormationId;
  starters: number[];
  tactics?: TeamTactics;
}

export type FormationId =
  | '2-3-5'
  | 'w-m'
  | '4-2-4'
  | '4-2-2-2'
  | '4-3-2-1'
  | '4-4-2'
  | '4-3-3'
  | '5-3-2'
  | '4-5-1'
  | '3-5-2'
  | '4-2-3-1'
  | '4-1-4-1'
  | '4-3-1-2'
  | '4-4-1-1'
  | '3-4-3'
  | '3-4-1-2'
  | '3-4-2-1'
  | '3-1-4-2'
  | '5-4-1';

export type ControllerKind = 'human' | 'ai' | 'remote';

export interface MatchTeamConfig {
  data: TeamData;
  lineup: Lineup;
  kit: KitColors;
  controller: ControllerKind;
  /** per-player current form, 0-100 (50 = neutral), keyed by squad index. In
   * form players sharpen up, out-of-form players underperform their attributes. */
  playerForm?: Record<number, number>;
}

export interface MatchEra {
  year: number;
  substitutionLimit: number;
  fireworks: boolean;
}

export type MatchWeather = 'normal' | 'sunny' | 'rain' | 'snow' | 'ice';
export type MatchTimeOfDay = 'day' | 'evening' | 'night';
export type MatchVenueProfile = 'training' | 'small-stadium' | 'main-stadium';
export type MatchCrowdDensity = 'empty' | '20' | '40' | '60' | '80' | 'sparse' | 'medium' | 'full';

export interface MatchConfig {
  teams: [MatchTeamConfig, MatchTeamConfig];
  halfLengthSec: number;
  difficulty: 0 | 1 | 2 | 3;
  cupTie: boolean; // extra time + penalties if drawn
  weather?: MatchWeather;
  timeOfDay?: MatchTimeOfDay;
  seed: number;
  isFriendly?: boolean;
  /** the winner of this match lifts the trophy (a cup/league final) — triggers the trophy celebration */
  trophyWin?: boolean;
  /** the named side celebrates a major result without showing a trophy prop */
  celebrationWin?: boolean;
  celebrationTeam?: 0 | 1;
  leagueId?: string;
  cupRoundName?: string;
  /** the venue this match is played at (e.g. a randomised real World Cup stadium for the International Cup) */
  stadiumName?: string;
  homePosition?: number;
  awayPosition?: number;
  venueProfile?: MatchVenueProfile;
  crowdDensity?: MatchCrowdDensity;
  startScore?: [number, number];
  startTimeSec?: number;
  startHalf?: 1 | 2 | 3 | 4;
  era?: MatchEra;
  /** small per-side match momentum seed, used by tournament modes that carry
   * pressure across fixtures; neutral one-off matches omit this and start 0-0. */
  initialMomentum?: [number, number];
  /** hidden pitch temperature in °C. Higher temperatures sap stamina faster and,
   * above a hot threshold, stage drinks breaks even outside the international cup.
   * Omitted = a mild day with no heat effect. */
  temperature?: number;
  /** Player Career / Be-A-Pro: pin human control to a single player (the career
   *  avatar). The camera follows them and the AI steers their ten team-mates. */
  focusPlayer?: { team: 0 | 1; squadIdx: number };
}

export interface PadInput {
  moveX: number; // -1..1
  moveY: number;
  pass: boolean; // button held states; edges derived in-sim
  shoot: boolean;
  sprint: boolean;
  switchPlayer: boolean;
}

export const NULL_INPUT: PadInput = { moveX: 0, moveY: 0, pass: false, shoot: false, sprint: false, switchPlayer: false };

export type SimPhase =
  | 'kickoff'
  | 'play'
  | 'throwIn'
  | 'corner'
  | 'goalKick'
  | 'freeKick'
  | 'penaltyKick'
  | 'goalCelebration'
  | 'halfTime'
  | 'extraTimeBreak'
  | 'fullTime'
  | 'penalties'
  | 'finished';

export interface SimPlayer {
  idx: number; // 0..21
  team: 0 | 1;
  attrs: PlayerAttrs;
  squadIdx: number;
  isGK: boolean;
  /** formation slot home position, in attack-normalized space (x: -1 own goal .. 1 opp goal) */
  slot: Vec2;
  pos: Vec2;
  vel: Vec2;
  facing: number; // radians
  stamina: number; // 0..1 short-term energy (the visible bar); dips on sprints, recovers when resting
  staminaCeiling: number; // 0..1 long-term condition: the max stamina can recover to; erodes across the match
  control: boolean; // currently human-controlled
  yellowCards: number;
  foulsCommitted: number;
  sentOff: boolean;
  kickCooldown: number;
  slideTimer: number; // >0 while slide tackling
  anim: 'idle' | 'run' | 'sprint' | 'slide' | 'celebrate' | 'throw' | 'dive'
    | 'header' | 'kick' | 'smother' | 'gkthrow' | 'tackle' | 'fall';
  /** true while a slide is a goalkeeper dive, for the renderer pose */
  diving?: boolean;
  /** stable roll side for a goalkeeper save; avoids deriving the pose from changing velocity */
  diveSide?: -1 | 0 | 1;
  /** distinguishes a lateral line save from a forward smother, and a rushed-out spread
   * (the keeper charges an attacker and slides out, rather than a lateral line dive) */
  diveKind?: 'line' | 'smother' | 'spread' | null;
  /** true while the keeper is committed to a dive he cannot actually reach — he
   * makes the full attempt but is beaten, so the diving-reach save is suppressed */
  diveBeaten?: boolean;
  /** >0 while a one-shot action anim (header/kick/gkthrow) holds over the locomotion anim */
  actionTimer?: number;
  /** >0 while the player is down after a foul or a hard tackle — he lies on the
   * turf (anim 'fall') and can't act until he gets back to his feet */
  downTimer?: number;
  /** how hard the challenge that put him down was, 0..1 — drives the size of the
   * fall (launch height, roll, skid). A clean-tackle stumble is low, a heavy foul high. */
  fallPower?: number;
  /** true when the shove went with his facing (clipped from behind) so he pitches onto
   * his front; false/undefined topples him backward (a tackle into his front) */
  fallForward?: boolean;
  /** >0 (sim-seconds) while a knocked player plays on with a reduced skill level */
  knockTimer?: number;
  /** true when a forced-off injury has taken him out of the game (pending sub or man-down) */
  injuredOff?: boolean;
}

export interface SimBall {
  pos: Vec2;
  z: number;
  vel: Vec2;
  vz: number;
  spin: number; // signed curl
  kickDir: Vec2; // normalized original kick direction, used to constrain aftertouch
  ownerIdx: number; // player index dribbling, -1 if free
  lastTouchTeam: 0 | 1;
  lastKicker: number;
  /** goalkeeper has caught the ball and is holding it in hand */
  held?: boolean;
}

export interface PenaltyState {
  shooterTeam: 0 | 1;
  round: number;
  scores: [number[], number[]]; // 1 scored, 0 missed per kick
  stage: 'place' | 'aim' | 'strike' | 'result' | 'done';
  timer: number;
  aim: number; // -1..1 lateral
  dive: number;
  winner: -1 | 0 | 1;
}

export interface SimEvent {
  type:
    | 'kick' | 'shot' | 'header' | 'goal' | 'save' | 'post' | 'whistle' | 'fullWhistle'
    | 'out' | 'bounce' | 'tackle' | 'nearMiss' | 'halfTime' | 'fullTime'
    | 'kickoff' | 'penScored' | 'penMissed' | 'matchEnd'
    | 'foul' | 'offside' | 'yellowCard' | 'redCard' | 'penalty' | 'pass' | 'addedTime'
    | 'hydrationBreak' | 'injury' | 'sub'
    // crowd reactions: a boo at a clearly wrong refereeing decision, ironic applause
    // when an aggrieved team finally gets one their way, and a sarcastic mock cheer
    // when a shot is skied or dragged miles wide. `team` = the team the crowd is
    // reacting to (for crowdMock, the side that took the wayward shot).
    | 'crowdBoo' | 'crowdIronic' | 'crowdMock';
  team?: 0 | 1;
  player?: number;
  /** for 'sub' events: the squad index of the player coming on */
  onSquadIdx?: number;
  /** for 'sub' events: the on-pitch slot index of the player going off — same index space
   *  as the 'injury' event's `player` field, so the guest can clear the injury marker. */
  offPlayerIdx?: number;
  target?: number;
  power?: number;
  /** a tackle/block that snuffed out a goal threat near the defender's own goal — the crowd applauds */
  danger?: boolean;
  /** stoppage time, in seconds, for an 'addedTime' event */
  seconds?: number;
}

export interface GoalLogEntry {
  team: 0 | 1;
  player: string;
  minute: number;
  ownGoal?: boolean;
  /** the team-mate who set up the goal (the last different kicker before the scorer),
   *  when one can be credited within a recent window */
  assist?: string;
}

export interface MatchState {
  phase: SimPhase;
  tick: number;
  clock: number; // seconds of current half
  /** announced stoppage time for the current half, in seconds (0 until the clock passes regulation) */
  addedTime?: number;
  half: 1 | 2 | 3 | 4; // 3,4 = extra time
  score: [number, number];
  goals: GoalLogEntry[];
  ball: SimBall;
  players: SimPlayer[];
  /** which goal team 0 attacks this half: +1 means +x */
  attackDir: [number, number];
  restartTeam: 0 | 1;
  restartPos: Vec2;
  restartTimer: number;
  controlledIdx: [number, number]; // controlled player per team (-1 for AI teams)
  substitutionsUsed: [number, number];
  /** squad indices already taken off per team — a subbed-off player can never return */
  subbedOff: [number[], number[]];
  /** squad indices that came on as substitutes per team — used by UI to show sub arrows */
  subbedOn: [number[], number[]];
  penalties: PenaltyState | null;
  /** -1..1 current visible penalty aim marker, for normal penalties and shoot-outs */
  penaltyAim: number;
  /** -1..1 held defending-keeper dive pre-commit (stick left/centre-stay/right) for an
   * in-match penalty, latched into the keeper's guess at the strike. Mirrors penaltyAim.
   * Optional so older serialized/test states default to neutral (treated as 0). */
  penaltyDive?: number;
  /** crowd excitement 0..1 for audio */
  excitement: number;
  /** per-team momentum, roughly -12..12. Positive sharpens execution slightly,
   * negative introduces a small drag under pressure. */
  momentum: [number, number];
  /** forced-off injuries accrued this match, for end-of-match career persistence */
  injuries: { team: 0 | 1; name: string; matchesOut: number }[];
  winner: -1 | 0 | 1; // resolved at finish (draw allowed in league)
}
