/**
 * Football World — MANAGER MODE types (the contract every manager module builds on).
 *
 * A Manager career is an open-ended, multi-season club management game built on a
 * Nation (a pyramid of leagues with promotion/relegation, or the flat World pool).
 * Pure data — no DOM, no engine imports — so it can be unit-tested and saved freely.
 */
import type { PlayerAttrs, TeamData, Lineup, KitColors, MatchConfig } from '../../sim/types';
import type { PhoneInbox, MetaContext, MoraleDelta, PressTone } from '../../meta/metaTypes';

export type TrainingFocus = 'balanced' | 'fitness' | 'attacking' | 'defensive' | 'technical' | 'youth';

/** A player as the manager mode sees them: the sim's PlayerAttrs plus live career state. */
export interface ManagerPlayer extends PlayerAttrs {
  /** 0-100, 50 = neutral — feeds the match `playerForm` lever */
  form: number;
  /** 0-100 morale */
  morale: number;
  /** 0-100 physical condition / fitness */
  fitness: number;
  /** years remaining on contract */
  contractYears: number;
  /** £k per week */
  wage: number;
  /** overall ceiling (0-99); scouted players' true attributes get revealed */
  potential: number;
  /** true once the user has scouted this player (reveals hidden attrs/potential) */
  scouted?: boolean;
}

export interface Headline {
  id: string;
  title: string;
  source: string;
  tone: 'positive' | 'negative' | 'neutral' | 'sensational';
  body?: string;
  season: number;
}

export interface LeagueStanding {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

export type TargetKind = 'title' | 'promotion' | 'playoffs' | 'survival' | 'mid-table';

export interface SeasonTarget {
  tier: number;
  /** board expects a finish at-or-above this position (1 = win the league) */
  minPosition: number;
  description: string;
  kind: TargetKind;
}

export interface ScoutingAssignment {
  id: string;
  targetClubId: string;
  weeksLeft: number;
}

export interface BoardState {
  /** 0-100 board confidence in the manager */
  confidence: number;
  target: SeasonTarget;
  /** sack warnings accrued for missing targets / bad runs */
  warnings: number;
}

export interface Sentiment {
  fans: number;
  media: number;
  squad: number;
  pressure: number;
}

export type JobOutcome = 'current' | 'sacked' | 'resigned' | 'moved-up' | 'relegated-takeover';

export interface JobHistoryEntry {
  clubId: string;
  clubName: string;
  tier: number;
  seasonFrom: number;
  seasonTo: number | null;
  outcome: JobOutcome;
}

export type ManagerPhase =
  | 'pre-season'
  | 'in-season'
  | 'season-end'
  | 'sacked'
  | 'job-offers'
  | 'ended';

export interface PendingFixture {
  leagueId: string;
  round: number;
  homeClubId: string;
  awayClubId: string;
  cupTie: boolean;
}

export interface ManagerState {
  version: 1;
  managerName: string;
  /** 0-100 manager reputation — gates the quality of clubs that will hire you */
  reputation: number;

  nationId: string;
  userClubId: string;

  season: number; // 1-based
  year: number; // display calendar year

  /** current tier (1 = top) of every club in the nation */
  clubTier: Record<string, number>;
  /** current league id of every club */
  clubLeagueId: Record<string, string>;
  /** live squads keyed by club id */
  squads: Record<string, ManagerPlayer[]>;

  /** per league: the ordered club-id list fixtures/results are indexed against (stable for a season) */
  leagueTeamIds: Record<string, string[]>;
  /** per league: rounds of [homeIdx, awayIdx] pairs (indexes into leagueTeamIds[leagueId]) */
  fixtures: Record<string, [number, number][][]>;
  /** per league: played results keyed `${round}:${pairIndex}` -> [homeGoals, awayGoals] */
  results: Record<string, Record<string, [number, number]>>;

  matchday: number; // current round index (0-based), shared across leagues
  totalRounds: number;

  // ---- transfer market ----
  transferBudget: number; // £k available to the user club
  wageBudget: number; // £k/week wage ceiling for the user club
  windowPhase: 'summer' | 'winter' | 'closed';

  // ---- scouting ----
  scoutAssignments: ScoutingAssignment[];
  /** playerKey (`clubId::name`) the user has fully scouted */
  scoutedPlayers: Record<string, boolean>;

  // ---- training ----
  trainingFocus: TrainingFocus;

  // ---- meta ----
  sentiment: Sentiment;
  board: BoardState;
  inbox: PhoneInbox;
  headlines: Headline[];
  jobHistory: JobHistoryEntry[];
  /** human-readable review lines for the season just completed (captured pre-rollover) */
  lastSeasonReview: string[];

  phase: ManagerPhase;
  pendingUserFixture: PendingFixture | null;

  seed: number;
}

// ---- shared pure helpers (no imports) ----
export const clamp = (v: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, v));
export const playerKey = (clubId: string, name: string): string => `${clubId}::${name}`;
export const moneyM = (k: number): string => `£${(k / 1000).toFixed(k >= 1000 ? 1 : 2)}M`;
export const moneyK = (k: number): string => `£${Math.round(k).toLocaleString()}k`;

// ---- module API contract (implemented in the sibling modules) ----
// engine.ts:  createManagerCareer, leagueTableOf, userLeagueId, userFixtureThisMatchday,
//             simMatchdayCPUs, recordUserResult, quickSimUserFixture, advance, endSeason,
//             startNextSeason, standingsForUserLeague, resolveLineup
// market.ts:  cpuTransferMarket, listingsFor, makeBid, offerPlayer, assignScout,
//             tickScouting, youthIntake, signFreeAgent, releasePlayer
// training.ts: applyTrainingTick, developOverOffseason, ageSquadOneYear
// targets.ts:  seasonTargetFor, evaluateTarget, applyBoardEvaluation, jobOffers, takeJob
// meta.ts:     buildManagerContext, applyManagerMorale, managerPressConference,
//              rollManagerEvents, pushManagerMessage, addManagerHeadline,
//              recordUserMatchNarrative, seedManagerInbox
// match.ts:    buildManagerMatch
// saves.ts:    managerSlots, ensureManagerSystems, saveManager, loadManager
