/**
 * Journey State Management
 * Handles save/load, state updates, and progression tracking
 */

import type { JourneyState, ChoiceConsequence, TrainingFocus, PlayerStats, DialogueEntry, StoryCampaignId } from './types';
import type { PhoneInbox } from '../meta/metaTypes';
import { getEpisodeById } from './episodes';
import { makeSaveSlots, type SaveSlots } from '../net/saveSlots';
import { storyCampaignById } from './campaigns';

export function createNewJourney(
  playerName: string,
  playerPosition: 'GK' | 'DF' | 'MF' | 'FW',
  clubId: string,
  campaignId: StoryCampaignId = 'international-cup-story',
): JourneyState {
  const campaignStart = getCampaignStart(campaignId);
  return {
    campaignId,
    episodeId: campaignStart.episodeId,
    sceneId: campaignStart.sceneId,
    storyRole: campaignStart.role,
    playerName,
    playerPosition,
    clubId,
    stats: getCampaignInitialStats(campaignId, playerPosition),
    relationships: getCampaignInitialRelationships(campaignId),
    reputation: getCampaignInitialReputation(campaignId),
    storyFlags: {
      [`campaign_${campaignId}_started`]: true,
    },
    inventory: [],
    trainingFocus: 'balanced',
    matchPerformance: [],
    episodeHistory: [],
    storyPressure: getCampaignInitialPressure(campaignId),
    storyMorale: getCampaignInitialMorale(campaignId),
    pressPressure: getCampaignInitialPressPressure(campaignId),
    fanPressure: getCampaignInitialFanPressure(campaignId),
    injuryRisk: getCampaignInitialInjuryRisk(campaignId),
    isComplete: false,
    inbox: getCampaignInitialInbox(campaignId, playerName),
    contactMode: storyCampaignById(campaignId).contactMode,
  };
}

export function storyAutoName(s: JourneyState): string {
  const campaign = storyCampaignById(s.campaignId ?? 'international-cup-story');
  return `${campaign.seasonLabel} · ${s.playerName}`;
}

function storySummary(s: JourneyState): string {
  const campaign = storyCampaignById(s.campaignId ?? 'international-cup-story');
  if (s.isComplete) return `${campaign.title} · Complete`;
  return `${campaign.title} · Ep ${s.episodeHistory.length + 1}`;
}

export const storySlots: SaveSlots<JourneyState> = makeSaveSlots<JourneyState>('story', {
  cap: 6,
  summarise: (s) => ({
    name: storyAutoName(s),
    summary: storySummary(s),
    extra: { campaignId: s.campaignId ?? 'international-cup-story' },
  }),
  revive: (s) => migrateJourneyState(s),
  // migrateJourneyState repairs partial saves, so no valid guard is needed
});

export function loadJourney(): JourneyState | null {
  return storySlots.load();
}

export function saveJourney(state: JourneyState): void {
  storySlots.save(state);
}

export function clearJourney(): void {
  const id = storySlots.active();
  if (id) storySlots.remove(id);
}

export function applyConsequences(
  state: JourneyState,
  consequences: ChoiceConsequence[]
): JourneyState {
  const newState = { ...state };

  for (const consequence of consequences) {
    switch (consequence.type) {
      case 'relationship':
        newState.relationships = {
          ...newState.relationships,
          [consequence.npcId]: clamp(
            (newState.relationships[consequence.npcId] || 0) + consequence.change,
            -10,
            10
          )
        };
        break;

      case 'stat':
        newState.stats = {
          ...newState.stats,
          [consequence.stat]: clamp(
            newState.stats[consequence.stat] + consequence.change,
            40,
            99
          )
        };
        break;

      case 'reputation':
        newState.reputation = clamp(newState.reputation + consequence.change, 0, 100);
        break;

      case 'flag':
        newState.storyFlags = {
          ...newState.storyFlags,
          [consequence.flag]: consequence.value
        };
        break;

      case 'item':
        if (consequence.action === 'add') {
          newState.inventory = [...newState.inventory, consequence.item];
        } else {
          newState.inventory = newState.inventory.filter(i => i !== consequence.item);
        }
        break;

      case 'trainingFocus':
        newState.trainingFocus = consequence.focus;
        break;

      case 'storyPressure':
        newState.storyPressure = clamp((newState.storyPressure ?? 0) + consequence.change, -10, 10);
        break;

      case 'storyMorale':
        newState.storyMorale = clamp((newState.storyMorale ?? 0) + consequence.change, -10, 10);
        break;

      case 'pressPressure':
        newState.pressPressure = clamp((newState.pressPressure ?? getCampaignInitialPressPressure(newState.campaignId)) + consequence.change, -10, 10);
        break;

      case 'fanPressure':
        newState.fanPressure = clamp((newState.fanPressure ?? getCampaignInitialFanPressure(newState.campaignId)) + consequence.change, -10, 10);
        break;

      case 'injuryRisk':
        newState.injuryRisk = clamp((newState.injuryRisk ?? 0) + consequence.change, 0, 10);
        break;

      case 'simulatedMatch': {
        const entry = {
          matchId: consequence.matchId,
          date: consequence.date ?? storyDate(newState.campaignId),
          opponent: consequence.opponent,
          result: consequence.result,
          score: consequence.score,
          minutesPlayed: 90,
          rating: consequence.rating ?? simulatedRating(consequence.result),
          goals: consequence.score[0] > consequence.score[1] ? 1 : 0,
          assists: consequence.result === 'loss' ? 0 : 1,
          keyPasses: consequence.result === 'loss' ? 1 : 3,
          tackles: newState.storyRole === 'manager' ? 0 : newState.playerPosition === 'DF' ? 4 : 2,
          saves: newState.playerPosition === 'GK' ? Math.max(1, consequence.score[1] + 1) : undefined,
        };
        newState.matchPerformance = [...newState.matchPerformance, entry];
        newState.storyFlags = {
          ...newState.storyFlags,
          [`journey_match_${consequence.matchId}_played`]: true,
          ...(consequence.flag ? { [consequence.flag]: true } : {}),
        };
        newState.storyPressure = clamp(
          (newState.storyPressure ?? 0) + (consequence.pressureChange ?? 0),
          -10,
          10,
        );
        newState.storyMorale = clamp(
          (newState.storyMorale ?? 0) + (consequence.moraleChange ?? 0),
          -10,
          10,
        );
        newState.pressPressure = clamp(
          (newState.pressPressure ?? getCampaignInitialPressPressure(newState.campaignId)) + simulatedPressDelta(consequence.result),
          -10,
          10,
        );
        newState.fanPressure = clamp(
          (newState.fanPressure ?? getCampaignInitialFanPressure(newState.campaignId)) + simulatedFanDelta(consequence.result),
          -10,
          10,
        );
        if (consequence.reputationChange) {
          newState.reputation = clamp(newState.reputation + consequence.reputationChange, 0, 100);
        }
        break;
      }

      case 'nextEpisode':
        // Episode transition handled separately
        break;
    }
  }

  return newState;
}

export function advanceToScene(state: JourneyState, sceneId: string): JourneyState {
  const newState = { ...state, sceneId };
  saveJourney(newState);
  return newState;
}

export function completeEpisode(state: JourneyState, nextEpisodeId?: string): JourneyState {
  const newState = {
    ...state,
    episodeHistory: [...state.episodeHistory, state.episodeId],
    episodeId: nextEpisodeId || state.episodeId,
    isComplete: !nextEpisodeId
  };
  saveJourney(newState);
  return newState;
}

export function canMakeChoice(state: JourneyState, condition?: (state: JourneyState) => boolean): boolean {
  if (!condition) return true;
  return condition(state);
}

export function getAvailableChoices<T extends { condition?: (state: JourneyState) => boolean }>(
  state: JourneyState,
  choices: T[]
): T[] {
  return choices.filter(choice => canMakeChoice(state, choice.condition));
}

export function getAvailableDialogue(
  state: JourneyState,
  dialogue: DialogueEntry[]
): DialogueEntry[] {
  return dialogue.filter(entry => canMakeChoice(state, entry.condition));
}

export function processSceneEntry(state: JourneyState, sceneId: string): JourneyState {
  const episode = getEpisodeById(state.episodeId);
  if (!episode) return state;

  const scene = episode.scenes.find(s => s.id === sceneId);
  if (!scene || !scene.onEnter) return state;

  return scene.onEnter(state);
}

export function getOverallRating(state: JourneyState): number {
  const stats = state.stats;
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  return Math.round(total / 7);
}

export function getTrainingBonus(focus: TrainingFocus, stat: keyof PlayerStats): number {
  const bonuses: Record<TrainingFocus, Partial<Record<keyof PlayerStats, number>>> = {
    balanced: { pace: 1, shooting: 1, passing: 1, dribbling: 1, defending: 1, physical: 1, mental: 1 },
    fitness: { pace: 2, physical: 3, mental: 1 },
    technical: { shooting: 2, passing: 2, dribbling: 2 },
    tactical: { mental: 3, passing: 1, defending: 2 },
    mental: { mental: 3, physical: 1 }
  };
  const focusBonuses = bonuses[focus];
  return (focusBonuses[stat as keyof typeof focusBonuses] as number) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCampaignStart(campaignId: StoryCampaignId): { episodeId: string; sceneId: string; role: JourneyState['storyRole'] } {
  switch (campaignId) {
    case 'miners-cup-story':
      return { episodeId: 'mc_ep1_invite', sceneId: 'scene1_shift_end', role: 'player' };
    case 'first-eleven-story':
      return { episodeId: 'fe_ep1_challenge', sceneId: 'scene1_newspaper', role: 'player' };
    case 'last-dance-story':
      return { episodeId: 'ld_ep1_call', sceneId: 'scene1_academy', role: 'player' };
    case 'two-passports-story':
      return { episodeId: 'tp_ep1_snub', sceneId: 'scene1_squad_list', role: 'player' };
    case 'international-cup-story':
    default:
      return { episodeId: 'rtg_ep1_release', sceneId: 'scene1_hospital', role: 'player' };
  }
}

function getCampaignInitialStats(
  campaignId: StoryCampaignId,
  playerPosition: JourneyState['playerPosition'],
): PlayerStats {
  switch (campaignId) {
    case 'miners-cup-story':
      return {
        pace: 58,
        shooting: playerPosition === 'FW' ? 61 : 50,
        passing: playerPosition === 'MF' ? 66 : 54,
        dribbling: 53,
        defending: playerPosition === 'DF' ? 64 : 55,
        physical: 76,
        mental: 57,
      };
    case 'first-eleven-story':
      return {
        pace: 54,
        shooting: playerPosition === 'FW' ? 55 : 42,
        passing: playerPosition === 'MF' ? 58 : 50,
        dribbling: 47,
        defending: playerPosition === 'DF' ? 67 : 55,
        physical: 63,
        mental: 64,
      };
    case 'last-dance-story':
      return {
        pace: 48,
        shooting: 74,
        passing: 70,
        dribbling: 64,
        defending: 42,
        physical: 52,
        mental: 76,
      };
    case 'two-passports-story':
      return {
        pace: 72,
        shooting: playerPosition === 'FW' ? 69 : 58,
        passing: playerPosition === 'MF' ? 75 : 65,
        dribbling: 71,
        defending: playerPosition === 'DF' ? 70 : 55,
        physical: 68,
        mental: 54,
      };
    case 'international-cup-story':
    default:
      return {
        pace: 55,
        shooting: playerPosition === 'FW' ? 58 : 40,
        passing: playerPosition === 'MF' ? 58 : 45,
        dribbling: 50,
        defending: playerPosition === 'DF' ? 58 : 40,
        physical: 52,
        mental: 50
      };
  }
}

function getCampaignInitialRelationships(campaignId: StoryCampaignId): Record<string, number> {
  const shared = {
    manager_clough: 0,
    assistant_taylor: 0,
    physio_morris: 0,
    captain_whitlock: 0,
    dad: 5,
    teammate_stone: 0,
    teammate_webb: 0,
    scout_maddox: 0,
    youth_coach_maddox: 0,
    england_roommate_fox: 0,
    germany_captain_adler: 0,
    teammate_hargreaves: -1,
    agent_coyle: 0,
    reporter_local: 0,
    landlord_pub: 0,
    doctor_evans: 0,
    rival_malone: -1,
    club_secretary_banks: 0,
    mum: 5,
    opposition_scout_reid: 0
  };

  switch (campaignId) {
    case 'miners-cup-story':
      return {
        ...shared,
        mc_captain_eddie: 2,
        mc_secretary_hawthorn: 0,
        mc_foreman_doyle: -1,
        mc_wife_mary: 4,
        mc_organiser_bell: 0,
        mc_turin_clerk_luca: 0,
      };
    case 'first-eleven-story':
      return {
        ...shared,
        fe_captain_muir: 2,
        fe_secretary_mackay: 1,
        fe_newspaper_bell: 0,
        fe_english_captain_hart: -1,
        fe_goalkeeper_fergus: 0,
        fe_fa_messenger_alden: 0,
      };
    case 'last-dance-story':
      return {
        ...shared,
        ld_coach_baptiste: 1,
        ld_physio_mara: 1,
        ld_young_striker_elian: -1,
        ld_daughter_lina: 4,
        ld_president_santos: 0,
        ld_reporter_vega: 0,
        ld_captain_rui: 0,
      };
    case 'two-passports-story':
      return {
        ...shared,
        tp_birth_assistant_miller: -1,
        tp_heritage_manager_desrosiers: 0,
        tp_grandmother_ana: 5,
        tp_agent_reece: 1,
        tp_birth_teammate_brooks: 0,
        tp_heritage_captain_etienne: -1,
        tp_reporter_malik: 0,
      };
    case 'international-cup-story':
    default:
      return shared;
  }
}

function getCampaignInitialReputation(campaignId: StoryCampaignId): number {
  switch (campaignId) {
    case 'miners-cup-story':
      return 12;
    case 'first-eleven-story':
      return 8;
    case 'last-dance-story':
      return 42;
    case 'two-passports-story':
      return 22;
    case 'international-cup-story':
    default:
      return 20;
  }
}

function getCampaignInitialPressure(campaignId: StoryCampaignId): number {
  switch (campaignId) {
    case 'miners-cup-story':
      return 2;
    case 'first-eleven-story':
      return 1;
    case 'last-dance-story':
      return 2;
    case 'two-passports-story':
      return 1;
    case 'international-cup-story':
    default:
      return 0;
  }
}

function getCampaignInitialPressPressure(campaignId: StoryCampaignId): number {
  switch (campaignId) {
    case 'miners-cup-story':
      return 1;
    case 'first-eleven-story':
      return 3;
    case 'last-dance-story':
      return 4;
    case 'two-passports-story':
      return 3;
    case 'international-cup-story':
    default:
      return 1;
  }
}

function getCampaignInitialFanPressure(campaignId: StoryCampaignId): number {
  switch (campaignId) {
    case 'miners-cup-story':
      return 2;
    case 'first-eleven-story':
      return 1;
    case 'last-dance-story':
      return 5;
    case 'two-passports-story':
      return 2;
    case 'international-cup-story':
    default:
      return 0;
  }
}

function getCampaignInitialMorale(campaignId: StoryCampaignId): number {
  switch (campaignId) {
    case 'miners-cup-story':
      return -1;
    case 'first-eleven-story':
      return 1;
    case 'last-dance-story':
      return 1;
    case 'two-passports-story':
    case 'international-cup-story':
    default:
      return 0;
  }
}

function getCampaignInitialInjuryRisk(campaignId: StoryCampaignId): number {
  switch (campaignId) {
    case 'miners-cup-story':
      return 1;
    case 'last-dance-story':
      return 4;
    case 'two-passports-story':
    case 'international-cup-story':
    default:
      return 0;
  }
}

function getCampaignInitialInbox(campaignId: StoryCampaignId, playerName: string): PhoneInbox {
  switch (campaignId) {
    case 'miners-cup-story':
      return {
        messages: [
          { id: 'mc_wire_bell', from: 'Tournament Office', senderType: 'chairman', avatarSeed: 'mc_organiser_bell', time: 'Cable 1', order: 2, read: false,
            text: `${playerName}, invitation confirmed for Turin. No guarantee of reimbursement. Bring papers, boots, and men who will not wilt.` },
          { id: 'mc_wire_home', from: 'Mary', senderType: 'family', avatarSeed: 'mc_wife_mary', time: 'Cable 1', order: 1, read: false,
            text: 'Tommy, there is no line home once you leave the coast. If you spend the rent on this cup, win enough pride to feed us.' },
        ],
      };
    case 'first-eleven-story':
      return {
        messages: [
          { id: 'fe_wire_challenge', from: 'Newspaper Desk', senderType: 'media', avatarSeed: 'fe_newspaper_bell', time: 'Notice', order: 2, read: false,
            text: `${playerName}, the London challenge is printed again. If Scotland answers, it must be with eleven men who look like a country.` },
          { id: 'fe_wire_club', from: 'Club Secretary', senderType: 'assistant', avatarSeed: 'fe_secretary_mackay', time: 'Notice', order: 1, read: false,
            text: 'Hamilton Crescent is secured in pencil, not ink. Keep the men together until the English party steps off the train.' },
        ],
      };
    case 'last-dance-story':
      return {
        messages: [
          { id: 'ld_m_president', from: 'Federation', senderType: 'chairman', avatarSeed: 'ld_president_santos', time: 'Day 1', order: 2, read: false,
            text: `${playerName}, the whole country knows what you gave us. We would not ask if this was not history. Please take Coach Baptiste's call.` },
          { id: 'ld_m_home', from: 'Lina', senderType: 'family', avatarSeed: 'ld_daughter_lina', time: 'Day 1', order: 1, read: false,
            text: 'Dad, do not let them turn your knee into a flag. Come home before you answer them.' },
        ],
      };
    case 'two-passports-story':
      return {
        messages: [
          { id: 'tp_m_reece', from: 'Reece', senderType: 'agent', avatarSeed: 'tp_agent_reece', time: 'Squad Day', order: 2, read: false,
            text: `${playerName}, breathe first. You are not on the list. I have two federations calling and neither of them gets an answer while you are angry.` },
          { id: 'tp_m_ana', from: 'Ana', senderType: 'family', avatarSeed: 'tp_grandmother_ana', time: 'Squad Day', order: 1, read: false,
            text: 'I saw the squad. Come eat before the phones start deciding who you are.' },
        ],
      };
    case 'international-cup-story':
    default:
      return {
        messages: [
          { id: 'm_welcome', from: 'Agent — Coyle', senderType: 'agent', avatarSeed: 'agent_coyle', time: 'Day 1', order: 2, read: false,
            text: `${playerName}, it's Coyle. Big things ahead, son. Keep your head down, impress the gaffer, and leave the business side to me. We're going to the top.` },
          { id: 'm_home', from: 'Home', senderType: 'family', avatarSeed: 'dad', time: 'Day 1', order: 1, read: false,
            text: `Proud of you, kid. Whatever happens out there, your mum and I are behind you every step. Now go and show them what you've got. x` },
        ],
      };
  }
}

function migrateJourneyState(saved: Partial<JourneyState>): JourneyState {
  const campaignId = saved.campaignId ?? 'international-cup-story';
  const migrated = {
    ...saved,
    campaignId,
    storyRole: saved.storyRole ?? 'player',
    storyPressure: saved.storyPressure ?? 0,
    storyMorale: saved.storyMorale ?? 0,
    pressPressure: clamp(saved.pressPressure ?? getCampaignInitialPressPressure(campaignId), -10, 10),
    fanPressure: clamp(saved.fanPressure ?? getCampaignInitialFanPressure(campaignId), -10, 10),
    injuryRisk: clamp(saved.injuryRisk ?? 0, 0, 10),
    storyFlags: saved.storyFlags ?? {},
    relationships: saved.relationships ?? {},
    inventory: saved.inventory ?? [],
    matchPerformance: saved.matchPerformance ?? [],
    episodeHistory: saved.episodeHistory ?? [],
    isComplete: saved.isComplete ?? false,
    contactMode: saved.contactMode ?? storyCampaignById(campaignId).contactMode,
  } as JourneyState;
  return migrated;
}

function storyDate(campaignId: StoryCampaignId): string {
  switch (campaignId) {
    case 'miners-cup-story':
      return 'April 1909';
    case 'first-eleven-story':
      return 'November 1872';
    case 'last-dance-story':
    case 'two-passports-story':
      return 'June 2026';
    case 'international-cup-story':
    default:
      return 'August 2026';
  }
}

function simulatedRating(result: 'win' | 'draw' | 'loss'): number {
  return result === 'win' ? 7.4 : result === 'draw' ? 6.6 : 5.8;
}

function simulatedPressDelta(result: 'win' | 'draw' | 'loss'): number {
  if (result === 'win') return -1;
  if (result === 'draw') return 1;
  return 2;
}

function simulatedFanDelta(result: 'win' | 'draw' | 'loss'): number {
  return result === 'win' ? 1 : 2;
}
