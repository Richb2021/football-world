import type { Episode, NPC } from '../types';
import {
  rtgEpisode1,
  rtgEpisode2,
  rtgEpisode3,
  rtgEpisode4,
  rtgEpisode5,
  storyCampaignNPCs,
} from './internationalCupStory';
import {
  lastDanceEpisode1,
  lastDanceEpisode2,
  lastDanceEpisode3,
  lastDanceEpisode4,
  lastDanceNPCs,
} from './lastDanceStory';
import {
  twoPassportsEpisode1,
  twoPassportsEpisode2,
  twoPassportsEpisode3,
  twoPassportsEpisode4,
  twoPassportsEpisode5,
  twoPassportsNPCs,
} from './twoPassportsStory';
import {
  minersCupEpisode1,
  minersCupEpisode2,
  minersCupEpisode3,
  minersCupEpisode4,
  minersCupNPCs,
} from './minersCupStory';
import {
  firstElevenEpisode1,
  firstElevenEpisode2,
  firstElevenEpisode3,
  firstElevenNPCs,
} from './firstElevenStory';

export const allEpisodes: Episode[] = [
  rtgEpisode1,
  rtgEpisode2,
  rtgEpisode3,
  rtgEpisode4,
  rtgEpisode5,
  lastDanceEpisode1,
  lastDanceEpisode2,
  lastDanceEpisode3,
  lastDanceEpisode4,
  twoPassportsEpisode1,
  twoPassportsEpisode2,
  twoPassportsEpisode3,
  twoPassportsEpisode4,
  twoPassportsEpisode5,
  minersCupEpisode1,
  minersCupEpisode2,
  minersCupEpisode3,
  minersCupEpisode4,
  firstElevenEpisode1,
  firstElevenEpisode2,
  firstElevenEpisode3,
];

export const allNPCs: NPC[] = [
  ...storyCampaignNPCs,
  ...lastDanceNPCs,
  ...twoPassportsNPCs,
  ...minersCupNPCs,
  ...firstElevenNPCs,
];

export function getEpisodeById(id: string): Episode | undefined {
  return allEpisodes.find(ep => ep.id === id);
}

export function getNPCById(id: string): NPC | undefined {
  return allNPCs.find(npc => npc.id === id);
}

export function getEpisodesForSeason(season: number): Episode[] {
  return allEpisodes.filter(ep => ep.season === season);
}

export function isEpisodeUnlocked(episode: Episode, completedEpisodes: string[]): boolean {
  if (!episode.unlockRequirement) return true;
  
  const req = episode.unlockRequirement;
  switch (req.type) {
    case 'episode':
      return completedEpisodes.includes(req.episodeId);
    default:
      return true;
  }
}
