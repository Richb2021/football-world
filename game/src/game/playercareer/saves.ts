/** Player Career — local-first per-slot saves (mirrors manager saves). */
import { makeSaveSlots, type SaveSlots } from '../../net/saveSlots';
import { ensureManagerSystems } from '../manager/saves';
import type { PlayerCareerState } from './types';

/** Idempotent post-load fixups: revive the embedded world and default any missing field. */
export function ensurePlayerSystems(pcs: PlayerCareerState): PlayerCareerState {
  if (pcs.world) ensureManagerSystems(pcs.world);
  pcs.reputation = pcs.reputation ?? 40;
  pcs.trainingXp = pcs.trainingXp ?? 0;
  pcs.trainingFocus = pcs.trainingFocus ?? 'balanced';
  pcs.apps = pcs.apps ?? 0;
  pcs.goals = pcs.goals ?? 0;
  pcs.assists = pcs.assists ?? 0;
  pcs.avgRating = pcs.avgRating ?? 0;
  pcs.careerApps = pcs.careerApps ?? 0;
  pcs.careerGoals = pcs.careerGoals ?? 0;
  pcs.careerAssists = pcs.careerAssists ?? 0;
  pcs.internationalCaps = pcs.internationalCaps ?? 0;
  pcs.internationalGoals = pcs.internationalGoals ?? 0;
  pcs.internationalEligible = pcs.internationalEligible ?? false;
  pcs.history = pcs.history ?? [];
  pcs.headlines = pcs.headlines ?? [];
  if (!pcs.inbox || !Array.isArray(pcs.inbox.messages)) pcs.inbox = { messages: [] };
  pcs.phase = pcs.phase ?? 'in-season';
  pcs.lastReview = pcs.lastReview ?? [];
  return pcs;
}

function summarise(pcs: PlayerCareerState) {
  const club = pcs.world?.userClubId ?? '?';
  const summary = pcs.phase === 'retired'
    ? 'Retired'
    : `Season ${pcs.world?.season ?? 1} · MD ${(pcs.world?.matchday ?? 0) + 1} · ${pcs.apps} apps`;
  return { name: `${pcs.playerName} (${pcs.pos})`, summary: `${club} · ${summary}` };
}

export const playerSlots: SaveSlots<PlayerCareerState> = makeSaveSlots<PlayerCareerState>('player-career', {
  cap: 6,
  summarise,
  revive: ensurePlayerSystems,
  valid: (pcs) => !!pcs && pcs.version === 1,
});

export function savePlayerCareer(pcs: PlayerCareerState): void {
  playerSlots.save(pcs);
}
export function loadPlayerCareer(): PlayerCareerState | null {
  return playerSlots.load();
}
