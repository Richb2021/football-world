import type { PhoneMessage } from '../meta/metaTypes';
import { getLatestMatchEntry } from './storyLogic';
import type { DialogueEntry, JourneyMatchId, JourneyState, MatchHistoryEntry, Scene, StoryCampaignId } from './types';

export interface StoryNarrativePulse {
  id: string;
  priority: number;
  dialogue: DialogueEntry[];
  message: Omit<PhoneMessage, 'id' | 'read'>;
}

interface StoryPulseTemplate {
  id: string;
  priority: number;
  when: (state: JourneyState, sceneId: string) => boolean;
  dialogue: (state: JourneyState) => DialogueEntry[];
  message: (state: JourneyState) => Omit<PhoneMessage, 'id' | 'read'>;
}

const PULSE_LIMIT = 2;

export function storyNarrativePulses(state: JourneyState, sceneId: string): StoryNarrativePulse[] {
  return STORY_PULSES
    .filter((pulse) => pulse.when(state, sceneId))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, PULSE_LIMIT)
    .map((pulse) => ({
      id: pulse.id,
      priority: pulse.priority,
      dialogue: pulse.dialogue(state),
      message: pulse.message(state),
    }));
}

export function enrichSceneWithStoryNarrative(scene: Scene, state: JourneyState): Scene {
  const pulses = storyNarrativePulses(state, scene.id);
  if (!pulses.length) return scene;
  return {
    ...scene,
    dialogue: [
      ...scene.dialogue,
      ...pulses.flatMap((pulse) => pulse.dialogue),
    ],
  };
}

export function applyStoryNarrativeOnSceneEnter(state: JourneyState, sceneId: string): JourneyState {
  let next = state;
  for (const pulse of storyNarrativePulses(state, sceneId)) {
    next = addPulseMessage(next, pulseFlag(sceneId, pulse.id), pulse.message);
  }
  return next;
}

export function applyStoryNarrativeAfterMatch(state: JourneyState, matchId: JourneyMatchId | string): JourneyState {
  const latest = getLatestMatchEntry(state, matchId);
  if (!latest) return state;
  const id = matchPulseId(matchId, latest.result);
  const flag = `story_match_pulse_${id}`;
  const message = matchPulseMessage(state, latest);
  const alreadyRecorded = state.storyFlags[flag] || state.inbox?.messages.some((candidate) => candidate.id === flag);
  const pressuredState = alreadyRecorded ? state : applyMatchPublicPressure(state, latest.result);
  return addPulseMessage(pressuredState, flag, message, true);
}

function pulseFlag(sceneId: string, pulseId: string): string {
  return `story_pulse_${sceneId}_${pulseId}`;
}

function matchPulseId(matchId: JourneyMatchId | string, result: MatchHistoryEntry['result']): string {
  if (result === 'loss') return `${matchId}_loss_reckoning`;
  if (result === 'draw') return `${matchId}_knife_edge`;
  return `${matchId}_belief_surge`;
}

function addPulseMessage(
  state: JourneyState,
  flag: string,
  message: Omit<PhoneMessage, 'id' | 'read'>,
  prepend = false,
): JourneyState {
  if (state.storyFlags[flag] || state.inbox?.messages.some((candidate) => candidate.id === flag)) {
    return { ...state, storyFlags: { ...state.storyFlags, [flag]: true } };
  }
  const inbox = {
    messages: [
      ...(prepend ? [{ ...message, id: flag, read: false }] : []),
      ...(state.inbox?.messages ?? []),
      ...(!prepend ? [{ ...message, id: flag, read: false }] : []),
    ],
  };
  return {
    ...state,
    inbox,
    storyFlags: {
      ...state.storyFlags,
      [flag]: true,
    },
  };
}

function applyMatchPublicPressure(state: JourneyState, result: MatchHistoryEntry['result']): JourneyState {
  return {
    ...state,
    pressPressure: clamp((state.pressPressure ?? 0) + matchPressDelta(result), -10, 10),
    fanPressure: clamp((state.fanPressure ?? 0) + matchFanDelta(result), -10, 10),
  };
}

function matchPressDelta(result: MatchHistoryEntry['result']): number {
  if (result === 'win') return -1;
  if (result === 'draw') return 1;
  return 2;
}

function matchFanDelta(result: MatchHistoryEntry['result']): number {
  return result === 'win' ? 1 : 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function timeLabel(state: JourneyState): string {
  switch (state.campaignId) {
    case 'miners-cup-story':
      return 'Cable';
    case 'first-eleven-story':
      return 'Notice';
    case 'last-dance-story':
    case 'two-passports-story':
      return 'Tonight';
    case 'international-cup-story':
    default:
      return 'Now';
  }
}

function campaignSender(state: JourneyState): { from: string; senderType: PhoneMessage['senderType']; avatarSeed: string } {
  switch (state.campaignId) {
    case 'miners-cup-story':
      return { from: 'Mary', senderType: 'family', avatarSeed: 'mc_wife_mary' };
    case 'first-eleven-story':
      return { from: 'Newspaper Desk', senderType: 'media', avatarSeed: 'fe_newspaper_bell' };
    case 'last-dance-story':
      return { from: 'Mara Lopes', senderType: 'physio', avatarSeed: 'ld_physio_mara' };
    case 'two-passports-story':
      return { from: 'Ana', senderType: 'family', avatarSeed: 'tp_grandmother_ana' };
    case 'international-cup-story':
    default:
      return { from: 'Agent - Coyle', senderType: 'agent', avatarSeed: 'agent_coyle' };
  }
}

function matchPulseMessage(state: JourneyState, latest: MatchHistoryEntry): Omit<PhoneMessage, 'id' | 'read'> {
  const sender = campaignSender(state);
  const resultText = latest.result === 'win'
    ? `The result against ${latest.opponent} changed the air around you. Enjoy it for a night, then protect it.`
    : latest.result === 'draw'
      ? `${latest.opponent} left everyone with just enough hope to argue about. The next choice matters more now.`
      : `${latest.opponent} hurt the story people wanted to tell. That does not end it, but nobody will give you another easy scene.`;
  return {
    ...sender,
    time: timeLabel(state),
    order: 900 + state.matchPerformance.length,
    text: resultText,
  };
}

function campaignIs(state: JourneyState, campaignId: StoryCampaignId): boolean {
  return state.campaignId === campaignId;
}

const STORY_PULSES: StoryPulseTemplate[] = [
  {
    id: 'rtg_tabloid_heat',
    priority: 92,
    when: (state) => campaignIs(state, 'international-cup-story') && (state.pressPressure ?? 0) >= 6,
    dialogue: () => [
      { speakerId: 'agent_coyle', text: '"The tabloids have found the comeback angle. Some want the miracle. Some want the fall. None of them get to write the match for you."' },
      { speakerId: 'reporter_local', text: '"One mistake and tomorrow calls it fantasy. One finish and they call it destiny."' },
    ],
    message: (state) => ({
      from: 'Agent - Coyle',
      senderType: 'agent',
      avatarSeed: 'agent_coyle',
      time: timeLabel(state),
      order: 805,
      text: 'Papers are sniffing around the knee, the release, all of it. Keep answers tight. The pitch is the only interview that matters today.',
    }),
  },
  {
    id: 'ld_nation_expectation',
    priority: 88,
    when: (state) => campaignIs(state, 'last-dance-story') && (state.fanPressure ?? 0) >= 7,
    dialogue: () => [
      { speakerId: 'ld_coach_baptiste', text: '"They are not just asking you to play. They are asking you to make every old shirt in the country young again."' },
      { speakerId: 'ld_daughter_lina', text: '"They sing like you belong to them. I need you to remember you belong to yourself first."' },
    ],
    message: (state) => ({
      from: 'Federation',
      senderType: 'chairman',
      avatarSeed: 'ld_president_santos',
      time: timeLabel(state),
      order: 815,
      text: 'The islands are stopping for this run. Every schoolyard is wearing your number. Give them courage, but do not let expectation steal your body.',
    }),
  },
  {
    id: 'tp_split_fanbases',
    priority: 87,
    when: (state) => campaignIs(state, 'two-passports-story') && ((state.pressPressure ?? 0) >= 6 || (state.fanPressure ?? 0) >= 6),
    dialogue: () => [
      { speakerId: 'tp_reporter_malik', text: '"Both fanbases are acting like betrayal is a scoreboard. They want one answer simple enough to shout."' },
      { speakerId: 'tp_grandmother_ana', text: '"When people shout at two flags, they forget there is one boy standing between them."' },
    ],
    message: (state) => ({
      from: 'Reece',
      senderType: 'agent',
      avatarSeed: 'tp_agent_reece',
      time: timeLabel(state),
      order: 825,
      text: 'Phones are split down the middle. Birth-country pundits say pride. Heritage radio says respect. Nobody gets to own your name unless you let them.',
    }),
  },
  {
    id: 'mc_coalfield_judgement',
    priority: 86,
    when: (state) => campaignIs(state, 'miners-cup-story') && ((state.fanPressure ?? 0) >= 6 || (state.pressPressure ?? 0) >= 5),
    dialogue: () => [
      { speakerId: 'mc_captain_eddie', text: '"Every pit village has made us brave in the telling. That is a fine thing, until a man misses home and feels like a coward."' },
      { speakerId: 'mc_foreman_doyle', text: '"The men back home are reading scores like wage slips. Win and you are sons of the coalfield. Lose and you are tourists."' },
    ],
    message: (state) => ({
      from: 'Mary',
      senderType: 'family',
      avatarSeed: 'mc_wife_mary',
      time: timeLabel(state),
      order: 835,
      text: 'The village has started gathering at the board for every wire. They want heroes, Tommy. Make sure the lads are still men under all that wanting.',
    }),
  },
  {
    id: 'fe_public_argument',
    priority: 85,
    when: (state) => campaignIs(state, 'first-eleven-story') && ((state.pressPressure ?? 0) >= 6 || (state.fanPressure ?? 0) >= 5),
    dialogue: () => [
      { speakerId: 'fe_newspaper_bell', text: '"The letters column is already fighting the match before the match has boots. Some call it progress. Some call it theatre."' },
      { speakerId: 'fe_secretary_mackay', text: '"Then we must give them something sturdier than argument. A fixture. A record. A beginning."' },
    ],
    message: (state) => ({
      from: 'Newspaper Desk',
      senderType: 'media',
      avatarSeed: 'fe_newspaper_bell',
      time: timeLabel(state),
      order: 845,
      text: 'The challenge is now public enough to embarrass both committees. That can save the match, or poison it before the first whistle.',
    }),
  },
  {
    id: 'rtg_last_chance_noise',
    priority: 80,
    when: (state) => campaignIs(state, 'international-cup-story') && (state.storyPressure >= 5 || (state.pressPressure ?? 0) >= 6),
    dialogue: () => [
      { speakerId: 'agent_coyle', text: '"Second chances are never quiet. Every whisper in that stand is asking whether the comeback is real or just good copy."' },
      { speakerId: 'narrator', text: 'The pressure is no longer background noise. It is in the boots, the phone, the pause before every answer.' },
    ],
    message: (state) => ({
      from: 'Agent - Coyle',
      senderType: 'agent',
      avatarSeed: 'agent_coyle',
      time: timeLabel(state),
      order: 810,
      text: 'Listen, the noise is getting louder because there is something here. Do not chase every headline. Give them one moment they cannot ignore.',
    }),
  },
  {
    id: 'ld_body_cost',
    priority: 90,
    when: (state) => campaignIs(state, 'last-dance-story') && state.injuryRisk >= 7,
    dialogue: () => [
      { speakerId: 'ld_physio_mara', text: '"Your knee is not a symbol. It is tissue, swelling, pain, and tomorrow morning. History will not limp for you."' },
      { speakerId: 'ld_daughter_lina', text: '"When they sing your name, I hear the stairs at home. I hear you pretending each step is fine."' },
    ],
    message: (state) => ({
      from: 'Mara Lopes',
      senderType: 'physio',
      avatarSeed: 'ld_physio_mara',
      time: timeLabel(state),
      order: 820,
      text: 'I have strapped that knee twice today. If you push through the wrong pain, the country gets its memory and you get the bill.',
    }),
  },
  {
    id: 'tp_identity_storm',
    priority: 82,
    when: (state) => campaignIs(state, 'two-passports-story') && (
      state.storyPressure >= 5
      || (state.pressPressure ?? 0) >= 6
      || (state.relationships.tp_birth_teammate_brooks ?? 0) <= -3
      || (state.relationships.tp_heritage_captain_etienne ?? 0) <= -3
    ),
    dialogue: () => [
      { speakerId: 'tp_grandmother_ana', text: '"A passport can open a door, but it cannot tell you which room feels like home."' },
      { speakerId: 'tp_agent_reece', text: '"Both federations want a badge in the photo. None of them have to live with your choice after the lights go off."' },
    ],
    message: (state) => ({
      from: 'Ana',
      senderType: 'family',
      avatarSeed: 'tp_grandmother_ana',
      time: timeLabel(state),
      order: 830,
      text: 'Do not let men in suits make your blood feel like paperwork. Choose with your whole chest, then stand where you choose.',
    }),
  },
  {
    id: 'mc_room_split',
    priority: 84,
    when: (state) => campaignIs(state, 'miners-cup-story') && (state.storyMorale <= -3 || state.storyPressure >= 5 || (state.fanPressure ?? 0) >= 7),
    dialogue: () => [
      { speakerId: 'mc_captain_eddie', text: '"Half the room is counting wages. Half is counting the miles home. None of them will say they are scared first."' },
      { speakerId: 'mc_wife_mary', text: '"Pride does not pay rent, Tommy. But if you are spending it, make sure the men know what they bought."' },
    ],
    message: (state) => ({
      from: 'Mary',
      senderType: 'family',
      avatarSeed: 'mc_wife_mary',
      time: timeLabel(state),
      order: 840,
      text: 'The coalfield is hearing two stories: heroes abroad and fools with no wages. Bring one truth home before the room splits.',
    }),
  },
  {
    id: 'fe_rules_under_fire',
    priority: 78,
    when: (state) => campaignIs(state, 'first-eleven-story') && (state.storyPressure >= 4 || (state.pressPressure ?? 0) >= 5),
    dialogue: () => [
      { speakerId: 'fe_newspaper_bell', text: '"If this match fails, the paper will not call it bad luck. It will call it proof the whole idea was too grand."' },
      { speakerId: 'fe_captain_muir', text: '"Then we make the idea smaller. Eleven men. One ball. No excuses for the English or for us."' },
    ],
    message: (state) => ({
      from: 'Newspaper Desk',
      senderType: 'media',
      avatarSeed: 'fe_newspaper_bell',
      time: timeLabel(state),
      order: 850,
      text: 'Rumour says the rules are already being questioned. If Scotland answers the challenge, make the first line worth printing.',
    }),
  },
  {
    id: 'belief_surge',
    priority: 40,
    when: (state) => state.storyMorale >= 5,
    dialogue: () => [
      { speakerId: 'narrator', text: 'The room has changed. Players linger a little longer, laugh a little louder, and look at the next match like it belongs to them.' },
    ],
    message: (state) => ({
      ...campaignSender(state),
      time: timeLabel(state),
      order: 860,
      text: 'You can feel it now. The story is no longer something happening to you. It is something the room believes it can shape.',
    }),
  },
];
