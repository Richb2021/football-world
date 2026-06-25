import type { ContactMode, StoryCampaignId } from './types';

export interface StoryCampaignDef {
  id: StoryCampaignId;
  title: string;
  seasonLabel: string;
  role: 'player' | 'manager';
  clubId: string;
  defaultName: string;
  defaultPosition: 'GK' | 'DF' | 'MF' | 'FW';
  contactMode: ContactMode;
  description: string;
}

export const STORY_CAMPAIGNS: StoryCampaignDef[] = [
  {
    id: 'international-cup-story',
    title: 'Road to Glory',
    seasonLabel: '2026',
    role: 'player',
    clubId: 'fictional-united',
    defaultName: 'Jordan Reeves',
    defaultPosition: 'FW',
    contactMode: 'phone',
    description: 'A player story about pressure, selection, and the matches that decide whether promise becomes legacy.',
  },
  {
    id: 'last-dance-story',
    title: 'The Last Dance',
    seasonLabel: '2026',
    role: 'player',
    clubId: 'cape-verde',
    defaultName: 'Tomas Andrade',
    defaultPosition: 'FW',
    contactMode: 'phone',
    description: 'An older forward is asked for one more summer, with a nation waiting to see what is still left in his legs.',
  },
  {
    id: 'two-passports-story',
    title: 'Two Passports',
    seasonLabel: '2026',
    role: 'player',
    clubId: 'haiti',
    defaultName: 'Malik Carter',
    defaultPosition: 'MF',
    contactMode: 'phone',
    description: 'A dual-national midfielder faces a career-defining international call-up, and every answer closes a door.',
  },
  {
    id: 'miners-cup-story',
    title: 'The Miners\' Cup',
    seasonLabel: '1909',
    role: 'player',
    clubId: 'auckland-colliers',
    defaultName: 'Tommy Kerr',
    defaultPosition: 'MF',
    contactMode: 'cablegram',
    description: 'A coalfield side is sent where the football authorities will not go, carrying wages, pride, and doubt across Europe.',
  },
  {
    id: 'first-eleven-story',
    title: 'The First Eleven',
    seasonLabel: '1872',
    role: 'player',
    clubId: 'scotland',
    defaultName: 'Andrew Kerr',
    defaultPosition: 'DF',
    contactMode: 'telegram',
    description: 'A first international has to become more than a newspaper challenge before anyone agrees it is history.',
  },
];

export function storyModeMenuCopy(count = STORY_CAMPAIGNS.length): string {
  return `Choose one of ${count} playable stories where off-field decisions change the matches.`;
}

export function storyCampaignById(id: StoryCampaignId): StoryCampaignDef {
  return STORY_CAMPAIGNS.find((campaign) => campaign.id === id) ?? STORY_CAMPAIGNS[0];
}
