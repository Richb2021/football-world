/**
 * Football World — PLAYER CAREER MODE types.
 *
 * A New-Star-Soccer-style career: you ARE a single footballer. The league world
 * (clubs, fixtures, tables, CPU simulations, promotion/relegation) is owned by an
 * embedded ManagerState (`world`) and driven by the manager engine — this module
 * only adds the avatar layer: your player's attributes (kept inside the world
 * squad so the match engine reads them), stats, reputation, training, transfers
 * and international call-ups.
 */
import type { ManagerState } from '../manager/types';
import type { PhoneInbox } from '../../meta/metaTypes';
import type { PlayerAppearance, Pos } from '../../sim/types';

export type PlayerTrainingFocus = 'balanced' | 'pace' | 'passing' | 'shooting' | 'tackling' | 'physical';

export interface PlayerMatchLog {
  season: number;
  matchday: number;
  opponent: string;
  club: string;
  score: [number, number];
  result: 'win' | 'draw' | 'loss';
  rating: number; // 1-10
  goals: number;
  assists: number;
  minutes: number;
}

export interface PlayerHeadline {
  id: string;
  title: string;
  source: string;
  tone: 'positive' | 'negative' | 'neutral' | 'sensational';
  body?: string;
  season: number;
}

export type PlayerCareerPhase = 'in-season' | 'season-end' | 'retired';

export interface PlayerCareerState {
  version: 1;
  /** the live league world (reuses the manager engine for simulation + pro/rel) */
  world: ManagerState;
  playerName: string;
  pos: Pos;
  appearance?: PlayerAppearance;

  reputation: number; // 0-100
  trainingXp: number;
  trainingFocus: PlayerTrainingFocus;

  // this-season totals
  apps: number;
  goals: number;
  assists: number;
  avgRating: number;
  // career totals
  careerApps: number;
  careerGoals: number;
  careerAssists: number;
  // international honours
  internationalCaps: number;
  internationalGoals: number;
  internationalEligible: boolean;

  history: PlayerMatchLog[];
  inbox: PhoneInbox;
  /** a pending transfer offer computed at season's end (null = none / declined) */
  transferOffer?: { clubId: string; clubName: string; tier: number } | null;
  headlines: PlayerHeadline[];
  phase: PlayerCareerPhase;
  lastReview: string[];
  seed: number;
}
