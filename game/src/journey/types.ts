/**
 * Journey Story Mode - Types and Interfaces
 * A narrative-driven career mode set in the 1992/93 Premier League era
 */
import type { PhoneInbox } from '../meta/metaTypes';

export interface JourneyState {
  campaignId: StoryCampaignId;
  episodeId: string;
  sceneId: string;
  storyRole: 'player' | 'manager';
  playerName: string;
  playerPosition: 'GK' | 'DF' | 'MF' | 'FW';
  clubId: string;
  stats: PlayerStats;
  relationships: Record<string, number>; // NPC relationship scores (-10 to +10)
  reputation: number; // 0-100, affects media coverage and fan support
  storyFlags: Record<string, boolean>; // Track choices made
  inventory: string[]; // Items acquired
  trainingFocus: TrainingFocus;
  matchPerformance: MatchHistoryEntry[];
  episodeHistory: string[]; // Completed episodes
  storyPressure: number; // -10 calm to +10 strained
  storyMorale: number; // -10 fractured to +10 united
  pressPressure: number; // -10 forgiving coverage to +10 hostile coverage
  fanPressure: number; // -10 patient support to +10 heavy public expectation
  injuryRisk: number; // 0 healthy to 10 severe recurring risk
  isComplete: boolean;
  /** the player's phone inbox — off-field messages from agent, family, media, etc. */
  inbox?: PhoneInbox;
  /** visual/contact framing for off-field messages; historic stories use period dispatches. */
  contactMode?: ContactMode;
}

export type StoryCampaignId =
  | 'international-cup-story'
  | 'last-dance-story'
  | 'two-passports-story'
  | 'miners-cup-story'
  | 'first-eleven-story';

export type ContactMode = 'phone' | 'telegram' | 'cablegram' | 'fax-dossier';

export interface PlayerStats {
  pace: number; // 40-99
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
  mental: number; // Composure, decision making
}

export type TrainingFocus = 'balanced' | 'fitness' | 'technical' | 'tactical' | 'mental';

export interface MatchHistoryEntry {
  matchId: string;
  date: string;
  opponent: string;
  result: 'win' | 'draw' | 'loss';
  score?: [number, number];
  goalMargin?: number;
  minutesPlayed: number;
  rating: number; // 1-10
  goals: number;
  assists: number;
  keyPasses: number;
  tackles: number;
  saves?: number; // For GKs
}

export type JourneyMatchId =
  | 'rtg_trial'
  | 'rtg_league_comeback'
  | 'rtg_final_chance'
  | 'rtg_group_stage'
  | 'rtg_world_cup_final'
  | 'ld_return_friendly'
  | 'ld_group_decider'
  | 'tp_showcase_match'
  | 'tp_heritage_playoff'
  | 'tp_birth_trial'
  | 'tp_worldcup_vs_birth'
  | 'mc_turin_semi'
  | 'mc_turin_final'
  | 'mc_turin_defence'
  | 'fe_hamilton_crescent';

export interface JourneyMatchRequest {
  matchId: JourneyMatchId;
}

export interface JourneyMatchOutcome {
  score: [number, number];
  winner: -1 | 0 | 1;
}

export type StoryGate =
  | { type: 'flag'; flag: string; value?: boolean }
  | { type: 'relationship'; npcId: string; min?: number; max?: number }
  | { type: 'reputation'; min?: number; max?: number }
  | { type: 'stat'; stat: keyof PlayerStats; min?: number; max?: number }
  | { type: 'storyPressure'; min?: number; max?: number }
  | { type: 'storyMorale'; min?: number; max?: number }
  | { type: 'pressPressure'; min?: number; max?: number }
  | { type: 'fanPressure'; min?: number; max?: number }
  | { type: 'injuryRisk'; min?: number; max?: number }
  | { type: 'matchResult'; matchId: JourneyMatchId | string; result: MatchHistoryEntry['result'] }
  | { type: 'matchMargin'; matchId: JourneyMatchId | string; min?: number; max?: number };

export interface StoryRoute {
  gates?: StoryGate[];
  nextSceneId: string;
  consequences?: ChoiceConsequence[];
}

export interface Episode {
  id: string;
  title: string;
  season: number; // 1, 2, 3...
  episodeNumber: number;
  campaignId?: StoryCampaignId;
  description: string;
  unlockRequirement?: UnlockRequirement;
  scenes: Scene[];
  onComplete?: (state: JourneyState) => JourneyState;
}

export type UnlockRequirement =
  | { type: 'episode'; episodeId: string }
  | { type: 'stat'; stat: keyof PlayerStats; minValue: number }
  | { type: 'reputation'; minValue: number }
  | { type: 'relationship'; npcId: string; minValue: number }
  | { type: 'matchCount'; count: number }
  | { type: 'choice'; episodeId: string; choiceId: string };

export interface Scene {
  id: string;
  background: SceneBackground;
  music?: string;
  characters: SceneCharacter[];
  dialogue: DialogueEntry[];
  choices?: Choice[];
  onEnter?: (state: JourneyState) => JourneyState;
}

export interface SceneBackgroundAsset {
  /** Optional prerendered cinematic still. Relative paths resolve from Vite's base URL. */
  asset?: string;
  focus?: 'center' | 'left' | 'right' | 'top' | 'bottom';
  overlay?: 'none' | 'light' | 'medium' | 'dark';
}

export type SceneBackground = SceneBackgroundAsset & (
  | { type: 'training'; variant: 'morning' | 'evening' | 'rain' }
  | { type: 'physio'; variant: 'empty' | 'treatment' }
  | { type: 'managerOffice'; variant: 'day' | 'night' }
  | { type: 'lockerRoom'; variant: 'before' | 'after' | 'empty' }
  | { type: 'home'; variant: 'bedroom' | 'livingRoom' | 'kitchen' }
  | { type: 'town'; variant: 'pub' | 'street' | 'shop' }
  | { type: 'pitch'; variant: 'match' | 'empty' }
  | { type: 'media'; variant: 'pressRoom' | 'interview' }
  | { type: 'car'; variant: 'interior' }
  | { type: 'hospital'; variant: 'room' | 'corridor' }
);

export interface SceneCharacter {
  id: string;
  position: 'left' | 'center' | 'right';
  pose: string;
  expression: 'neutral' | 'happy' | 'angry' | 'concerned' | 'surprised' | 'determined';
  outfit?: string;
}

export interface DialogueEntry {
  speakerId: string;
  text: string;
  condition?: (state: JourneyState) => boolean;
  gates?: StoryGate[];
  emotion?: string;
  pause?: number; // Seconds to wait before continuing
  onComplete?: (state: JourneyState) => JourneyState;
}

export interface Choice {
  id: string;
  text: string;
  condition?: (state: JourneyState) => boolean;
  gates?: StoryGate[];
  consequences: ChoiceConsequence[];
  nextSceneId: string;
  routes?: StoryRoute[];
  postMatchRoutes?: StoryRoute[];
  match?: JourneyMatchRequest;
}

export type ChoiceConsequence =
  | { type: 'relationship'; npcId: string; change: number }
  | { type: 'stat'; stat: keyof PlayerStats; change: number }
  | { type: 'reputation'; change: number }
  | { type: 'flag'; flag: string; value: boolean }
  | { type: 'item'; item: string; action: 'add' | 'remove' }
  | { type: 'trainingFocus'; focus: TrainingFocus }
  | { type: 'storyPressure'; change: number }
  | { type: 'storyMorale'; change: number }
  | { type: 'pressPressure'; change: number }
  | { type: 'fanPressure'; change: number }
  | { type: 'injuryRisk'; change: number }
  | {
      type: 'simulatedMatch';
      matchId: string;
      opponent: string;
      result: MatchHistoryEntry['result'];
      score: [number, number];
      date?: string;
      rating?: number;
      pressureChange?: number;
      moraleChange?: number;
      reputationChange?: number;
      flag?: string;
    }
  | { type: 'nextEpisode'; episodeId: string };

// NPC Characters that appear in the story
export interface NPC {
  id: string;
  name: string;
  role: 'manager' | 'assistant' | 'physio' | 'teammate' | 'media' | 'family' | 'rival' | 'agent';
  clubId?: string;
  description: string;
  defaultPose: string;
}

// Era-accurate setting details
export interface EraSetting {
  year: 1992;
  month: number; // 8-12 (Aug-Dec for first season)
  context: string;
  headlines: string[]; // News tickers
  weather: 'sunny' | 'rain' | 'cloudy' | 'fog';
}

// Asset configuration for reusable scenes
export interface SceneAssetConfig {
  baseColor: string; // Hex color for recoloring
  lighting: 'warm' | 'cool' | 'neutral' | 'dramatic';
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}
