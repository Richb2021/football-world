import type { FormationId, KitColors } from '../../sim/types';
import type { PlayerCard } from '../../data/cards';
import type { StoryCampaignId } from '../../journey/types';

export interface StarsSquad {
  formation: FormationId;
  /** Length 11, cardId or null. Slot 0 = GK. */
  starters: (string | null)[];
}

export interface ChallengeState {
  weekKey: string;
  points: number;
  played: number;
  rewardsClaimed: number[];
}

export interface CupStarsState {
  weekKey: string | null;
  qualified: boolean;
  played: number;
  wins: number;
  losses: number;
  finished: boolean;
  rewardClaimed: boolean;
}

export interface BattlesState {
  weekKey: string;
  points: number;
  played: number;
}

export interface ArcadeTokensState {
  balance: number;
  lastDailyGrantDay: string;
  lastWeeklyGrantWeek: string;
}

export interface StarsClub {
  name: string;
  crestKey?: string;
  kit: KitColors;
}

export interface StarsRivalState {
  clubName: string;
  ownerName: string;
  personality: 'mouthy' | 'calm' | 'flashy' | 'old-school';
  grudge: number;
  lastResult?: 'win' | 'draw' | 'loss';
}

export interface StarsOwnerProfile {
  boardMood: number;
  fanMood: number;
  pressPressure: number;
  form: string[];
  headline?: string;
  rival?: StarsRivalState;
}

export interface StarsRivalsWeeklyState {
  weekKey: string;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  rewardsClaimed: number[];
}

export interface StarsWorldTourState {
  weekKey: string;
  currentMatch: number;
  completed: boolean;
  rewardsClaimed: boolean;
  stageRewardsClaimed: number[];
}

export interface StarsState {
  version: 1;
  coins: number;
  owned: Record<string, number>; // cardId -> count owned
  customCards?: Record<string, PlayerCard>;
  squad: StarsSquad;
  club: StarsClub;
  challenge: ChallengeState;
  cup: CupStarsState;
  battles: BattlesState;
  owner: StarsOwnerProfile;
  rivals: StarsRivalsWeeklyState;
  worldTour: StarsWorldTourState;
  weekly: { lastGrantWeek: string };
  arcadeTokens: ArcadeTokensState;
  storyUnlocks?: StoryCampaignId[];
  packRngSeed: number;
  purchaseIds?: string[];
  userId?: string;
}
