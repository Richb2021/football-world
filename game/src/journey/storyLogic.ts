import { applyConsequences } from './state';
import type { ChoiceConsequence, JourneyState, MatchHistoryEntry, StoryGate, StoryRoute } from './types';

export function getLatestMatchEntry(state: JourneyState, matchId: string): MatchHistoryEntry | undefined {
  for (let index = state.matchPerformance.length - 1; index >= 0; index--) {
    const entry = state.matchPerformance[index];
    if (entry.matchId === matchId) {
      return entry;
    }
  }
  return undefined;
}

export function evaluateStoryGate(state: JourneyState, gate: StoryGate): boolean {
  switch (gate.type) {
    case 'flag':
      return !!state.storyFlags[gate.flag] === (gate.value ?? true);
    case 'relationship':
      return inRange(state.relationships[gate.npcId] ?? 0, gate.min, gate.max);
    case 'reputation':
      return inRange(state.reputation, gate.min, gate.max);
    case 'stat':
      return inRange(state.stats[gate.stat], gate.min, gate.max);
    case 'storyPressure':
      return inRange(state.storyPressure ?? 0, gate.min, gate.max);
    case 'storyMorale':
      return inRange(state.storyMorale ?? 0, gate.min, gate.max);
    case 'pressPressure':
      return inRange(state.pressPressure ?? 0, gate.min, gate.max);
    case 'fanPressure':
      return inRange(state.fanPressure ?? 0, gate.min, gate.max);
    case 'injuryRisk':
      return inRange(state.injuryRisk ?? 0, gate.min, gate.max);
    case 'matchResult':
      return getLatestMatchEntry(state, gate.matchId)?.result === gate.result;
    case 'matchMargin': {
      const entry = getLatestMatchEntry(state, gate.matchId);
      if (!entry) return false;

      const margin = playerPerspectiveMargin(entry);
      return margin === undefined ? false : inRange(margin, gate.min, gate.max);
    }
  }
}

export function evaluateStoryGates(state: JourneyState, gates: StoryGate[] = []): boolean {
  return gates.every((gate) => evaluateStoryGate(state, gate));
}

export function canUseStoryEntry<T extends StoryEntryCandidate>(state: JourneyState, entry: T): boolean {
  return (!entry.condition || entry.condition(state)) && evaluateStoryGates(state, entry.gates);
}

export function getAvailableStoryEntries<T extends StoryEntryCandidate>(state: JourneyState, entries: T[]): T[] {
  return entries.filter((entry) => canUseStoryEntry(state, entry));
}

export function resolveStoryRoute(
  state: JourneyState,
  routes: StoryRoute[] | undefined,
  fallbackSceneId: string,
): StoryRoute {
  return routes?.find((route) => evaluateStoryGates(state, route.gates)) ?? { nextSceneId: fallbackSceneId };
}

export function applyRouteConsequences(
  state: JourneyState,
  consequences: ChoiceConsequence[] | undefined,
): JourneyState {
  if (!consequences?.length) {
    return state;
  }
  return applyConsequences(state, consequences);
}

interface StoryEntryCandidate {
  condition?: (state: JourneyState) => boolean;
  gates?: StoryGate[];
}

function inRange(value: number, min?: number, max?: number): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

function playerPerspectiveMargin(entry: MatchHistoryEntry): number | undefined {
  if (entry.goalMargin !== undefined) return entry.goalMargin;
  if (!entry.score) return undefined;
  const absoluteMargin = Math.abs(entry.score[0] - entry.score[1]);
  if (entry.result === 'win') return absoluteMargin;
  if (entry.result === 'loss') return -absoluteMargin;
  return 0;
}
