import type { Career } from './career';
import type { PhoneInbox, PhoneMessage } from '../meta/metaTypes';
import type { TeamData } from '../sim/types';

export type CupNarrativeArcType =
  | 'press-feud'
  | 'squad-unity'
  | 'star-pressure'
  | 'bench-unrest'
  | 'board-pressure'
  | 'underdog-run'
  | 'captain-trust'
  | 'selection-scrutiny'
  | 'favourite-pressure'
  | 'golden-generation'
  | 'fairytale-run'
  | 'federation-panic'
  | 'defensive-backlash'
  | 'one-result-from-history';

export type NewsTone = 'positive' | 'negative' | 'neutral' | 'sensational';
export type ExpectationTier = 'favourite' | 'contender' | 'dark-horse' | 'outsider' | 'minnow';
export type PerformanceMood = 'collapse' | 'underperforming' | 'par' | 'overperforming' | 'heroic';

export interface TeamNarrativeProfile {
  teamId: string;
  teamName: string;
  strength: number;
  expectationTier: ExpectationTier;
  mediaPressure: number;
  fanPatience: number;
  boardExpectation: number;
  underdogAppeal: number;
  starReliance: number;
}

export interface MatchPerformanceContext {
  team: TeamNarrativeProfile;
  opponent: TeamNarrativeProfile;
  score: [number, number];
  goalDiff: number;
  expectedGoalDiff: number;
  surprise: number;
  mood: PerformanceMood;
  stageWeight: number;
  isKnockout: boolean;
}

export interface CupNarrativeArc {
  id: string;
  type: CupNarrativeArcType;
  heat: number;
  startedStep: number;
  relatedPlayer?: string;
  relatedOpponent?: string;
  resolved?: boolean;
}

export interface NewsHeadline {
  id: string;
  title: string;
  source: string;
  tone: NewsTone;
  body?: string;
  step: number;
  matchNumber?: number;
  arcId?: string;
}

export interface CupNarrativeState {
  arcs: CupNarrativeArc[];
  headlines: NewsHeadline[];
  requiredMessageIds: string[];
  pendingTeamEvents: string[];
  lastGeneratedStep: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const cleanId = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

export function createEmptyCupNarrative(step = 0): CupNarrativeState {
  return {
    arcs: [],
    headlines: [],
    requiredMessageIds: [],
    pendingTeamEvents: [],
    lastGeneratedStep: step,
  };
}

export function isInternationalCupCareer(career: Pick<Career, 'mode' | 'leagueId'>): boolean {
  return career.mode === 'cup' && career.leagueId === 'international-cup';
}

export function expectationTierForStrength(strength: number): ExpectationTier {
  if (strength >= 88) return 'favourite';
  if (strength >= 82) return 'contender';
  if (strength >= 76) return 'dark-horse';
  if (strength >= 71) return 'outsider';
  return 'minnow';
}

export function teamNarrativeProfile(team: TeamData): TeamNarrativeProfile {
  const tier = expectationTierForStrength(team.strength);
  const pressureByTier: Record<ExpectationTier, number> = {
    favourite: 86,
    contender: 74,
    'dark-horse': 58,
    outsider: 38,
    minnow: 22,
  };
  const patienceByTier: Record<ExpectationTier, number> = {
    favourite: 24,
    contender: 36,
    'dark-horse': 52,
    outsider: 68,
    minnow: 82,
  };
  return {
    teamId: team.id,
    teamName: team.name,
    strength: team.strength,
    expectationTier: tier,
    mediaPressure: pressureByTier[tier],
    fanPatience: patienceByTier[tier],
    boardExpectation: pressureByTier[tier] + (tier === 'favourite' ? 6 : 0),
    underdogAppeal: 100 - pressureByTier[tier],
    starReliance: Math.max(15, Math.min(85, 100 - team.strength + (tier === 'favourite' ? 24 : 12))),
  };
}

export function stageWeightForStep(step: number): number {
  if (step >= 7) return 1.45;
  if (step >= 5) return 1.3;
  if (step >= 3) return 1.15;
  return 1;
}

export function assessMatchPerformance(team: TeamData, opponent: TeamData, score: [number, number], step = 0): MatchPerformanceContext {
  const profile = teamNarrativeProfile(team);
  const opponentProfile = teamNarrativeProfile(opponent);
  const goalDiff = score[0] - score[1];
  const expectedGoalDiff = (team.strength - opponent.strength) / 9;
  const surprise = (goalDiff - expectedGoalDiff) * stageWeightForStep(step);
  const mood: PerformanceMood = surprise <= -2
    ? 'collapse'
    : surprise <= -0.85
      ? 'underperforming'
      : surprise >= 2
        ? 'heroic'
        : surprise >= 0.85
          ? 'overperforming'
          : 'par';
  return {
    team: profile,
    opponent: opponentProfile,
    score,
    goalDiff,
    expectedGoalDiff,
    surprise,
    mood,
    stageWeight: stageWeightForStep(step),
    isKnockout: step >= 3,
  };
}

export function ensureCupNarrative(career: Career): CupNarrativeState {
  career.cupNarrative ??= createEmptyCupNarrative(career.step ?? 0);
  career.cupNarrative.arcs ??= [];
  career.cupNarrative.headlines ??= [];
  career.cupNarrative.requiredMessageIds ??= [];
  career.cupNarrative.pendingTeamEvents ??= [];
  career.cupNarrative.lastGeneratedStep ??= career.step ?? 0;
  return career.cupNarrative;
}

export function heatCupArc(
  career: Career,
  type: CupNarrativeArcType,
  delta: number,
  opts: { relatedPlayer?: string; relatedOpponent?: string; resolved?: boolean } = {},
): CupNarrativeArc {
  const state = ensureCupNarrative(career);
  const arc = state.arcs.find((candidate) => (
    candidate.type === type
    && !candidate.resolved
    && candidate.relatedPlayer === opts.relatedPlayer
  )) ?? {
    id: `${type}-${state.arcs.length + 1}`,
    type,
    heat: 0,
    startedStep: career.step ?? 0,
    relatedPlayer: opts.relatedPlayer,
    relatedOpponent: opts.relatedOpponent,
  };

  arc.heat = clamp(arc.heat + delta, 0, 100);
  if (opts.relatedOpponent && !arc.relatedOpponent) arc.relatedOpponent = opts.relatedOpponent;
  if (opts.resolved !== undefined) arc.resolved = opts.resolved;
  if (!state.arcs.includes(arc)) state.arcs.push(arc);
  return arc;
}

export function activeArcHeat(career: Career, type: CupNarrativeArcType): number {
  return ensureCupNarrative(career).arcs
    .filter((arc) => arc.type === type && !arc.resolved)
    .reduce((sum, arc) => sum + arc.heat, 0);
}

export function addCupHeadline(
  career: Career,
  input: Omit<NewsHeadline, 'id' | 'step'> & { id?: string; step?: number },
): NewsHeadline {
  const state = ensureCupNarrative(career);
  const title = input.title.trim();
  const headline: NewsHeadline = {
    id: input.id ?? `${career.step ?? 0}-${cleanId(title)}-${state.headlines.length + 1}`,
    title,
    source: input.source,
    tone: input.tone,
    body: input.body,
    step: input.step ?? career.step ?? 0,
    matchNumber: input.matchNumber,
    arcId: input.arcId,
  };
  state.headlines.unshift(headline);
  state.headlines = state.headlines.slice(0, 24);
  career.news ??= [];
  career.news.push(headline.title);
  career.news = career.news.slice(-20);
  return headline;
}

export function unresolvedRequiredMessages(inbox?: PhoneInbox): PhoneMessage[] {
  return (inbox?.messages ?? []).filter((msg) => (
    msg.requiresResponse === true
    && !!msg.replies?.length
    && !msg.replied
  ));
}

export function cappedOffFieldMomentumDelta(delta: number, major = false): number {
  return clamp(delta, major ? -6 : -4, major ? 6 : 4);
}
