/**
 * Shared types for the meta layer (phone inbox, press conferences, random
 * events) used by BOTH the International Cup (career) and the Story (journey)
 * modes. Pure data — no DOM, no engine imports — so it can be unit tested and
 * reused freely.
 */

/** A bundle of morale/sentiment effects an answer or event can apply. All
 * fields optional; values are signed deltas in the -100..100 scale unless noted. */
export interface MoraleDelta {
  /** whole-squad morale */
  squad?: number;
  /** manager/player pressure (higher = more heat) */
  pressure?: number;
  /** board / federation confidence */
  board?: number;
  /** fan sentiment */
  fans?: number;
  /** media sentiment */
  media?: number;
  /** personal reputation */
  reputation?: number;
  /** named individual player morale changes */
  players?: { name: string; delta: number }[];
  /** short-term player availability effects, measured in upcoming career steps */
  availability?: { name: string; unavailableMatches: number; reason?: string }[];
}

export type SenderType =
  | 'chairman' | 'agent' | 'captain' | 'teammate' | 'media'
  | 'family' | 'physio' | 'assistant' | 'fan' | 'pundit' | 'unknown';

export interface PhoneReply {
  id: string;
  text: string;
  /** what they say back when you pick this */
  response?: string;
  effect?: MoraleDelta;
}

export interface PhoneMessage {
  id: string;
  /** display name of the sender */
  from: string;
  senderType: SenderType;
  /** seed for the procedural avatar; stable per contact */
  avatarSeed: string;
  /** optional pre-made portrait asset path; falls back to the procedural avatar */
  avatarAsset?: string;
  /** human label for when it arrived, e.g. "Group Stage · MD2" */
  time: string;
  /** chronological order key (lower = older) */
  order: number;
  text: string;
  read: boolean;
  pinned?: boolean;
  replies?: PhoneReply[];
  /** if true, the player must pick a reply before progressing */
  requiresResponse?: boolean;
  /** set once a reply has been chosen */
  replied?: string;
}

export interface PhoneInbox {
  messages: PhoneMessage[];
}

export type PressTone =
  | 'pre-tournament' | 'pre-match' | 'post-win' | 'post-loss' | 'post-draw'
  | 'crisis' | 'selection' | 'speculation' | 'form';

export type PressStance = 'friendly' | 'neutral' | 'hostile';
export type ExpectationTier = 'favourite' | 'contender' | 'dark-horse' | 'outsider' | 'minnow';
export type PerformanceMood = 'collapse' | 'underperforming' | 'par' | 'overperforming' | 'heroic';

export type AnswerTone =
  | 'humble'
  | 'confident'
  | 'defiant'
  | 'deflect'
  | 'honest'
  | 'fiery'
  | 'calm'
  | 'protective'
  | 'blunt'
  | 'diplomatic'
  | 'sarcastic'
  | 'private'
  | 'public';

export interface PressAnswerNarrative {
  headline?: {
    title: string;
    source?: string;
    tone?: 'positive' | 'negative' | 'neutral' | 'sensational';
    body?: string;
  };
  arc?: { type: string; heat: number };
  message?: {
    from: string;
    senderType: SenderType;
    text: string;
    replies?: PhoneReply[];
    requiresResponse?: boolean;
  };
}

export interface PressAnswer {
  id: string;
  text: string;
  tone: AnswerTone;
  effect: MoraleDelta;
  /** the room's reaction line */
  reaction?: string;
  narrative?: PressAnswerNarrative;
  /** a follow-up question this answer prompts (shown immediately after, before the
   *  next base question) — makes press conferences feel like a real back-and-forth */
  followUp?: PressQuestion;
}

export interface PressResult {
  total: MoraleDelta;
  answers: PressAnswer[];
}

export interface PressQuestion {
  id: string;
  /** outlet / reporter name */
  reporter: string;
  reporterSeed: string;
  text: string;
  answers: PressAnswer[];
}

export interface PressConference {
  title: string;
  subtitle?: string;
  /** background image path (a press room) */
  room: string;
  speakerName: string;
  speakerSeed: string;
  speakerAsset?: string;
  questions: PressQuestion[];
}

/** Context describing the situation a press conference / event batch responds to. */
export interface MetaContext {
  teamName: string;
  managerName: string;
  opponent?: string;
  tone: PressTone;
  /** tournament stage label, e.g. "Quarter-Final" */
  stage?: string;
  /** [for, against] of the just-played match, if any */
  lastScore?: [number, number];
  /** true if eliminated / season-ending defeat */
  knockedOut?: boolean;
  /** named unhappy players for contextual questions */
  unhappy?: string[];
  /** an in-form and out-of-form player name, if known */
  inForm?: string;
  outOfForm?: string;
  /** star player name for speculation lines */
  star?: string;
  /** matches played so far */
  matchNumber?: number;
  pressStance?: PressStance;
  fans?: number;
  media?: number;
  squad?: number;
  pressure?: number;
  expectationTier?: ExpectationTier;
  opponentTier?: ExpectationTier;
  performanceMood?: PerformanceMood;
  teamStrength?: number;
  opponentStrength?: number;
  underdog?: boolean;
}

export interface MetaChoice {
  id: string;
  text: string;
  /** flavour shown after choosing */
  outcome?: string;
  effect?: MoraleDelta;
}

export interface MetaEvent {
  id: string;
  title: string;
  body: string;
  senderType: SenderType;
  avatarSeed: string;
  avatarAsset?: string;
  /** a one-line news headline this event produces */
  headline?: string;
  /** optional decision; if absent, `effect` applies automatically */
  choices?: MetaChoice[];
  effect?: MoraleDelta;
  /** also drop a phone message (merged onto a generated base) */
  message?: { from: string; senderType: SenderType; text: string; replies?: PhoneReply[]; requiresResponse?: boolean };
}

export function emptyDelta(): Required<Pick<MoraleDelta, 'squad' | 'pressure' | 'board' | 'fans' | 'media' | 'reputation'>> & { players: { name: string; delta: number }[] } {
  return { squad: 0, pressure: 0, board: 0, fans: 0, media: 0, reputation: 0, players: [] };
}

/** Merge a delta into an accumulator (mutates and returns the accumulator). */
export function addDelta(acc: MoraleDelta, d?: MoraleDelta): MoraleDelta {
  if (!d) return acc;
  acc.squad = (acc.squad ?? 0) + (d.squad ?? 0);
  acc.pressure = (acc.pressure ?? 0) + (d.pressure ?? 0);
  acc.board = (acc.board ?? 0) + (d.board ?? 0);
  acc.fans = (acc.fans ?? 0) + (d.fans ?? 0);
  acc.media = (acc.media ?? 0) + (d.media ?? 0);
  acc.reputation = (acc.reputation ?? 0) + (d.reputation ?? 0);
  if (d.players?.length) acc.players = [...(acc.players ?? []), ...d.players];
  if (d.availability?.length) acc.availability = [...(acc.availability ?? []), ...d.availability];
  return acc;
}
