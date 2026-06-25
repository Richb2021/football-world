/**
 * Manager Mode — local-first per-slot saves (mirrors saves.ts/careerSlots).
 * Registered for cloud sync in App.applyIdentity alongside the other modes.
 */
import { makeSaveSlots, type SaveSlots } from '../../net/saveSlots';
import { anyTeamById } from '../../data/teams';
import type { ManagerState, SeasonTarget, Sentiment, BoardState } from './types';
import { clamp } from './types';

function defaultSentiment(): Sentiment {
  return { fans: 55, media: 55, squad: 60, pressure: 30 };
}
function defaultTarget(): SeasonTarget {
  return { tier: 1, minPosition: 1, description: 'Survive the season', kind: 'survival' };
}
function defaultBoard(): BoardState {
  return { confidence: 60, target: defaultTarget(), warnings: 0 };
}

/** Idempotent post-load fixups: guarantees every field exists so old saves load. */
export function ensureManagerSystems(s: ManagerState): ManagerState {
  s.sentiment = s.sentiment ?? defaultSentiment();
  s.sentiment.fans = clamp(s.sentiment.fans ?? 55);
  s.sentiment.media = clamp(s.sentiment.media ?? 55);
  s.sentiment.squad = clamp(s.sentiment.squad ?? 60);
  s.sentiment.pressure = clamp(s.sentiment.pressure ?? 30);
  s.board = s.board ?? defaultBoard();
  s.board.confidence = clamp(s.board.confidence ?? 60);
  s.board.target = s.board.target ?? defaultTarget();
  s.board.warnings = s.board.warnings ?? 0;
  s.inbox = s.inbox ?? { messages: [] };
  if (!Array.isArray(s.inbox.messages)) s.inbox = { messages: [] };
  s.headlines = s.headlines ?? [];
  s.jobHistory = s.jobHistory ?? [];
  s.lastSeasonReview = s.lastSeasonReview ?? [];
  s.scoutAssignments = s.scoutAssignments ?? [];
  s.scoutedPlayers = s.scoutedPlayers ?? {};
  s.results = s.results ?? {};
  s.fixtures = s.fixtures ?? {};
  s.leagueTeamIds = s.leagueTeamIds ?? {};
  s.clubTier = s.clubTier ?? {};
  s.clubLeagueId = s.clubLeagueId ?? {};
  s.windowPhase = s.windowPhase ?? 'closed';
  s.trainingFocus = s.trainingFocus ?? 'balanced';
  s.pendingUserFixture = s.pendingUserFixture ?? null;
  s.reputation = s.reputation ?? 40;
  s.phase = s.phase ?? 'pre-season';
  s.headlines = s.headlines.slice(-60);
  return s;
}

function summarise(s: ManagerState) {
  const name = anyTeamById(s.userClubId)?.short ?? s.userClubId;
  const summary =
    s.phase === 'in-season' ? `Season ${s.season} · Matchday ${s.matchday + 1}`
      : s.phase === 'sacked' ? 'Sacked — seeking a new club'
        : s.phase === 'job-offers' ? 'Job offers available'
          : `Season ${s.season} · ${s.phase}`;
  return { name: `${name} · Manager`, summary };
}

export const managerSlots: SaveSlots<ManagerState> = makeSaveSlots<ManagerState>('manager', {
  cap: 6,
  summarise,
  revive: ensureManagerSystems,
  valid: (s) => !!s && s.version === 1,
});

export function saveManager(s: ManagerState): void {
  managerSlots.save(s);
}
export function loadManager(): ManagerState | null {
  return managerSlots.load();
}
export function clearManager(): void {
  const id = managerSlots.active();
  if (id) managerSlots.remove(id);
}
