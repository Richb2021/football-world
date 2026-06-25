import type { Episode, JourneyState, NPC } from '../types';

export const lastDanceNPCs: NPC[] = [
  {
    id: 'ld_coach_baptiste',
    name: 'Coach Baptiste',
    role: 'manager',
    description: 'Cape Verde manager. Calm in public, ruthless about what history costs.',
    defaultPose: 'manager_overcoat',
  },
  {
    id: 'ld_physio_mara',
    name: 'Mara Lopes',
    role: 'physio',
    description: 'The national team physio. She knows the old knee better than the player wants.',
    defaultPose: 'physio_bag',
  },
  {
    id: 'ld_young_striker_elian',
    name: 'Elian Rocha',
    role: 'teammate',
    description: 'The fearless young striker whose World Cup shirt may be taken by a legend.',
    defaultPose: 'young_teammate_red_kit',
  },
  {
    id: 'ld_daughter_lina',
    name: 'Lina',
    role: 'family',
    description: 'His daughter. Proud, angry, and tired of football taking her father away.',
    defaultPose: 'family_casual',
  },
  {
    id: 'ld_president_santos',
    name: 'President Santos',
    role: 'manager',
    description: 'The federation president who treats the call-up like a national emergency.',
    defaultPose: 'chairman_suit',
  },
  {
    id: 'ld_reporter_vega',
    name: 'Ines Vega',
    role: 'media',
    description: 'A Cape Verdean reporter who loves the fairytale but will not ignore the cost.',
    defaultPose: 'reporter_notepad',
  },
  {
    id: 'ld_captain_rui',
    name: 'Rui Monteiro',
    role: 'teammate',
    description: 'The national captain. Protective of the dressing room and suspicious of nostalgia.',
    defaultPose: 'captain_red_kit',
  },
];

function say(speakerId: string, text: string, extra?: any) {
  return { speakerId, text, ...extra };
}

function choice(id: string, text: string, consequences: any[], nextSceneId: string, match?: any) {
  return { id, text, consequences, nextSceneId, match };
}

function flag(flag: string, value = true) {
  return { type: 'flag' as const, flag, value };
}

function rel(npcId: string, change: number) {
  return { type: 'relationship' as const, npcId, change };
}

function rep(change: number) {
  return { type: 'reputation' as const, change };
}

function morale(change: number) {
  return { type: 'storyMorale' as const, change };
}

function pressure(change: number) {
  return { type: 'storyPressure' as const, change };
}

function press(change: number) {
  return { type: 'pressPressure' as const, change };
}

function fan(change: number) {
  return { type: 'fanPressure' as const, change };
}

function injury(change: number) {
  return { type: 'injuryRisk' as const, change };
}

function stat(stat: 'pace' | 'shooting' | 'passing' | 'dribbling' | 'defending' | 'physical' | 'mental', change: number) {
  return { type: 'stat' as const, stat, change };
}

interface InboxMessageInput {
  id: string;
  from: string;
  senderType:
    | 'chairman' | 'agent' | 'captain' | 'teammate' | 'media'
    | 'family' | 'physio' | 'assistant' | 'fan' | 'pundit' | 'unknown';
  avatarSeed: string;
  time: string;
  order: number;
  text: string;
}

function pushMessages(...messages: InboxMessageInput[]) {
  return (state: JourneyState): JourneyState => {
    const inbox = (state.inbox ??= { messages: [] });
    for (const message of messages) {
      if (inbox.messages.some((existing) => existing.id === message.id)) continue;
      inbox.messages.push({ ...message, read: false });
    }
    return state;
  };
}

export const lastDanceEpisode1: Episode = {
  id: 'ld_ep1_call',
  title: 'The Island Calls',
  season: 2026,
  episodeNumber: 1,
  campaignId: 'last-dance-story',
  description: 'A retired legend is asked to return for Cape Verde\'s first World Cup. The country wants a miracle. His body wants peace.',
  scenes: [
    {
      id: 'scene1_academy',
      background: { type: 'training', variant: 'evening' },
      music: 'tense-ambient',
      characters: [
        { id: 'ld_coach_baptiste', position: 'left', pose: 'manager_overcoat', expression: 'determined' },
        { id: 'ld_president_santos', position: 'right', pose: 'chairman_suit', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'ld_m_lina_before_call',
        from: 'Lina',
        senderType: 'family',
        avatarSeed: 'ld_daughter_lina',
        time: '18:42',
        order: 1,
        text: 'If that federation car outside is for you, remember you promised me the academy came first now. Not the cameras. Not the songs. You.',
      }),
      dialogue: [
        say('ld_coach_baptiste', '"The draw is brutal. England. Germany. Us. Everyone says we are here for the postcards."'),
        say('ld_president_santos', '"They are asking for your shirt in every market. The country believes if you walk into that dressing room, we belong."'),
        say('ld_coach_baptiste', '"I am not asking for a statue. I am asking whether thirty minutes of the old you still exists."'),
      ],
      choices: [
        choice('ld-answer-mentor', 'Return only if Elian keeps the number nine shirt', [rel('ld_young_striker_elian', 3), rel('ld_coach_baptiste', 1), stat('mental', 2), press(-1), fan(-1), flag('ld_returned_as_mentor')], 'scene2_family'),
        choice('ld-answer-compete', 'Return to compete for the shirt outright', [rep(4), pressure(3), press(1), fan(2), morale(2), injury(1), flag('ld_returned_to_compete')], 'scene2_family'),
        choice('ld-answer-night', 'Ask for one night before the country gets an answer', [rel('ld_daughter_lina', 1), pressure(1), press(1), stat('mental', 1), flag('ld_asked_for_night')], 'scene2_family'),
      ],
    },
    {
      id: 'scene2_family',
      background: { type: 'home', variant: 'kitchen' },
      characters: [{ id: 'ld_daughter_lina', position: 'center', pose: 'family_casual', expression: 'concerned' }],
      dialogue: [
        say('ld_daughter_lina', '"When you retired, you said the pain stopped owning the house."'),
        say('ld_daughter_lina', '"Now the whole island is singing outside and I am the only one asking if you can still climb the stairs tomorrow."'),
        say('ld_daughter_lina', '"Tell me the truth. Is this for them, or because you cannot stand that football carried on without you?"'),
      ],
      choices: [
        choice('ld-family-truth', 'Tell Lina you are scared of becoming a memory', [rel('ld_daughter_lina', 3), stat('mental', 2), pressure(-1), flag('ld_lina_truth')], 'scene3_airport'),
        choice('ld-family-promise', 'Promise her you will protect your body', [rel('ld_daughter_lina', 2), injury(-1), morale(-1), flag('ld_promised_careful')], 'scene3_airport'),
        choice('ld-family-hide', 'Smile and tell her the knee feels fine', [pressure(2), injury(1), flag('ld_hid_knee_from_lina')], 'scene3_airport'),
      ],
    },
    {
      id: 'scene3_airport',
      background: { type: 'media', variant: 'interview' },
      characters: [
        { id: 'ld_reporter_vega', position: 'left', pose: 'reporter_notepad', expression: 'determined' },
        { id: 'ld_young_striker_elian', position: 'right', pose: 'young_teammate_red_kit', expression: 'neutral' },
      ],
      dialogue: [
        say('ld_reporter_vega', '"Tomas, the country calls this a fairytale. Elian Rocha calls it his position."'),
        say('ld_young_striker_elian', '"No disrespect, legend. But I scored the goals that got us here."'),
        say('ld_reporter_vega', '"Are you here to lift him, or to take from him?"'),
      ],
      choices: [
        choice('ld-press-country', '"I came because Cape Verde came first."', [rep(3), morale(1), fan(2), flag('ld_country_first'), { type: 'nextEpisode', episodeId: 'ld_ep2_camp' }], 'scene_complete'),
        choice('ld-press-elian', '"Elian earned the shirt. I came to make him dangerous."', [rel('ld_young_striker_elian', 4), stat('passing', 2), press(-1), fan(-1), flag('ld_backed_elian_publicly'), { type: 'nextEpisode', episodeId: 'ld_ep2_camp' }], 'scene_complete'),
        choice('ld-press-clock', '"The clock has had its say. Now I get mine."', [rep(2), pressure(3), press(2), fan(1), morale(2), flag('ld_challenged_clock'), { type: 'nextEpisode', episodeId: 'ld_ep2_camp' }], 'scene_complete'),
      ],
    },
  ],
};

export const lastDanceEpisode2: Episode = {
  id: 'ld_ep2_camp',
  title: 'Heat in the Camp',
  season: 2026,
  episodeNumber: 2,
  campaignId: 'last-dance-story',
  description: 'The shirt, the knee, and the next generation all collide before the first warm-up.',
  scenes: [
    {
      id: 'scene1_camp',
      background: { type: 'training', variant: 'morning' },
      characters: [
        { id: 'ld_captain_rui', position: 'left', pose: 'captain_red_kit', expression: 'determined' },
        { id: 'ld_coach_baptiste', position: 'center', pose: 'manager_overcoat', expression: 'determined' },
        { id: 'ld_young_striker_elian', position: 'right', pose: 'young_teammate_red_kit', expression: 'angry' },
      ],
      dialogue: [
        say('ld_captain_rui', '"The lads are watching every sprint. Half of them grew up with your posters. The other half think you are blocking their lives."'),
        say('ld_young_striker_elian', '"First drill is finishing. No speeches. No history. Just the ball."'),
        say('ld_coach_baptiste', '"You asked to come as a mentor. Good. Mentors still have to bleed in training."', {
          gates: [{ type: 'flag', flag: 'ld_returned_as_mentor' }],
        }),
        say('ld_captain_rui', '"You came to compete for the shirt. Then compete with the whole room, not just the boy."', {
          gates: [{ type: 'flag', flag: 'ld_returned_to_compete' }],
        }),
      ],
      choices: [
        choice('ld-camp-feed-elian', 'Spend the drill setting Elian up again and again', [rel('ld_young_striker_elian', 3), stat('passing', 2), morale(1), flag('ld_fed_elian')], 'scene2_physio'),
        choice('ld-camp-score', 'Go for goal and remind everyone what made you famous', [stat('shooting', 3), rep(2), pressure(2), rel('ld_young_striker_elian', -2), flag('ld_outshone_elian')], 'scene2_physio'),
        choice('ld-camp-command', 'Stop the drill and demand the line presses together', [rel('ld_captain_rui', 2), stat('mental', 2), morale(1), flag('ld_led_press')], 'scene2_physio'),
      ],
    },
    {
      id: 'scene2_physio',
      background: { type: 'physio', variant: 'treatment' },
      characters: [{ id: 'ld_physio_mara', position: 'center', pose: 'physio_bag', expression: 'concerned' }],
      dialogue: [
        say('ld_physio_mara', '"There is fluid under the kneecap. Not a disaster. A warning."'),
        say('ld_physio_mara', '"If you chase the old burst every day, the tournament ends before the anthem."'),
        say('ld_physio_mara', '"Lina thinks you told her everything. The swelling says otherwise."', {
          gates: [{ type: 'flag', flag: 'ld_hid_knee_from_lina' }],
        }),
        say('ld_physio_mara', '"Choose what you are now. Finisher, decoy, mentor. The body will not let you be all three."'),
      ],
      choices: [
        choice('ld-physio-rest', 'Accept a managed minutes plan', [rel('ld_physio_mara', 3), injury(-2), stat('mental', 1), flag('ld_managed_minutes')], 'scene3_friendly'),
        choice('ld-physio-extra', 'Ask for extra sharpness work anyway', [stat('shooting', 2), stat('physical', 1), injury(2), pressure(2), flag('ld_extra_sharpness')], 'scene3_friendly'),
        choice('ld-physio-painkiller', 'Ask what can be numbed if the country needs it', [pressure(3), injury(2), rel('ld_physio_mara', -1), flag('ld_asked_painkiller')], 'scene3_friendly'),
      ],
    },
    {
      id: 'scene3_friendly',
      background: { type: 'pitch', variant: 'match' },
      characters: [{ id: 'ld_coach_baptiste', position: 'center', pose: 'manager_overcoat', expression: 'determined' }],
      dialogue: [
        say('ld_coach_baptiste', '"Azuria are not here for a testimonial. They will run at the knee and call it tactics."'),
        say('ld_coach_baptiste', '"Give me one thing tonight: proof that your presence makes the team braver, not slower."'),
      ],
      choices: [
        {
          ...choice('ld-play-friendly', 'Play the return friendly', [flag('ld_played_return_friendly')], 'scene4_friendly_draw', { matchId: 'ld_return_friendly' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'ld_return_friendly', result: 'win' }], nextSceneId: 'scene4_friendly_win', consequences: [morale(2), rep(2), fan(1), press(-1)] },
            { gates: [{ type: 'matchResult', matchId: 'ld_return_friendly', result: 'draw' }], nextSceneId: 'scene4_friendly_draw', consequences: [pressure(1), press(1), fan(1)] },
            { gates: [{ type: 'matchResult', matchId: 'ld_return_friendly', result: 'loss' }], nextSceneId: 'scene4_friendly_loss', consequences: [pressure(2), press(2), fan(1), morale(-1)] },
          ],
        },
      ],
    },
    {
      id: 'scene4_friendly_win',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'ld_young_striker_elian', position: 'center', pose: 'young_teammate_red_kit', expression: 'surprised' }],
      dialogue: [
        say('ld_young_striker_elian', '"You drew two defenders before the winner. I did not see that on the old clips."'),
        say('ld_young_striker_elian', '"Maybe this works. Maybe."'),
      ],
      choices: [
        choice('ld-win-handshake', 'Tell Elian the next goal is his', [rel('ld_young_striker_elian', 3), morale(2), flag('ld_elian_next_goal'), { type: 'nextEpisode', episodeId: 'ld_ep3_group' }], 'scene_complete'),
        choice('ld-win-warning', 'Tell him trust has to survive pressure', [stat('mental', 2), rel('ld_captain_rui', 1), flag('ld_warned_elian_pressure'), { type: 'nextEpisode', episodeId: 'ld_ep3_group' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_friendly_draw',
      background: { type: 'media', variant: 'pressRoom' },
      characters: [{ id: 'ld_reporter_vega', position: 'center', pose: 'reporter_notepad', expression: 'neutral' }],
      dialogue: [
        say('ld_reporter_vega', '"A draw. One beautiful touch, three heavy sprints. Which one is the truth?"'),
        say('ld_reporter_vega', '"The country is still singing. The analysts are counting your steps."'),
      ],
      choices: [
        choice('ld-draw-own', '"The steps matter less if the ball arrives."', [stat('passing', 2), rep(2), flag('ld_reframed_pace'), { type: 'nextEpisode', episodeId: 'ld_ep3_group' }], 'scene_complete'),
        choice('ld-draw-work', 'Leave the press room and go straight to recovery', [rel('ld_physio_mara', 2), injury(-1), flag('ld_recovered_after_draw'), { type: 'nextEpisode', episodeId: 'ld_ep3_group' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_friendly_loss',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [
        { id: 'ld_captain_rui', position: 'left', pose: 'captain_red_kit', expression: 'angry' },
        { id: 'ld_coach_baptiste', position: 'right', pose: 'manager_overcoat', expression: 'concerned' },
      ],
      dialogue: [
        say('ld_captain_rui', '"They ran through the space behind you twice. The shirt cannot be a museum."'),
        say('ld_coach_baptiste', '"Rui. Enough."'),
        say('ld_captain_rui', '"No. If we are carrying history, history has to carry us back."'),
      ],
      choices: [
        choice('ld-loss-apologise', 'Apologise to the squad and ask for the role that helps', [rel('ld_captain_rui', 2), stat('mental', 2), pressure(-1), flag('ld_accepted_role'), { type: 'nextEpisode', episodeId: 'ld_ep3_group' }], 'scene_complete'),
        choice('ld-loss-fire', 'Tell Rui you still decide matches', [morale(2), pressure(3), rel('ld_captain_rui', -2), flag('ld_fought_rui'), { type: 'nextEpisode', episodeId: 'ld_ep3_group' }], 'scene_complete'),
      ],
    },
  ],
};

export const lastDanceEpisode3: Episode = {
  id: 'ld_ep3_group',
  title: 'The Group of Giants',
  season: 2026,
  episodeNumber: 3,
  campaignId: 'last-dance-story',
  description: 'The first World Cup group decider asks whether the legend still takes the shot, or finally gives it away.',
  scenes: [
    {
      id: 'scene1_group_hotel',
      background: { type: 'home', variant: 'livingRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'ld_coach_baptiste', position: 'left', pose: 'manager_overcoat', expression: 'determined' },
        { id: 'ld_young_striker_elian', position: 'right', pose: 'young_teammate_red_kit', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'ld_m_lina_group',
        from: 'Lina',
        senderType: 'family',
        avatarSeed: 'ld_daughter_lina',
        time: 'Matchday',
        order: 2,
        text: 'The whole street is painted blue. I hate that I understand why you went. Just come back able to dance at my wedding one day, alright?',
      }),
      dialogue: [
        say('ld_coach_baptiste', '"Germany beat England. We lost by one. A win sends us through. A draw might, if the other game breaks kindly."'),
        say('ld_young_striker_elian', '"Their centre-backs laughed when the analyst showed them our clips. They laughed hardest at yours."'),
        say('ld_coach_baptiste', '"Managed minutes kept you here. Do not throw that discipline away before the match starts."', {
          gates: [{ type: 'flag', flag: 'ld_managed_minutes' }],
        }),
        say('ld_young_striker_elian', '"When you outshone me in camp, I hated you for it. Tonight I need to know if you saw me at all."', {
          gates: [{ type: 'flag', flag: 'ld_outshone_elian' }],
        }),
        say('ld_coach_baptiste', '"Good. Pride makes heavy feet."'),
      ],
      choices: [
        {
          ...choice('ld-demand-start', 'Demand the start and the first hour', [morale(2), pressure(2), injury(1), flag('ld_demanded_start')], 'scene2_tunnel'),
          gates: [{ type: 'stat', stat: 'physical', min: 52 }],
        },
        choice('ld-accept-supersub', 'Accept the bench and study where the match opens', [stat('mental', 3), rel('ld_coach_baptiste', 2), flag('ld_accepted_supersub')], 'scene2_tunnel'),
        choice('ld-build-around-elian', 'Ask Baptiste to build the plan around Elian\'s pace', [rel('ld_young_striker_elian', 3), stat('passing', 2), morale(1), flag('ld_built_around_elian')], 'scene2_tunnel'),
      ],
    },
    {
      id: 'scene2_tunnel',
      background: { type: 'lockerRoom', variant: 'before' },
      characters: [
        { id: 'ld_captain_rui', position: 'left', pose: 'captain_red_kit', expression: 'determined' },
        { id: 'ld_physio_mara', position: 'right', pose: 'physio_bag', expression: 'concerned' },
      ],
      dialogue: [
        say('ld_physio_mara', '"If the knee locks, you signal. No pride. No guessing."'),
        say('ld_captain_rui', '"The anthem will be loud enough to shake bones. After that, it is just grass."'),
        say('ld_captain_rui', '"What do you give them before we walk out?"'),
      ],
      choices: [
        choice('ld-talk-fire', 'Tell the room the world expects a souvenir, not a fight', [morale(3), pressure(1), flag('ld_tunnel_fire')], 'scene2b_knee_lock'),
        choice('ld-talk-calm', 'Tell them to survive the first storm and trust the late chance', [stat('mental', 3), pressure(-1), flag('ld_tunnel_calm')], 'scene2b_knee_lock'),
        choice('ld-talk-elian', 'Put your hand on Elian\'s shoulder and say the future starts now', [rel('ld_young_striker_elian', 2), morale(2), flag('ld_tunnel_elian')], 'scene2b_knee_lock'),
      ],
    },
    {
      id: 'scene2b_knee_lock',
      background: { type: 'physio', variant: 'treatment' },
      characters: [
        { id: 'ld_physio_mara', position: 'left', pose: 'physio_bag', expression: 'concerned' },
        { id: 'ld_young_striker_elian', position: 'right', pose: 'young_teammate_red_kit', expression: 'determined' },
      ],
      dialogue: [
        say('ld_physio_mara', '"The knee locked when you stood for the anthem rehearsal. Do not tell me it was nothing."'),
        say('ld_physio_mara', '"Baptiste can change the plan. If you hide this and it goes, the country gets a picture and you get a chair."'),
        say('ld_young_striker_elian', '"The analysts already say we are a nostalgia act. Let them. But do not make me watch you break because you needed one more headline."'),
        say('ld_physio_mara', '"Managed minutes were meant to avoid this exact room."', {
          gates: [{ type: 'flag', flag: 'ld_managed_minutes' }],
        }),
      ],
      choices: [
        choice('ld-knee-confess', 'Tell Baptiste the knee locked and accept a reduced role', [rel('ld_physio_mara', 3), rel('ld_young_striker_elian', 2), injury(-1), stat('mental', 2), flag('ld_admitted_knee_lock')], 'scene3_decider'),
        choice('ld-knee-hide', 'Tape it tighter and keep the plan unchanged', [pressure(3), injury(3), rep(2), flag('ld_hid_knee_lock')], 'scene3_decider'),
        choice('ld-knee-elian', 'Give Elian the first designed chance and become the decoy', [rel('ld_young_striker_elian', 3), stat('passing', 2), morale(2), flag('ld_became_decoy')], 'scene3_decider'),
      ],
    },
    {
      id: 'scene3_decider',
      background: { type: 'pitch', variant: 'match' },
      characters: [{ id: 'ld_coach_baptiste', position: 'center', pose: 'manager_overcoat', expression: 'determined' }],
      dialogue: [
        say('ld_coach_baptiste', '"One match. One island. One more run than they think you have."'),
      ],
      choices: [
        {
          ...choice('ld-play-decider', 'Play the World Cup group decider', [flag('ld_played_group_decider')], 'scene4_decider_draw', { matchId: 'ld_group_decider' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'ld_group_decider', result: 'win' }, { type: 'injuryRisk', min: 7 }], nextSceneId: 'scene4_decider_win_cost', consequences: [rep(6), morale(4), fan(3), injury(1), flag('ld_qualified_at_cost')] },
            { gates: [{ type: 'matchResult', matchId: 'ld_group_decider', result: 'win' }, { type: 'relationship', npcId: 'ld_young_striker_elian', min: 5 }], nextSceneId: 'scene4_decider_win_legacy', consequences: [rep(5), morale(5), press(-1), fan(1), flag('ld_qualified_with_elian')] },
            { gates: [{ type: 'matchResult', matchId: 'ld_group_decider', result: 'win' }], nextSceneId: 'scene4_decider_win_legend', consequences: [rep(7), morale(3), fan(2), flag('ld_qualified_as_legend')] },
            { gates: [{ type: 'matchResult', matchId: 'ld_group_decider', result: 'draw' }], nextSceneId: 'scene4_decider_draw', consequences: [rep(2), pressure(2), press(1), fan(2), flag('ld_waited_on_other_result')] },
            { gates: [{ type: 'matchResult', matchId: 'ld_group_decider', result: 'loss' }], nextSceneId: 'scene4_decider_loss', consequences: [pressure(3), press(2), fan(2), morale(-3), flag('ld_group_heartbreak')] },
          ],
        },
      ],
    },
    {
      id: 'scene4_decider_win_cost',
      background: { type: 'physio', variant: 'treatment' },
      characters: [
        { id: 'ld_physio_mara', position: 'left', pose: 'physio_bag', expression: 'concerned' },
        { id: 'ld_daughter_lina', position: 'right', pose: 'family_casual', expression: 'angry' },
      ],
      dialogue: [
        say('ld_physio_mara', '"You got them through. You also tore something we cannot pretend is cramp."'),
        say('ld_daughter_lina', '"Everyone outside is calling you immortal. I am looking at you and seeing a man who cannot stand."'),
      ],
      choices: [
        choice('ld-cost-apologise', 'Apologise to Lina before facing the country', [rel('ld_daughter_lina', 3), pressure(-1), flag('ld_lina_apology'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
        choice('ld-cost-country', 'Ask to be carried out to thank the supporters', [rep(4), morale(2), injury(1), flag('ld_carried_to_crowd'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_decider_win_legacy',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'ld_young_striker_elian', position: 'center', pose: 'young_teammate_red_kit', expression: 'surprised' }],
      dialogue: [
        say('ld_young_striker_elian', '"You could have shot."'),
        say('ld_young_striker_elian', '"You gave it to me. At the World Cup. Why?"'),
        say('ld_young_striker_elian', '"Because you saw the future before I did."'),
      ],
      choices: [
        choice('ld-legacy-shirt', 'Tell Elian the shirt belongs to him now', [rel('ld_young_striker_elian', 3), morale(3), flag('ld_passed_shirt'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
        choice('ld-legacy-duo', 'Tell him the next round needs both eras', [rep(2), morale(3), flag('ld_two_eras'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_decider_win_legend',
      background: { type: 'media', variant: 'pressRoom' },
      characters: [{ id: 'ld_reporter_vega', position: 'center', pose: 'reporter_notepad', expression: 'surprised' }],
      dialogue: [
        say('ld_reporter_vega', '"A goal in the eighty-ninth minute. Cape Verde through. There are children crying in the mixed zone."'),
        say('ld_reporter_vega', '"Did you turn the clock back, or did the country drag you with it?"'),
      ],
      choices: [
        choice('ld-legend-country', '"The country ran for me when I could not."', [rep(5), morale(3), flag('ld_country_carried_me'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
        choice('ld-legend-never-left', '"Maybe I was never finished. Maybe I just needed them."', [rep(3), pressure(1), flag('ld_never_finished'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_decider_draw',
      background: { type: 'car', variant: 'interior' },
      characters: [{ id: 'ld_coach_baptiste', position: 'center', pose: 'manager_overcoat', expression: 'concerned' }],
      dialogue: [
        say('ld_coach_baptiste', '"A draw. We wait on England. That is the cruelty of it: our greatest night may still need another country to blink."'),
        say('ld_coach_baptiste', '"Whatever happens, that dressing room believed because you made belief practical."'),
      ],
      choices: [
        choice('ld-draw-watch', 'Watch the other result with the squad', [morale(1), rel('ld_captain_rui', 1), flag('ld_waited_with_squad'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
        choice('ld-draw-call-home', 'Call Lina before the result comes in', [rel('ld_daughter_lina', 2), stat('mental', 1), flag('ld_called_lina_waiting'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_decider_loss',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [
        { id: 'ld_young_striker_elian', position: 'left', pose: 'young_teammate_red_kit', expression: 'concerned' },
        { id: 'ld_captain_rui', position: 'right', pose: 'captain_red_kit', expression: 'concerned' },
      ],
      dialogue: [
        say('ld_young_striker_elian', '"I had the cutback. You were open. I froze."'),
        say('ld_captain_rui', '"No. We came as a country. We go out as one."'),
      ],
      choices: [
        choice('ld-loss-protect-elian', 'Take the blame before the cameras can reach Elian', [rel('ld_young_striker_elian', 3), rep(2), flag('ld_protected_elian'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
        choice('ld-loss-truth', 'Tell the room the tournament changed the country anyway', [morale(2), stat('mental', 2), flag('ld_loss_room_speech'), { type: 'nextEpisode', episodeId: 'ld_ep4_legacy' }], 'scene_complete'),
      ],
    },
  ],
};

export const lastDanceEpisode4: Episode = {
  id: 'ld_ep4_legacy',
  title: 'What Remains',
  season: 2026,
  episodeNumber: 4,
  campaignId: 'last-dance-story',
  description: 'The World Cup moves on. The player chooses what his return actually meant.',
  scenes: [
    {
      id: 'scene1_legacy_press',
      background: { type: 'media', variant: 'pressRoom' },
      characters: [
        { id: 'ld_reporter_vega', position: 'left', pose: 'reporter_notepad', expression: 'neutral' },
        { id: 'ld_young_striker_elian', position: 'right', pose: 'young_teammate_red_kit', expression: 'determined' },
      ],
      dialogue: [
        say('ld_reporter_vega', '"The question everyone asks now: was this a comeback, a farewell, or a handover?"'),
        say('ld_young_striker_elian', '"Let him answer. The country has taken enough from him this month."'),
        say('ld_reporter_vega', '"Tomas?"'),
        say('ld_reporter_vega', '"You gave Elian the future. That pass will be shown for fifty years."', {
          gates: [{ type: 'flag', flag: 'ld_qualified_with_elian' }],
        }),
        say('ld_young_striker_elian', '"You built the plan around my pace before anyone else believed it was enough."', {
          gates: [{ type: 'flag', flag: 'ld_built_around_elian' }],
        }),
        say('ld_reporter_vega', '"You paid for qualification with your knee. Some people call that glory. Some call it too much."', {
          gates: [{ type: 'flag', flag: 'ld_qualified_at_cost' }],
        }),
        say('ld_reporter_vega', '"Even in defeat, every kid outside is wearing blue. That was not true a month ago."', {
          gates: [{ type: 'flag', flag: 'ld_group_heartbreak' }],
        }),
      ],
      choices: [
        choice('ld-ending-handover', 'Hand the number nine shirt to Elian', [rel('ld_young_striker_elian', 4), rep(5), morale(5), press(-2), fan(-1), flag('ld_ending_handover'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
        choice('ld-ending-academy', 'Announce the academy will train the next Cape Verde generation', [rel('ld_daughter_lina', 3), rep(4), morale(4), fan(1), flag('ld_ending_academy'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
        {
          ...choice('ld-ending-one-more', 'Say you will be ready if the next round needs one more run', [pressure(2), press(1), fan(2), rep(6), morale(3), injury(1), flag('ld_ending_one_more'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'injuryRisk', max: 6 }],
        },
        {
          ...choice('ld-ending-scapegoat', 'Take the blame so Elian and the next generation are left alone', [rel('ld_young_striker_elian', 3), rep(2), morale(1), press(-3), fan(-1), flag('ld_ending_scapegoat'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'pressPressure', min: 7 }],
        },
        {
          ...choice('ld-ending-loved-broken', 'Admit the country got its miracle and your body paid for it', [rel('ld_daughter_lina', 4), rep(5), morale(2), press(-1), fan(2), injury(1), flag('ld_ending_loved_broken'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'fanPressure', min: 7 }, { type: 'injuryRisk', min: 7 }],
        },
      ],
    },
  ],
};
