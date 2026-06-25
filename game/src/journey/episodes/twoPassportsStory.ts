import type { Episode, JourneyState, NPC } from '../types';

export const twoPassportsNPCs: NPC[] = [
  {
    id: 'tp_birth_assistant_miller',
    name: 'Coach Miller',
    role: 'manager',
    description: 'The birth-country assistant who offers opportunity without ever quite offering trust.',
    defaultPose: 'assistant_clipboard',
  },
  {
    id: 'tp_heritage_manager_desrosiers',
    name: 'Manager Desrosiers',
    role: 'manager',
    description: 'Haiti manager. Warm in private, unsentimental when the qualifier starts.',
    defaultPose: 'manager_overcoat',
  },
  {
    id: 'tp_grandmother_ana',
    name: 'Ana',
    role: 'family',
    description: 'His grandmother. She remembers the old World Cup and refuses to tell him who to be.',
    defaultPose: 'family_casual',
  },
  {
    id: 'tp_agent_reece',
    name: 'Reece Calder',
    role: 'agent',
    description: 'A pragmatic agent trying to keep every federation, sponsor and headline alive.',
    defaultPose: 'agent_phone',
  },
  {
    id: 'tp_birth_teammate_brooks',
    name: 'Evan Brooks',
    role: 'teammate',
    description: 'A birth-country teammate who likes him, but does not understand why waiting hurt.',
    defaultPose: 'young_teammate_red_kit',
  },
  {
    id: 'tp_heritage_captain_etienne',
    name: 'Jean Etienne',
    role: 'teammate',
    description: 'Haiti captain. Proud, guarded, and unwilling to let a late arrival own the miracle.',
    defaultPose: 'captain_red_kit',
  },
  {
    id: 'tp_reporter_malik',
    name: 'Noah Malik',
    role: 'media',
    description: 'A reporter who turns every answer into a referendum on loyalty.',
    defaultPose: 'reporter_notepad',
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

export const twoPassportsEpisode1: Episode = {
  id: 'tp_ep1_snub',
  title: 'Not On The List',
  season: 2026,
  episodeNumber: 1,
  campaignId: 'two-passports-story',
  description: 'The squad list drops without your name again. Then another country calls before the anger has cooled.',
  scenes: [
    {
      id: 'scene1_squad_list',
      background: { type: 'home', variant: 'livingRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'tp_agent_reece', position: 'left', pose: 'agent_phone', expression: 'concerned' },
        { id: 'tp_grandmother_ana', position: 'right', pose: 'family_casual', expression: 'neutral' },
      ],
      onEnter: pushMessages({
        id: 'tp_m_agent_squad_list',
        from: 'Reece',
        senderType: 'agent',
        avatarSeed: 'tp_agent_reece',
        time: 'Squad Day',
        order: 1,
        text: 'Not on the list. Again. Keep your phone close. I have Miller trying to explain it and Desrosiers asking whether you are ready to hear Haiti out.',
      }),
      dialogue: [
        say('tp_agent_reece', '"They took three midfielders carrying injuries and still left you out."'),
        say('tp_grandmother_ana', '"Do not let a list tell you where your blood begins or ends."'),
        say('tp_agent_reece', '"Haiti called five minutes after the announcement. They want you in the playoff camp. Not as a mascot. As the player the whole plan bends around."'),
      ],
      choices: [
        choice('tp-snub-silent', 'Say nothing; make the next match the answer', [stat('mental', 2), pressure(-1), press(-1), flag('tp_silent_after_snub')], 'scene2_showcase'),
        choice('tp-snub-fire', 'Tell the press you are tired of being invisible', [rep(2), pressure(3), press(2), fan(1), flag('tp_called_tokenism')], 'scene2_showcase'),
        choice('tp-call-gran', 'Ask Ana what the old country would ask of you', [rel('tp_grandmother_ana', 4), morale(2), fan(-1), flag('tp_gran_anchor')], 'scene2_showcase'),
      ],
    },
    {
      id: 'scene2_showcase',
      background: { type: 'pitch', variant: 'match' },
      characters: [{ id: 'tp_reporter_malik', position: 'center', pose: 'reporter_notepad', expression: 'determined' }],
      dialogue: [
        say('tp_reporter_malik', '"Tonight was supposed to be a league match. Now every camera wants to know which passport is in your kit bag."'),
        say('tp_reporter_malik', '"The birth country scouts are here. Haiti sent the manager himself. One performance, two different futures."'),
      ],
      choices: [
        {
          ...choice('tp-play-showcase', 'Play the showcase match under both flags', [flag('tp_played_showcase')], 'scene3_showcase_draw', { matchId: 'tp_showcase_match' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'tp_showcase_match', result: 'win' }], nextSceneId: 'scene3_showcase_win', consequences: [rep(3), morale(2), fan(1)] },
            { gates: [{ type: 'matchResult', matchId: 'tp_showcase_match', result: 'draw' }], nextSceneId: 'scene3_showcase_draw', consequences: [pressure(1), press(1), fan(1)] },
            { gates: [{ type: 'matchResult', matchId: 'tp_showcase_match', result: 'loss' }], nextSceneId: 'scene3_showcase_loss', consequences: [pressure(2), press(2), fan(1), morale(-1)] },
          ],
        },
      ],
    },
    {
      id: 'scene3_showcase_win',
      background: { type: 'media', variant: 'interview' },
      characters: [
        { id: 'tp_birth_assistant_miller', position: 'left', pose: 'assistant_clipboard', expression: 'neutral' },
        { id: 'tp_reporter_malik', position: 'center', pose: 'reporter_notepad', expression: 'determined' },
        { id: 'tp_heritage_manager_desrosiers', position: 'right', pose: 'manager_overcoat', expression: 'determined' },
      ],
      dialogue: [
        say('tp_birth_assistant_miller', '"That performance changes the conversation. Camp place. No guarantees, but you will be seen."'),
        say('tp_heritage_manager_desrosiers', '"With us, you are not a conversation. You are the missing piece."'),
        say('tp_reporter_malik', '"Silence worked. Now they both need your answer."', {
          gates: [{ type: 'flag', flag: 'tp_silent_after_snub' }],
        }),
      ],
      choices: [
        choice('tp-showcase-win-next', 'Sleep on both calls', [pressure(1), { type: 'nextEpisode', episodeId: 'tp_ep2_two_calls' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene3_showcase_draw',
      background: { type: 'car', variant: 'interior' },
      characters: [{ id: 'tp_agent_reece', position: 'center', pose: 'agent_phone', expression: 'concerned' }],
      dialogue: [
        say('tp_agent_reece', '"A draw. Enough for both sides to stay interested, not enough for either to stop playing games."'),
        say('tp_agent_reece', '"Your tokenism quote is everywhere. Miller hates it. Desrosiers says he understands exactly why you said it."', {
          gates: [{ type: 'flag', flag: 'tp_called_tokenism' }],
        }),
      ],
      choices: [
        choice('tp-showcase-draw-next', 'Take the calls before the story takes you', [stat('mental', 1), { type: 'nextEpisode', episodeId: 'tp_ep2_two_calls' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene3_showcase_loss',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'tp_grandmother_ana', position: 'center', pose: 'family_casual', expression: 'concerned' }],
      dialogue: [
        say('tp_grandmother_ana', '"You think one bad match removes the question. It does not."'),
        say('tp_grandmother_ana', '"You asked what the old country would ask. It would ask you to arrive humble, not heroic."', {
          gates: [{ type: 'flag', flag: 'tp_gran_anchor' }],
        }),
      ],
      choices: [
        choice('tp-showcase-loss-next', 'Answer the calls anyway', [rel('tp_grandmother_ana', 1), pressure(2), { type: 'nextEpisode', episodeId: 'tp_ep2_two_calls' }], 'scene_complete'),
      ],
    },
  ],
};

export const twoPassportsEpisode2: Episode = {
  id: 'tp_ep2_two_calls',
  title: 'Two Calls, Same Night',
  season: 2026,
  episodeNumber: 2,
  campaignId: 'two-passports-story',
  description: 'One federation offers a camp place. The other offers a country waiting decades for a return.',
  scenes: [
    {
      id: 'scene1_hotel_calls',
      background: { type: 'home', variant: 'bedroom' },
      characters: [
        { id: 'tp_birth_assistant_miller', position: 'left', pose: 'assistant_clipboard', expression: 'neutral' },
        { id: 'tp_heritage_manager_desrosiers', position: 'right', pose: 'manager_overcoat', expression: 'neutral' },
      ],
      dialogue: [
        say('tp_birth_assistant_miller', '"I will be straight with you. You come to camp, you compete. No promise beyond that."'),
        say('tp_heritage_manager_desrosiers', '"I will also be straight. If you come to us, every headline says saviour before you touch the ball. That pressure can poison a room."'),
        say('tp_birth_assistant_miller', '"Your comments made people uncomfortable. Sometimes uncomfortable is useful."', {
          gates: [{ type: 'flag', flag: 'tp_called_tokenism' }],
        }),
      ],
      choices: [
        choice('tp-birth-camp-yes', 'Take the birth-country camp invite', [rel('tp_birth_assistant_miller', 3), rep(2), pressure(2), press(1), fan(1), flag('tp_birth_trial')], 'scene2_family_language'),
        choice('tp-heritage-visit', 'Fly to Port-au-Prince before deciding', [rel('tp_heritage_manager_desrosiers', 3), rel('tp_grandmother_ana', 2), morale(2), fan(1), flag('tp_visited_heritage_camp')], 'scene2_family_language'),
        choice('tp-delay-both', 'Keep both federations waiting until the playoff draw', [pressure(4), press(2), fan(1), rep(-1), flag('tp_delayed_choice')], 'scene2_family_language'),
      ],
    },
    {
      id: 'scene2_family_language',
      background: { type: 'town', variant: 'pub' },
      characters: [{ id: 'tp_grandmother_ana', position: 'center', pose: 'family_casual', expression: 'concerned' }],
      dialogue: [
        say('tp_grandmother_ana', '"I kept the old radio because your grandfather shouted at it in two languages."'),
        say('tp_grandmother_ana', '"Do not choose Haiti for me. Do not choose America to punish them. Choose the dressing room whose pain you are willing to carry."'),
      ],
      choices: [
        choice('tp-family-learn', 'Ask Ana to teach you the anthem properly', [rel('tp_grandmother_ana', 3), stat('mental', 1), flag('tp_learning_anthem'), { type: 'nextEpisode', episodeId: 'tp_ep3_cap_tie' }], 'scene_complete'),
        choice('tp-family-boundary', 'Tell Ana the decision has to be yours alone', [stat('mental', 2), pressure(-1), flag('tp_decision_boundary'), { type: 'nextEpisode', episodeId: 'tp_ep3_cap_tie' }], 'scene_complete'),
      ],
    },
  ],
};

export const twoPassportsEpisode3: Episode = {
  id: 'tp_ep3_cap_tie',
  title: 'The Shirt That Locks',
  season: 2026,
  episodeNumber: 3,
  campaignId: 'two-passports-story',
  description: 'The next competitive appearance closes the door. Delay is no longer neutral.',
  scenes: [
    {
      id: 'scene1_deadline',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'tp_agent_reece', position: 'left', pose: 'agent_phone', expression: 'concerned' },
        { id: 'tp_reporter_malik', position: 'right', pose: 'reporter_notepad', expression: 'determined' },
      ],
      dialogue: [
        say('tp_agent_reece', '"The paperwork is ready in both inboxes. Once you play a competitive minute, the story stops being reversible."'),
        say('tp_reporter_malik', '"The public question is simple and unfair: who are you?"'),
        say('tp_agent_reece', '"Keeping both waiting has made both suspicious. You need conviction now."', {
          gates: [{ type: 'flag', flag: 'tp_delayed_choice' }],
        }),
      ],
      choices: [
        choice('tp-choose-birth', 'Choose the country that raised your game', [rep(3), rel('tp_birth_assistant_miller', 3), rel('tp_grandmother_ana', -3), pressure(2), press(1), fan(1), flag('tp_chose_birth'), flag('tp_cap_tied_birth')], 'scene2_leaked_papers'),
        choice('tp-choose-heritage', 'Choose the country that kept your name', [morale(4), rel('tp_grandmother_ana', 4), rel('tp_heritage_captain_etienne', 2), rep(1), fan(1), flag('tp_chose_heritage'), flag('tp_cap_tied_heritage')], 'scene2_leaked_papers'),
        {
          ...choice('tp-speak-language', 'Announce Haiti partly in Ana\'s language', [rel('tp_grandmother_ana', 3), rel('tp_heritage_captain_etienne', 2), pressure(1), press(-1), fan(1), morale(2), flag('tp_spoke_language'), flag('tp_chose_heritage'), flag('tp_cap_tied_heritage')], 'scene2_leaked_papers'),
          gates: [{ type: 'flag', flag: 'tp_visited_heritage_camp' }],
        },
      ],
    },
    {
      id: 'scene2_leaked_papers',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'tp_agent_reece', position: 'left', pose: 'agent_phone', expression: 'concerned' },
        { id: 'tp_reporter_malik', position: 'right', pose: 'reporter_notepad', expression: 'determined' },
      ],
      dialogue: [
        say('tp_reporter_malik', '"The registration papers leaked before the federation statement. Someone wanted the other country to hear it from a headline."'),
        say('tp_agent_reece', '"Miller says he did not leak it. Desrosiers says leaks are how powerful rooms punish players who stop waiting."'),
        say('tp_reporter_malik', '"The birth-country fans call it betrayal. Haiti fans call it proof you were never fully theirs."', {
          gates: [{ type: 'flag', flag: 'tp_chose_heritage' }],
        }),
        say('tp_reporter_malik', '"Haiti found out from a timestamp, not from you. Ana will have to hear neighbours say you used her story for leverage."', {
          gates: [{ type: 'flag', flag: 'tp_chose_birth' }],
        }),
        say('tp_agent_reece', '"Keeping both waiting gave someone time to turn your decision into their weapon."', {
          gates: [{ type: 'flag', flag: 'tp_delayed_choice' }],
        }),
      ],
      choices: [
        {
          ...choice('tp-leak-birth-camera', 'Sign the birth-country form on camera and own the delay', [rel('tp_birth_teammate_brooks', 2), stat('mental', 2), pressure(1), press(1), flag('tp_owned_birth_leak'), { type: 'nextEpisode', episodeId: 'tp_ep4_playoff' }], 'scene_complete'),
          gates: [{ type: 'flag', flag: 'tp_chose_birth' }],
        },
        {
          ...choice('tp-leak-haiti-room', 'Ask Etienne to witness the Haiti papers before the cameras', [rel('tp_heritage_captain_etienne', 3), morale(2), pressure(-1), press(-1), fan(-1), flag('tp_room_witnessed_papers'), { type: 'nextEpisode', episodeId: 'tp_ep4_playoff' }], 'scene_complete'),
          gates: [{ type: 'flag', flag: 'tp_chose_heritage' }],
        },
        {
          ...choice('tp-leak-ana-line', 'Read Ana\'s anthem line even while the cameras jeer', [rel('tp_grandmother_ana', 3), rep(2), pressure(2), press(1), fan(1), flag('tp_read_ana_line_under_fire'), { type: 'nextEpisode', episodeId: 'tp_ep4_playoff' }], 'scene_complete'),
          gates: [{ type: 'flag', flag: 'tp_spoke_language' }],
        },
      ],
    },
  ],
};

export const twoPassportsEpisode4: Episode = {
  id: 'tp_ep4_playoff',
  title: 'The Return Playoff',
  season: 2026,
  episodeNumber: 4,
  campaignId: 'two-passports-story',
  description: 'One route offers a World Cup playoff. The other offers the camp place that arrived years late.',
  scenes: [
    {
      id: 'scene1_route_split',
      background: { type: 'lockerRoom', variant: 'before' },
      characters: [
        { id: 'tp_heritage_captain_etienne', position: 'left', pose: 'captain_red_kit', expression: 'determined' },
        { id: 'tp_birth_teammate_brooks', position: 'right', pose: 'young_teammate_red_kit', expression: 'neutral' },
      ],
      dialogue: [
        say('tp_heritage_captain_etienne', '"If you chose us, listen before you lead. This room was carrying the drought before your flight landed."', {
          gates: [{ type: 'flag', flag: 'tp_chose_heritage' }],
        }),
        say('tp_birth_teammate_brooks', '"If you chose camp, do not expect the staff to admit they were late. Make it impossible to cut you."', {
          gates: [{ type: 'flag', flag: 'tp_chose_birth' }],
        }),
      ],
      choices: [
        {
          ...choice('tp-play-heritage-playoff', 'Play Haiti\'s World Cup playoff', [rel('tp_heritage_captain_etienne', 1), flag('tp_played_heritage_playoff')], 'scene3_heritage_heartbreak', { matchId: 'tp_heritage_playoff' }),
          gates: [{ type: 'flag', flag: 'tp_chose_heritage' }],
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'tp_heritage_playoff', result: 'win' }], nextSceneId: 'scene3_heritage_qualified', consequences: [rep(5), morale(5), fan(2), flag('tp_heritage_qualified')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_heritage_playoff', result: 'draw' }, { type: 'reputation', min: 25 }], nextSceneId: 'scene3_heritage_qualified', consequences: [rep(3), morale(3), pressure(1), fan(1), flag('tp_heritage_qualified'), flag('tp_penalty_survival')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_heritage_playoff', result: 'draw' }], nextSceneId: 'scene3_heritage_nearly', consequences: [pressure(2), press(1), fan(1), morale(1), flag('tp_heritage_nearly')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_heritage_playoff', result: 'loss' }], nextSceneId: 'scene3_heritage_heartbreak', consequences: [pressure(3), press(2), fan(1), morale(-3), flag('tp_heritage_heartbreak')] },
          ],
        },
        {
          ...choice('tp-play-birth-trial', 'Play the birth-country camp trial', [flag('tp_played_birth_trial')], 'scene4_birth_hollow_cap', { matchId: 'tp_birth_trial' }),
          gates: [{ type: 'flag', flag: 'tp_chose_birth' }],
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'tp_birth_trial', result: 'win' }, { type: 'stat', stat: 'mental', min: 56 }], nextSceneId: 'scene4_birth_squad_place', consequences: [rep(4), morale(2), fan(1), flag('tp_birth_squad_place')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_birth_trial', result: 'draw' }], nextSceneId: 'scene4_birth_bench', consequences: [rep(1), pressure(1), fan(1), flag('tp_birth_bench')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_birth_trial', result: 'loss' }], nextSceneId: 'scene4_birth_hollow_cap', consequences: [pressure(3), press(2), fan(1), morale(-2), flag('tp_birth_cap_hollow')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_birth_trial', result: 'win' }], nextSceneId: 'scene4_birth_hollow_cap', consequences: [pressure(2), press(1), flag('tp_birth_cap_hollow')] },
          ],
        },
      ],
    },
    {
      id: 'scene3_heritage_qualified',
      background: { type: 'town', variant: 'street' },
      characters: [
        { id: 'tp_heritage_captain_etienne', position: 'left', pose: 'captain_red_kit', expression: 'surprised' },
        { id: 'tp_grandmother_ana', position: 'right', pose: 'family_casual', expression: 'happy' },
      ],
      dialogue: [
        say('tp_heritage_captain_etienne', '"We are going back. Do you hear them? That is not a stadium. That is every family that kept the shirt in a drawer."'),
        say('tp_grandmother_ana', '"You spoke the words late, but you meant them."', {
          gates: [{ type: 'flag', flag: 'tp_spoke_language' }],
        }),
      ],
      choices: [
        choice('tp-qualified-humble', 'Tell Etienne this was his room before it was your story', [rel('tp_heritage_captain_etienne', 3), stat('mental', 2), flag('tp_room_honoured'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
        choice('tp-qualified-promise', 'Promise Ana you will face the birth country without hiding', [rel('tp_grandmother_ana', 2), pressure(1), flag('tp_gran_promise'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene3_heritage_nearly',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'tp_heritage_manager_desrosiers', position: 'center', pose: 'manager_overcoat', expression: 'concerned' }],
      dialogue: [
        say('tp_heritage_manager_desrosiers', '"The penalties went the other way. The world will call it almost. That word has haunted this country long enough."'),
      ],
      choices: [
        choice('tp-nearly-stay', 'Stay in the dressing room until every player leaves first', [rel('tp_heritage_captain_etienne', 2), morale(1), flag('tp_stayed_after_nearly'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene3_heritage_heartbreak',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'tp_heritage_captain_etienne', position: 'center', pose: 'captain_red_kit', expression: 'angry' }],
      dialogue: [
        say('tp_heritage_captain_etienne', '"You came late. We let you in. Now the cameras will ask if we bent too much for one man."'),
      ],
      choices: [
        choice('tp-heartbreak-own', 'Take the cameras before they can blame Etienne', [rel('tp_heritage_captain_etienne', 2), rep(2), flag('tp_protected_etienne'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
        choice('tp-heartbreak-silence', 'Sit with the shirt on until the stadium empties', [stat('mental', 2), morale(-1), flag('tp_sat_with_shirt'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_birth_squad_place',
      background: { type: 'managerOffice', variant: 'day' },
      characters: [{ id: 'tp_birth_assistant_miller', position: 'center', pose: 'assistant_clipboard', expression: 'neutral' }],
      dialogue: [
        say('tp_birth_assistant_miller', '"You made the squad. You wanted a door opened; you kicked it clean off."'),
        say('tp_birth_assistant_miller', '"Do not ask why it took so long. Ask what you do now that you are inside."'),
      ],
      choices: [
        choice('tp-birth-place-accept', 'Take the shirt without thanking them for lateness', [stat('mental', 2), rep(2), flag('tp_birth_inside'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_birth_bench',
      background: { type: 'lockerRoom', variant: 'before' },
      characters: [{ id: 'tp_birth_teammate_brooks', position: 'center', pose: 'young_teammate_red_kit', expression: 'concerned' }],
      dialogue: [
        say('tp_birth_teammate_brooks', '"Bench role. It is not nothing."'),
        say('tp_birth_teammate_brooks', '"But I saw your face when Haiti scored on the hotel TV."'),
      ],
      choices: [
        choice('tp-bench-focus', 'Commit to fighting from the bench', [rel('tp_birth_teammate_brooks', 2), stat('mental', 2), flag('tp_birth_bench_focus'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene4_birth_hollow_cap',
      background: { type: 'car', variant: 'interior' },
      characters: [{ id: 'tp_agent_reece', position: 'center', pose: 'agent_phone', expression: 'concerned' }],
      dialogue: [
        say('tp_agent_reece', '"Cap-tied. Not selected. They say it is depth. They say the door is open."'),
        say('tp_agent_reece', '"A door can be open and still not be for you."'),
      ],
      choices: [
        choice('tp-hollow-watch', 'Watch Haiti\'s playoff on a muted TV', [rel('tp_grandmother_ana', -1), pressure(2), flag('tp_watched_haiti_muted'), { type: 'nextEpisode', episodeId: 'tp_ep5_between_names' }], 'scene_complete'),
      ],
    },
  ],
};

export const twoPassportsEpisode5: Episode = {
  id: 'tp_ep5_between_names',
  title: 'The Country Between Names',
  season: 2026,
  episodeNumber: 5,
  campaignId: 'two-passports-story',
  description: 'The final scene is not about proving one flag wrong. It is about living with the flag you chose.',
  scenes: [
    {
      id: 'scene1_final_crossroads',
      background: { type: 'lockerRoom', variant: 'before' },
      characters: [
        { id: 'tp_heritage_captain_etienne', position: 'left', pose: 'captain_red_kit', expression: 'determined' },
        { id: 'tp_agent_reece', position: 'center', pose: 'agent_phone', expression: 'concerned' },
        { id: 'tp_birth_teammate_brooks', position: 'right', pose: 'young_teammate_red_kit', expression: 'concerned' },
      ],
      dialogue: [
        say('tp_heritage_captain_etienne', '"Group opener. Haiti against the country that kept you waiting. Do not make this revenge. We did not qualify to be your argument."', {
          gates: [{ type: 'flag', flag: 'tp_heritage_qualified' }],
        }),
        say('tp_birth_teammate_brooks', '"You earned the big shirt. I know that. I also know Ana is watching Haiti sing without you."', {
          gates: [{ type: 'flag', flag: 'tp_birth_squad_place' }],
        }),
        say('tp_birth_teammate_brooks', '"Bench role is still a shirt. But if you chose this just to sit quietly, the country that wanted you will haunt every warm-up."', {
          gates: [{ type: 'flag', flag: 'tp_birth_bench' }],
        }),
        say('tp_agent_reece', '"The headline is brutal because it is simple: cap-tied, then cut. Haiti kept moving without you."', {
          gates: [{ type: 'flag', flag: 'tp_birth_cap_hollow' }],
        }),
        say('tp_heritage_captain_etienne', '"We missed it. Do not disappear now. Late arrivals leave quickly unless they choose otherwise."', {
          gates: [{ type: 'flag', flag: 'tp_heritage_heartbreak' }],
        }),
      ],
      choices: [
        {
          ...choice('tp-respect-birth', 'Embrace Brooks before kick-off', [rel('tp_birth_teammate_brooks', 2), pressure(-1), flag('tp_respected_birth')], 'scene1_final_crossroads'),
          gates: [
            { type: 'flag', flag: 'tp_heritage_qualified' },
            { type: 'flag', flag: 'tp_respected_birth', value: false },
          ],
        },
        {
          ...choice('tp-play-vs-birth', 'Play the World Cup opener against your birth country', [flag('tp_played_vs_birth')], 'scene2_bridge_draw', { matchId: 'tp_worldcup_vs_birth' }),
          gates: [{ type: 'flag', flag: 'tp_heritage_qualified' }],
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'tp_worldcup_vs_birth', result: 'win' }, { type: 'relationship', npcId: 'tp_birth_teammate_brooks', min: 1 }], nextSceneId: 'scene2_bridge_win', consequences: [rep(6), morale(4), press(-1), fan(1), flag('tp_bridge_win')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_worldcup_vs_birth', result: 'win' }], nextSceneId: 'scene2_borrowed_badge', consequences: [rep(4), pressure(2), press(2), fan(1), flag('tp_borrowed_badge')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_worldcup_vs_birth', result: 'draw' }], nextSceneId: 'scene2_bridge_draw', consequences: [rep(3), morale(2), fan(1), flag('tp_bridge_draw')] },
            { gates: [{ type: 'matchResult', matchId: 'tp_worldcup_vs_birth', result: 'loss' }], nextSceneId: 'scene2_return_loss', consequences: [pressure(2), press(2), fan(1), morale(-1), flag('tp_return_loss')] },
          ],
        },
        {
          ...choice('tp-finish-birth-shirt', 'Face the cameras in the birth-country tracksuit', [rep(2), stat('mental', 1), flag('tp_larger_flag'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'flag', flag: 'tp_birth_squad_place' }],
        },
        {
          ...choice('tp-finish-birth-bench', 'Commit to fighting from the bench', [rel('tp_birth_teammate_brooks', 2), stat('mental', 2), flag('tp_larger_flag'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'flag', flag: 'tp_birth_bench' }],
        },
        {
          ...choice('tp-finish-hollow', 'Call Ana before the next squad list drops', [rel('tp_grandmother_ana', 2), pressure(-1), flag('tp_hollow_apology'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'flag', flag: 'tp_birth_cap_hollow' }],
        },
        {
          ...choice('tp-finish-heartbreak', 'Stay with Haiti through the fallout', [rel('tp_heritage_captain_etienne', 2), stat('mental', 2), flag('tp_stayed_with_haiti'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'flag', flag: 'tp_heritage_heartbreak' }],
        },
        {
          ...choice('tp-finish-nearly', 'Stay with Haiti through the empty airport', [rel('tp_heritage_captain_etienne', 2), morale(1), flag('tp_stayed_with_haiti'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'flag', flag: 'tp_heritage_nearly' }],
        },
        {
          ...choice('tp-finish-public-split', 'Give one interview saying no flag owns the whole story', [rep(2), stat('mental', 2), press(-2), fan(-1), flag('tp_ending_public_split'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'pressPressure', min: 6 }],
        },
        {
          ...choice('tp-finish-two-crowds', 'Promise to keep showing up for the crowd that still waits', [rel('tp_grandmother_ana', 2), morale(2), fan(-2), flag('tp_ending_two_crowds'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'fanPressure', min: 6 }],
        },
      ],
    },
    {
      id: 'scene2_bridge_win',
      background: { type: 'media', variant: 'pressRoom' },
      characters: [
        { id: 'tp_reporter_malik', position: 'left', pose: 'reporter_notepad', expression: 'surprised' },
        { id: 'tp_birth_teammate_brooks', position: 'right', pose: 'young_teammate_red_kit', expression: 'neutral' },
      ],
      dialogue: [
        say('tp_reporter_malik', '"You beat them and still embraced Brooks at full time. Defector? Bridge? What are you?"'),
        say('tp_birth_teammate_brooks', '"He is a footballer. He picked his room. We were late."'),
      ],
      choices: [
        choice('tp-ending-bridge', 'Say both countries made you, but only one trusted you in time', [rel('tp_birth_teammate_brooks', 2), rep(5), morale(3), press(-2), flag('tp_ending_bridge'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
      ],
    },
    {
      id: 'scene2_bridge_draw',
      background: { type: 'town', variant: 'street' },
      characters: [{ id: 'tp_grandmother_ana', position: 'center', pose: 'family_casual', expression: 'happy' }],
      dialogue: [
        say('tp_grandmother_ana', '"A point at the World Cup. Do you understand what a point can mean when people waited this long?"'),
        say('tp_grandmother_ana', '"You sang the hard words. I heard you."', {
          gates: [{ type: 'flag', flag: 'tp_spoke_language' }],
        }),
      ],
      choices: [
        choice('tp-ending-return', 'Give the shirt to Ana in the front row', [rel('tp_grandmother_ana', 4), rep(4), morale(4), fan(1), flag('tp_ending_return'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
      ],
    },
    {
      id: 'scene2_borrowed_badge',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'tp_heritage_captain_etienne', position: 'center', pose: 'captain_red_kit', expression: 'neutral' }],
      dialogue: [
        say('tp_heritage_captain_etienne', '"You scored. The country will love it. But some of the lads still do not know if you loved the shirt or the stage."'),
      ],
      choices: [
        choice('tp-ending-borrowed', 'Ask Etienne what earning the room really takes', [rel('tp_heritage_captain_etienne', 2), pressure(-1), press(-1), flag('tp_ending_borrowed_badge'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
      ],
    },
    {
      id: 'scene2_return_loss',
      background: { type: 'lockerRoom', variant: 'after' },
      characters: [{ id: 'tp_heritage_manager_desrosiers', position: 'center', pose: 'manager_overcoat', expression: 'concerned' }],
      dialogue: [
        say('tp_heritage_manager_desrosiers', '"They beat us. That does not erase the return. Do not let the old country take the new one from you twice."'),
      ],
      choices: [
        choice('tp-ending-return-loss', 'Tell the squad this return is bigger than revenge', [stat('mental', 2), morale(2), fan(-1), flag('tp_ending_return_loss'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
      ],
    },
  ],
};
