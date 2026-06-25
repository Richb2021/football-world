import type { Episode, JourneyMatchId, NPC, StoryRoute } from '../types';

export const firstElevenNPCs: NPC[] = [
  {
    id: 'fe_captain_muir',
    name: 'Robert Muir',
    role: 'teammate',
    description: 'A Scottish captain who believes passing can look like a national argument won cleanly.',
    defaultPose: 'captain_wool_kit',
  },
  {
    id: 'fe_secretary_mackay',
    name: 'James Mackay',
    role: 'manager',
    description: 'The club secretary trying to turn a newspaper challenge into a recognised international.',
    defaultPose: 'secretary_papers',
  },
  {
    id: 'fe_newspaper_bell',
    name: 'Mr Bell',
    role: 'media',
    description: 'A newspaper man who knows that if the public does not understand the match, it may never happen again.',
    defaultPose: 'reporter_notepad',
  },
  {
    id: 'fe_english_captain_hart',
    name: 'Arthur Hart',
    role: 'rival',
    description: 'The English captain, polite enough to shake hands and proud enough to expect obedience from the game.',
    defaultPose: 'captain_old_kit',
  },
  {
    id: 'fe_goalkeeper_fergus',
    name: 'Fergus Bain',
    role: 'teammate',
    description: 'A goalkeeper learning that a clean sheet can be as loud as a goal.',
    defaultPose: 'goalkeeper_cap',
  },
  {
    id: 'fe_fa_messenger_alden',
    name: 'Mr Alden',
    role: 'assistant',
    description: 'An English association messenger carrying rules, timings, and a faint suspicion that Scotland may not be ready.',
    defaultPose: 'agent_suit',
  },
];

function say(speakerId: string, text: string, extra?: any) {
  return { speakerId, text, ...extra };
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

function next(episodeId: string) {
  return { type: 'nextEpisode' as const, episodeId };
}

function routes(matchId: JourneyMatchId, win: string, draw: string, loss: string): StoryRoute[] {
  return [
    { gates: [{ type: 'matchResult', matchId, result: 'win' }], nextSceneId: win },
    { gates: [{ type: 'matchResult', matchId, result: 'draw' }], nextSceneId: draw },
    { gates: [{ type: 'matchResult', matchId, result: 'loss' }], nextSceneId: loss },
  ];
}

const newspaper = { type: 'media' as const, variant: 'pressRoom' as const, asset: 'assets/journey/backgrounds/fe_newspaper_office.webp', overlay: 'medium' as const };
const committee = { type: 'town' as const, variant: 'shop' as const, asset: 'assets/journey/backgrounds/fe_committee_room.webp', overlay: 'medium' as const };
const crescent = { type: 'pitch' as const, variant: 'match' as const, asset: 'assets/journey/backgrounds/fe_hamilton_crescent.webp', overlay: 'medium' as const };
const pavilion = { type: 'lockerRoom' as const, variant: 'before' as const, asset: 'assets/journey/backgrounds/fe_pavilion.webp', overlay: 'medium' as const };

export const firstElevenEpisode1: Episode = {
  id: 'fe_ep1_challenge',
  title: 'A Challenge In The Papers',
  season: 1872,
  episodeNumber: 1,
  campaignId: 'first-eleven-story',
  description: 'A public challenge asks whether two countries can meet under rules still being argued into shape.',
  scenes: [
    {
      id: 'scene1_newspaper',
      background: newspaper,
      characters: [
        { id: 'fe_newspaper_bell', position: 'left', pose: 'reporter_notepad', expression: 'neutral' },
        { id: 'fe_secretary_mackay', position: 'right', pose: 'secretary_papers', expression: 'concerned' },
      ],
      dialogue: [
        say('fe_newspaper_bell', '"The London challenge has been printed again. They call it England against Scotland, but half the last side lived closer to the Thames than the Clyde."'),
        say('fe_secretary_mackay', '"Then we answer with men from here. Not a grievance. A team."'),
      ],
      choices: [
        { id: 'fe_answer_publicly', text: 'Answer in the paper and force the match into public view', consequences: [flag('fe_answered_publicly'), rep(2), pressure(2), press(2), fan(1)], nextSceneId: 'scene2_committee' },
        { id: 'fe_build_quietly', text: 'Secure the players first before the papers make it theatre', consequences: [flag('fe_built_quietly'), rel('fe_secretary_mackay', 2), stat('mental', 1), press(-1)], nextSceneId: 'scene2_committee' },
      ],
    },
    {
      id: 'scene2_committee',
      background: committee,
      characters: [
        { id: 'fe_captain_muir', position: 'left', pose: 'captain_wool_kit', expression: 'determined' },
        { id: 'fe_fa_messenger_alden', position: 'right', pose: 'agent_suit', expression: 'neutral' },
      ],
      dialogue: [
        say('fe_fa_messenger_alden', '"The English party will come by rail if the ground is fit, the rules are agreed, and the crowd is orderly."'),
        say('fe_captain_muir', '"If he wants order, we will pass the ball until he understands it."'),
      ],
      choices: [
        { id: 'fe_drill_passing', text: 'Drill the passing game until it becomes identity', consequences: [flag('fe_drilled_passing'), stat('passing', 2), morale(1), next('fe_ep2_hamilton')], nextSceneId: 'scene1_pavilion' },
        { id: 'fe_drill_defence', text: 'Build the match around a clean sheet first', consequences: [flag('fe_drilled_defence'), stat('defending', 2), rel('fe_goalkeeper_fergus', 1), next('fe_ep2_hamilton')], nextSceneId: 'scene1_pavilion' },
      ],
    },
  ],
};

export const firstElevenEpisode2: Episode = {
  id: 'fe_ep2_hamilton',
  title: 'Hamilton Crescent',
  season: 1872,
  episodeNumber: 2,
  campaignId: 'first-eleven-story',
  description: 'The ground, the crowd, and the rules all have to hold long enough for the first whistle.',
  unlockRequirement: { type: 'episode', episodeId: 'fe_ep1_challenge' },
  scenes: [
    {
      id: 'scene1_pavilion',
      background: pavilion,
      characters: [
        { id: 'fe_goalkeeper_fergus', position: 'left', pose: 'goalkeeper_cap', expression: 'concerned' },
        { id: 'fe_english_captain_hart', position: 'right', pose: 'captain_old_kit', expression: 'neutral' },
      ],
      dialogue: [
        say('fe_goalkeeper_fergus', '"Four thousand at a cricket ground to see if a football match can be a country."'),
        say('fe_english_captain_hart', '"Let us hope the fog lifts before pride makes fools of us all."'),
      ],
      choices: [
        {
          id: 'fe_face_rules_crisis',
          text: 'Settle the rules before the crowd turns',
          consequences: [flag('fe_rules_crisis_started'), pressure(1), press(1)],
          nextSceneId: 'scene1b_rules_crisis',
        },
      ],
    },
    {
      id: 'scene1b_rules_crisis',
      background: crescent,
      characters: [
        { id: 'fe_fa_messenger_alden', position: 'left', pose: 'agent_suit', expression: 'concerned' },
        { id: 'fe_captain_muir', position: 'right', pose: 'captain_wool_kit', expression: 'determined' },
      ],
      dialogue: [
        say('fe_fa_messenger_alden', '"The crowd is over the rope, the fog is back, and Hart says he will not start unless the disputed touchline is moved."'),
        say('fe_captain_muir', '"Move the line and we look grateful to be allowed our own match. Refuse and the first international dies in committee."'),
        say('fe_fa_messenger_alden', '"You made it public. Public things can burn quickly."', {
          gates: [{ type: 'flag', flag: 'fe_answered_publicly' }],
        }),
      ],
      choices: [
        {
          id: 'fe_rules_yield',
          text: 'Yield the touchline so the match survives',
          consequences: [stat('mental', 2), pressure(-1), press(-1), rel('fe_english_captain_hart', 1), flag('fe_yielded_touchline')],
          nextSceneId: 'scene1c_walkout',
        },
        {
          id: 'fe_rules_stand',
          text: 'Stand firm and make England play under the agreed terms',
          consequences: [rep(2), pressure(2), press(2), fan(1), morale(1), flag('fe_stood_on_rules')],
          nextSceneId: 'scene1c_walkout',
        },
        {
          id: 'fe_rules_keeper',
          text: 'Send Fergus to calm the rope line before pride spills over',
          consequences: [rel('fe_goalkeeper_fergus', 2), stat('defending', 1), morale(1), flag('fe_fergus_calmed_rope')],
          nextSceneId: 'scene1c_walkout',
        },
      ],
    },
    {
      id: 'scene1c_walkout',
      background: pavilion,
      characters: [{ id: 'fe_captain_muir', position: 'center', pose: 'captain_wool_kit', expression: 'determined' }],
      dialogue: [
        say('fe_captain_muir', '"The line is set, the fog is lifting, and there is no hiding now. Let the ball say what the committees cannot."'),
      ],
      choices: [
        {
          id: 'fe_play_first_international',
          text: 'Walk out for the first international',
          consequences: [flag('fe_match_began'), pressure(1), fan(1)],
          nextSceneId: 'scene2_after_match',
          match: { matchId: 'fe_hamilton_crescent' },
          postMatchRoutes: routes('fe_hamilton_crescent', 'scene2_first_win', 'scene2_first_draw', 'scene2_first_loss'),
        },
      ],
    },
    {
      id: 'scene2_first_win',
      background: crescent,
      characters: [{ id: 'fe_captain_muir', position: 'center', pose: 'captain_wool_kit', expression: 'happy' }],
      dialogue: [say('fe_captain_muir', '"They came to test whether we existed. A winner makes the answer hard to edit."')],
      choices: [{ id: 'fe_after_win', text: 'Ask for the fixture to be repeated', consequences: [flag('fe_first_match_won'), rep(4), morale(3), next('fe_ep3_first_whistle')], nextSceneId: 'scene1_report' }],
    },
    {
      id: 'scene2_first_draw',
      background: crescent,
      characters: [{ id: 'fe_goalkeeper_fergus', position: 'center', pose: 'goalkeeper_cap', expression: 'determined' }],
      dialogue: [say('fe_goalkeeper_fergus', '"Nil-nil. No anthem could be louder. They know we were here."')],
      choices: [{ id: 'fe_after_draw', text: 'Protect the draw as proof the match belongs to both countries', consequences: [flag('fe_first_match_drawn'), rep(3), morale(2), next('fe_ep3_first_whistle')], nextSceneId: 'scene1_report' }],
    },
    {
      id: 'scene2_first_loss',
      background: crescent,
      characters: [{ id: 'fe_newspaper_bell', position: 'center', pose: 'reporter_notepad', expression: 'concerned' }],
      dialogue: [say('fe_newspaper_bell', '"A defeat can still print as a beginning, if the men do not look beaten while leaving."')],
      choices: [{ id: 'fe_after_loss', text: 'Turn defeat into the case for a return match', consequences: [flag('fe_first_match_lost'), pressure(2), morale(-1), next('fe_ep3_first_whistle')], nextSceneId: 'scene1_report' }],
    },
  ],
};

export const firstElevenEpisode3: Episode = {
  id: 'fe_ep3_first_whistle',
  title: 'The Match That Must Exist',
  season: 1872,
  episodeNumber: 3,
  campaignId: 'first-eleven-story',
  description: 'The result matters, but the greater prize is convincing everyone that the fixture deserves a future.',
  unlockRequirement: { type: 'episode', episodeId: 'fe_ep2_hamilton' },
  scenes: [
    {
      id: 'scene1_report',
      background: newspaper,
      characters: [
        { id: 'fe_newspaper_bell', position: 'left', pose: 'reporter_notepad', expression: 'neutral' },
        { id: 'fe_secretary_mackay', position: 'right', pose: 'secretary_papers', expression: 'determined' },
      ],
      dialogue: [
        say('fe_newspaper_bell', '"The report will not call it perfect. Good. Perfect things are curiosities. Contested things return."'),
        say('fe_secretary_mackay', '"Then write that the train should run again next year."'),
        say('fe_newspaper_bell', '"Hart says the touchline decided more than the players did. That sentence sells papers, if I print it."', {
          gates: [{ type: 'flag', flag: 'fe_yielded_touchline' }],
        }),
        say('fe_newspaper_bell', '"Alden says the associations will deny any match that looks like a riot with boots on."', {
          gates: [{ type: 'flag', flag: 'fe_stood_on_rules' }],
        }),
      ],
      choices: [
        { id: 'fe_send_report_to_bell', text: 'Hand Bell the report before sending the telegram', consequences: [flag('fe_report_submitted'), pressure(1), press(1)], nextSceneId: 'scene1b_report_pressure' },
      ],
    },
    {
      id: 'scene1b_report_pressure',
      background: newspaper,
      characters: [
        { id: 'fe_newspaper_bell', position: 'left', pose: 'reporter_notepad', expression: 'determined' },
        { id: 'fe_secretary_mackay', position: 'right', pose: 'secretary_papers', expression: 'concerned' },
      ],
      dialogue: [
        say('fe_newspaper_bell', '"I can print scandal and make them answer. Or I can print dignity and hope they come back."'),
        say('fe_secretary_mackay', '"A fixture can be born from outrage, but it grows on trust."'),
      ],
      choices: [
        { id: 'fe_print_dignity', text: 'Print that the fixture deserves a future more than a feud', consequences: [flag('fe_fixture_future'), rep(3), morale(2), press(-2), next('season_complete')], nextSceneId: 'scene1b_report_pressure' },
        { id: 'fe_print_pressure', text: 'Print the controversy so neither association can bury it', consequences: [flag('fe_fixture_forced'), rep(4), pressure(2), press(2), fan(1), next('season_complete')], nextSceneId: 'scene1b_report_pressure' },
        {
          id: 'fe_print_foundation',
          text: 'Print the players by name and make the next fixture feel inevitable',
          consequences: [flag('fe_fixture_foundation'), rep(3), morale(3), fan(-1), next('season_complete')],
          nextSceneId: 'scene1b_report_pressure',
          gates: [{ type: 'fanPressure', max: 4 }],
        },
        {
          id: 'fe_print_scandal',
          text: 'Print the dispute hard enough that both committees must answer',
          consequences: [flag('fe_fixture_scandal'), rep(5), pressure(3), press(3), fan(1), next('season_complete')],
          nextSceneId: 'scene1b_report_pressure',
          gates: [{ type: 'pressPressure', min: 6 }],
        },
      ],
    },
  ],
};
