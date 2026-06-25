import { rarityOf, type PlayerCard } from '../../data/cards';
import { storyCampaignById } from '../../journey/campaigns';
import type { JourneyState, PlayerStats } from '../../journey/types';
import type { StarsState } from './types';
import { saveStars } from './store';

export type JourneyRewardStatus = 'added' | 'improved' | 'kept';

export interface JourneyRewardResult {
  card: PlayerCard;
  status: JourneyRewardStatus;
}

const POSITION_WEIGHTS: Record<JourneyState['playerPosition'], Record<keyof PlayerStats, number>> = {
  GK: { pace: 0.06, shooting: 0.02, passing: 0.12, dribbling: 0.06, defending: 0.24, physical: 0.2, mental: 0.3 },
  DF: { pace: 0.12, shooting: 0.04, passing: 0.12, dribbling: 0.08, defending: 0.3, physical: 0.2, mental: 0.14 },
  MF: { pace: 0.1, shooting: 0.12, passing: 0.26, dribbling: 0.18, defending: 0.13, physical: 0.08, mental: 0.13 },
  FW: { pace: 0.17, shooting: 0.25, passing: 0.1, dribbling: 0.2, defending: 0.04, physical: 0.1, mental: 0.14 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player';
}

function weightedStoryStats(state: JourneyState): number {
  const weights = POSITION_WEIGHTS[state.playerPosition];
  return Math.round(
    (Object.keys(weights) as (keyof PlayerStats)[]).reduce(
      (total, stat) => total + state.stats[stat] * weights[stat],
      0,
    ),
  );
}

function performanceBonus(state: JourneyState): number {
  const matches = state.matchPerformance;
  const avgRating = matches.length
    ? matches.reduce((sum, entry) => sum + entry.rating, 0) / matches.length
    : 6.2;
  const wins = matches.filter((entry) => entry.result === 'win').length;
  const draws = matches.filter((entry) => entry.result === 'draw').length;
  const losses = matches.filter((entry) => entry.result === 'loss').length;
  const resultBonus = clamp(wins * 2 + draws - losses * 2, -5, 8);
  const ratingBonus = clamp(Math.round((avgRating - 6.2) * 2.3), -5, 8);
  const reputationBonus = clamp(Math.round((state.reputation - 50) / 12), -4, 4);
  const moraleBonus = clamp(Math.round((state.storyMorale ?? 0) / 3), -3, 3);
  const pressurePenalty = state.storyPressure >= 8 ? -3 : state.storyPressure >= 5 ? -1 : state.storyPressure <= -3 ? 1 : 0;
  const injuryPenalty = state.injuryRisk >= 8 ? -5 : state.injuryRisk >= 6 ? -3 : state.injuryRisk >= 4 ? -1 : 0;
  const completionBonus = state.isComplete ? 2 : 0;
  return resultBonus + ratingBonus + reputationBonus + moraleBonus + pressurePenalty + injuryPenalty + completionBonus;
}

function campaignAge(state: JourneyState): number {
  switch (state.campaignId) {
    case 'last-dance-story':
      return 39;
    case 'two-passports-story':
      return 29;
    case 'international-cup-story':
    default:
      return 22;
  }
}

function cardAttrs(state: JourneyState): PlayerCard['attrs'] {
  const { stats } = state;
  const keeping = state.playerPosition === 'GK'
    ? Math.round(stats.mental * 0.42 + stats.defending * 0.36 + stats.physical * 0.22)
    : 12;
  return {
    pace: clamp(stats.pace, 1, 99),
    pass: clamp(stats.passing, 1, 99),
    shoot: clamp(stats.shooting, 1, 99),
    tackle: clamp(stats.defending, 1, 99),
    keeping: clamp(keeping, 1, 99),
  };
}

export function buildJourneyRewardCard(state: JourneyState): PlayerCard {
  const campaign = storyCampaignById(state.campaignId);
  const overall = clamp(weightedStoryStats(state) + performanceBonus(state), 45, 99);

  return {
    id: `journey:${state.campaignId}:${slug(state.playerName)}`,
    name: state.playerName,
    teamId: `journey:${state.campaignId}`,
    nation: campaign.title,
    pos: state.playerPosition,
    overall,
    rarity: rarityOf(overall),
    attrs: cardAttrs(state),
    age: campaignAge(state),
    value: 0,
    source: 'journey',
  };
}

export function grantJourneyRewardCard(stars: StarsState, state: JourneyState): JourneyRewardResult {
  const candidate = buildJourneyRewardCard(state);
  stars.customCards ??= {};

  const existing = stars.customCards[candidate.id];
  let card = candidate;
  let status: JourneyRewardStatus = 'added';
  if (existing && existing.overall >= candidate.overall) {
    card = existing;
    status = 'kept';
  } else if (existing) {
    status = 'improved';
  }

  stars.customCards[candidate.id] = card;
  stars.owned[candidate.id] = 1;
  saveStars(stars);
  return { card, status };
}

export function journeyRewardMessage(result: JourneyRewardResult, clubName: string): string {
  const verb = result.status === 'improved' ? 'upgrades in' : result.status === 'kept' ? 'stays in' : 'joins';
  return `${result.card.name} ${verb} ${clubName} as a ${result.card.overall} OVR Story card. Value: 0.`;
}
