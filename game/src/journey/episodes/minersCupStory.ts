import type { Episode, JourneyMatchId, NPC, StoryRoute } from '../types';

export const minersCupNPCs: NPC[] = [
  {
    id: 'mc_captain_eddie',
    name: 'Eddie Rowell',
    role: 'teammate',
    description: 'A colliery captain with a cracked rib, a ledger of debts, and no patience for romance.',
    defaultPose: 'captain_flatcap',
  },
  {
    id: 'mc_secretary_hawthorn',
    name: 'Mr Hawthorn',
    role: 'assistant',
    description: 'The club secretary, suddenly asked to turn miners into England\'s answer abroad.',
    defaultPose: 'secretary_papers',
  },
  {
    id: 'mc_foreman_doyle',
    name: 'Foreman Doyle',
    role: 'rival',
    description: 'The pit foreman who sees the cup as lost wages wearing a clean collar.',
    defaultPose: 'foreman_coat',
  },
  {
    id: 'mc_wife_mary',
    name: 'Mary Kerr',
    role: 'family',
    description: 'Tommy\'s wife, proud enough to let him go and angry enough to make him remember the cost.',
    defaultPose: 'family_casual',
  },
  {
    id: 'mc_organiser_bell',
    name: 'Alistair Bell',
    role: 'manager',
    description: 'A tournament fixer who talks like the cup is destiny and pays like it is a favour.',
    defaultPose: 'chairman_suit',
  },
  {
    id: 'mc_turin_clerk_luca',
    name: 'Luca Rinaldi',
    role: 'media',
    description: 'A Turin hotel clerk who runs messages, translates insults, and knows which crowds are dangerous.',
    defaultPose: 'reporter_notepad',
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

const colliery = { type: 'town' as const, variant: 'street' as const, asset: 'assets/journey/backgrounds/mc_colliery_street.webp', overlay: 'medium' as const };
const committee = { type: 'media' as const, variant: 'pressRoom' as const, asset: 'assets/journey/backgrounds/mc_committee_room.webp', overlay: 'medium' as const };
const station = { type: 'town' as const, variant: 'street' as const, asset: 'assets/journey/backgrounds/mc_steam_station.webp', overlay: 'dark' as const };
const hotel = { type: 'home' as const, variant: 'livingRoom' as const, asset: 'assets/journey/backgrounds/mc_turin_hotel_wire_desk.webp', overlay: 'medium' as const };
const stadium = { type: 'pitch' as const, variant: 'match' as const, asset: 'assets/journey/backgrounds/mc_turin_stadium.webp', overlay: 'medium' as const };

export const minersCupEpisode1: Episode = {
  id: 'mc_ep1_invite',
  title: 'The Invitation Nobody Wanted',
  season: 1909,
  episodeNumber: 1,
  campaignId: 'miners-cup-story',
  description: 'A colliery team is asked to cross Europe because the authorities would not send anyone else.',
  scenes: [
    {
      id: 'scene1_shift_end',
      background: colliery,
      characters: [
        { id: 'mc_captain_eddie', position: 'left', pose: 'captain_flatcap', expression: 'determined' },
        { id: 'mc_foreman_doyle', position: 'right', pose: 'foreman_coat', expression: 'angry' },
      ],
      dialogue: [
        say('mc_foreman_doyle', '"You missed half a shift for football last week. Now they say Italy. Who feeds the bairns while you play at ambassadors?"'),
        say('mc_captain_eddie', '"The English lot would not send a proper club. So they sent for us. That is either an insult or a door."'),
      ],
      choices: [
        { id: 'mc_take_wages_risk', text: 'Say the men will pay their own way if they must', consequences: [flag('mc_paid_own_way'), morale(2), pressure(2), fan(1), rel('mc_captain_eddie', 1)], nextSceneId: 'scene2_committee' },
        { id: 'mc_demand_guarantee', text: 'Demand a written guarantee before anyone leaves the pit', consequences: [flag('mc_demanded_guarantee'), pressure(-1), press(-1), rel('mc_secretary_hawthorn', 1)], nextSceneId: 'scene2_committee' },
      ],
    },
    {
      id: 'scene2_committee',
      background: committee,
      characters: [
        { id: 'mc_secretary_hawthorn', position: 'left', pose: 'secretary_papers', expression: 'concerned' },
        { id: 'mc_wife_mary', position: 'right', pose: 'family_casual', expression: 'concerned' },
      ],
      dialogue: [
        say('mc_secretary_hawthorn', '"There may be no telephone from the hotel. Cablegrams if we are lucky. Newspapers if we are not."'),
        say('mc_wife_mary', '"Then make your choices before you go. We cannot argue with a silence across the sea."'),
      ],
      choices: [
        { id: 'mc_promise_home', text: 'Promise Mary every cable will tell the truth', consequences: [flag('mc_promised_truth'), rel('mc_wife_mary', 2), stat('mental', 2), next('mc_ep2_turin')], nextSceneId: 'scene1_station' },
        { id: 'mc_protect_room', text: 'Promise Eddie the dressing room hears no fear', consequences: [flag('mc_protected_room'), rel('mc_captain_eddie', 2), stat('physical', 2), next('mc_ep2_turin')], nextSceneId: 'scene1_station' },
      ],
    },
  ],
};

export const minersCupEpisode2: Episode = {
  id: 'mc_ep2_turin',
  title: 'The Long Way To Turin',
  season: 1909,
  episodeNumber: 2,
  campaignId: 'miners-cup-story',
  description: 'The journey turns novelty into jeopardy before the first whistle.',
  unlockRequirement: { type: 'episode', episodeId: 'mc_ep1_invite' },
  scenes: [
    {
      id: 'scene1_station',
      background: station,
      characters: [
        { id: 'mc_captain_eddie', position: 'left', pose: 'captain_flatcap', expression: 'determined' },
        { id: 'mc_organiser_bell', position: 'right', pose: 'chairman_suit', expression: 'neutral' },
      ],
      dialogue: [
        say('mc_organiser_bell', '"The Germans are organised, drilled, and offended that coalmen were invited. Excellent theatre."'),
        say('mc_captain_eddie', '"Theatre? We have men sleeping in boots because the bags went missing at Calais."'),
      ],
      choices: [
        {
          id: 'mc_play_semi',
          text: 'Face Stuttgart Foundry with tired legs',
          consequences: [flag('mc_reached_turin'), pressure(1), fan(1)],
          nextSceneId: 'scene2_after_semi',
          match: { matchId: 'mc_turin_semi' },
          postMatchRoutes: routes('mc_turin_semi', 'scene2_semi_win', 'scene2_semi_draw', 'scene2_semi_loss'),
        },
      ],
    },
    {
      id: 'scene2_semi_win',
      background: stadium,
      characters: [{ id: 'mc_turin_clerk_luca', position: 'right', pose: 'reporter_notepad', expression: 'surprised' }],
      dialogue: [say('mc_turin_clerk_luca', '"The papers called you miners this morning. Tonight they ask how many more are hidden underground."')],
      choices: [{ id: 'mc_wire_win', text: 'Send the result home by cable', consequences: [rep(3), morale(2), press(-1), fan(2), next('mc_ep3_first_cup')], nextSceneId: 'scene1_hotel' }],
    },
    {
      id: 'scene2_semi_draw',
      background: stadium,
      characters: [{ id: 'mc_captain_eddie', position: 'left', pose: 'captain_flatcap', expression: 'concerned' }],
      dialogue: [say('mc_captain_eddie', '"A replay would ruin us. So we treat the draw like a warning and find another yard."')],
      choices: [{ id: 'mc_wire_draw', text: 'Admit the legs are heavy but the cup is still alive', consequences: [pressure(1), press(1), fan(1), morale(1), next('mc_ep3_first_cup')], nextSceneId: 'scene1_hotel' }],
    },
    {
      id: 'scene2_semi_loss',
      background: stadium,
      characters: [{ id: 'mc_wife_mary', position: 'right', pose: 'family_casual', expression: 'concerned' }],
      dialogue: [say('mc_wife_mary', '"A delayed cable reaches the hotel: if you come home empty, come home honest."')],
      choices: [{ id: 'mc_wire_loss', text: 'Ask for one more match and one more chance', consequences: [pressure(3), press(2), fan(1), morale(-2), next('mc_ep3_first_cup')], nextSceneId: 'scene1_hotel' }],
    },
  ],
};

export const minersCupEpisode3: Episode = {
  id: 'mc_ep3_first_cup',
  title: 'The Unknown Cup',
  season: 1909,
  episodeNumber: 3,
  campaignId: 'miners-cup-story',
  description: 'The final arrives before anyone back home knows whether the tournament matters.',
  unlockRequirement: { type: 'episode', episodeId: 'mc_ep2_turin' },
  scenes: [
    {
      id: 'scene1_hotel',
      background: hotel,
      characters: [
        { id: 'mc_secretary_hawthorn', position: 'left', pose: 'secretary_papers', expression: 'concerned' },
        { id: 'mc_turin_clerk_luca', position: 'right', pose: 'reporter_notepad', expression: 'neutral' },
      ],
      dialogue: [
        say('mc_secretary_hawthorn', '"No reply from home. Either the cable failed or they are too frightened to answer."'),
        say('mc_turin_clerk_luca', '"Winterthur believe you are a curiosity. Curiosities do not lift cups here."'),
      ],
      choices: [
        {
          id: 'mc_face_cable_crisis',
          text: 'Open the delayed cable before the final',
          consequences: [flag('mc_cable_opened'), pressure(1)],
          nextSceneId: 'scene1b_stolen_cable',
        },
      ],
    },
    {
      id: 'scene1b_stolen_cable',
      background: hotel,
      characters: [
        { id: 'mc_wife_mary', position: 'left', pose: 'family_casual', expression: 'concerned' },
        { id: 'mc_captain_eddie', position: 'right', pose: 'captain_flatcap', expression: 'angry' },
      ],
      dialogue: [
        say('mc_wife_mary', '"The cable is three days old. Doyle marked two families short on wages and told the village the cup will not feed them."'),
        say('mc_captain_eddie', '"Half the room wants to send money home. Half wants to smash the hotel desk. We have a final in an hour."'),
        say('mc_wife_mary', '"You promised the truth. Here it is: if you lift that cup, make sure the men can still go home."', {
          gates: [{ type: 'flag', flag: 'mc_promised_truth' }],
        }),
      ],
      choices: [
        {
          id: 'mc_final_pawn_watch',
          text: 'Pawn your watch and cable the money home',
          consequences: [rel('mc_wife_mary', 3), morale(2), pressure(1), press(-1), flag('mc_pawned_watch')],
          nextSceneId: 'scene1c_final_walkout',
        },
        {
          id: 'mc_final_lock_room',
          text: 'Lock the dressing room and turn the anger into the first tackle',
          consequences: [rel('mc_captain_eddie', 2), stat('physical', 2), pressure(2), fan(1), flag('mc_locked_room')],
          nextSceneId: 'scene1c_final_walkout',
        },
        {
          id: 'mc_final_demand_bell',
          text: 'Force Bell to guarantee the travel purse in writing',
          consequences: [rel('mc_organiser_bell', -1), stat('mental', 2), pressure(-1), press(-1), flag('mc_forced_bell_purse')],
          nextSceneId: 'scene1c_final_walkout',
        },
      ],
    },
    {
      id: 'scene1c_final_walkout',
      background: stadium,
      characters: [{ id: 'mc_captain_eddie', position: 'center', pose: 'captain_flatcap', expression: 'determined' }],
      dialogue: [
        say('mc_captain_eddie', '"Right then. No more cables. No more committees. If they want to know what coalmen are worth, we show them on grass."'),
      ],
      choices: [
        {
          id: 'mc_play_final',
          text: 'Walk out for the first final',
          consequences: [flag('mc_played_first_final'), stat('mental', 1)],
          nextSceneId: 'scene2_after_final',
          match: { matchId: 'mc_turin_final' },
          postMatchRoutes: routes('mc_turin_final', 'scene2_final_win', 'scene2_final_draw', 'scene2_final_loss'),
        },
      ],
    },
    {
      id: 'scene2_final_win',
      background: stadium,
      characters: [{ id: 'mc_captain_eddie', position: 'center', pose: 'captain_flatcap', expression: 'happy' }],
      dialogue: [say('mc_captain_eddie', '"If it was a joke, it has our name on it now."')],
      choices: [{ id: 'mc_defend_after_win', text: 'Agree to come back and defend it', consequences: [flag('mc_first_cup_won'), rep(5), morale(3), next('mc_ep4_defence')], nextSceneId: 'scene1_return' }],
    },
    {
      id: 'scene2_final_draw',
      background: stadium,
      characters: [{ id: 'mc_organiser_bell', position: 'right', pose: 'chairman_suit', expression: 'concerned' }],
      dialogue: [say('mc_organiser_bell', '"A drawn final is a bill with no signature. You may yet make it worth something."')],
      choices: [{ id: 'mc_defend_after_draw', text: 'Swear the next trip will leave no argument', consequences: [flag('mc_first_cup_unsettled'), pressure(2), next('mc_ep4_defence')], nextSceneId: 'scene1_return' }],
    },
    {
      id: 'scene2_final_loss',
      background: stadium,
      characters: [{ id: 'mc_foreman_doyle', position: 'right', pose: 'foreman_coat', expression: 'angry' }],
      dialogue: [say('mc_foreman_doyle', '"The foreman\'s cable is waiting: come back for work, not applause."')],
      choices: [{ id: 'mc_defend_after_loss', text: 'Choose to return anyway and prove the trip was not vanity', consequences: [flag('mc_first_cup_lost'), pressure(3), morale(-1), next('mc_ep4_defence')], nextSceneId: 'scene1_return' }],
    },
  ],
};

export const minersCupEpisode4: Episode = {
  id: 'mc_ep4_defence',
  title: 'Back To Turin',
  season: 1911,
  episodeNumber: 4,
  campaignId: 'miners-cup-story',
  description: 'The second journey asks whether the first cup was a miracle or a warning.',
  unlockRequirement: { type: 'episode', episodeId: 'mc_ep3_first_cup' },
  scenes: [
    {
      id: 'scene1_return',
      background: hotel,
      characters: [
        { id: 'mc_wife_mary', position: 'left', pose: 'family_casual', expression: 'concerned' },
        { id: 'mc_captain_eddie', position: 'right', pose: 'captain_flatcap', expression: 'determined' },
      ],
      dialogue: [
        say('mc_wife_mary', '"The trophy sat in a window and still did not pay the grocer. Make this last trip mean something useful."'),
        say('mc_captain_eddie', '"Turin Mechanics have the crowd, the money, and a city behind them. We have everything we pawned to get here."'),
      ],
      choices: [
        {
          id: 'mc_face_walkout_threat',
          text: 'Face the organiser before the defence',
          consequences: [flag('mc_returned_to_turin'), pressure(1), fan(1)],
          nextSceneId: 'scene1b_walkout_threat',
        },
      ],
    },
    {
      id: 'scene1b_walkout_threat',
      background: committee,
      characters: [
        { id: 'mc_organiser_bell', position: 'left', pose: 'chairman_suit', expression: 'concerned' },
        { id: 'mc_captain_eddie', position: 'right', pose: 'captain_flatcap', expression: 'angry' },
      ],
      dialogue: [
        say('mc_organiser_bell', '"The Mechanics refuse to walk out unless the gate is split again. They say last time was romance. This time is business."'),
        say('mc_captain_eddie', '"Business? We crossed Europe on borrowed boots while their committee counts tickets."'),
        say('mc_organiser_bell', '"If you refuse, the papers write that miners killed the cup before defending it."'),
      ],
      choices: [
        {
          id: 'mc_defence_share_gate',
          text: 'Share the gate and make the match impossible to cancel',
          consequences: [pressure(-1), press(-1), rel('mc_organiser_bell', 2), morale(-1), flag('mc_shared_gate')],
          nextSceneId: 'scene1c_defence_walkout',
        },
        {
          id: 'mc_defence_refuse_terms',
          text: 'Refuse the terms and dare them to face an empty pitch',
          consequences: [rep(2), pressure(3), press(2), fan(1), rel('mc_captain_eddie', 2), flag('mc_refused_gate_terms')],
          nextSceneId: 'scene1c_defence_walkout',
        },
        {
          id: 'mc_defence_send_purse_home',
          text: 'Promise half the purse goes straight back to the coalfield',
          consequences: [rel('mc_wife_mary', 2), morale(2), stat('mental', 1), fan(-1), flag('mc_promised_purse_home')],
          nextSceneId: 'scene1c_defence_walkout',
        },
      ],
    },
    {
      id: 'scene1c_defence_walkout',
      background: stadium,
      characters: [{ id: 'mc_secretary_hawthorn', position: 'center', pose: 'secretary_papers', expression: 'determined' }],
      dialogue: [
        say('mc_secretary_hawthorn', '"The terms are ugly. So was the journey. The whistle is the only honest thing left."'),
      ],
      choices: [
        {
          id: 'mc_play_defence',
          text: 'Defend the cup against Turin Mechanics',
          consequences: [flag('mc_walked_out_for_defence')],
          nextSceneId: 'scene2_legacy',
          match: { matchId: 'mc_turin_defence' },
          postMatchRoutes: routes('mc_turin_defence', 'scene2_defence_win', 'scene2_defence_draw', 'scene2_defence_loss'),
        },
      ],
    },
    {
      id: 'scene2_defence_win',
      background: stadium,
      characters: [{ id: 'mc_secretary_hawthorn', position: 'center', pose: 'secretary_papers', expression: 'happy' }],
      dialogue: [say('mc_secretary_hawthorn', '"This time the cable home is short: won again. They will understand the rest when we arrive."')],
      choices: [
        { id: 'mc_complete_win', text: 'Carry the cup back to the coalfield', consequences: [flag('mc_legacy_won'), rep(8), morale(5), fan(2), next('season_complete')], nextSceneId: 'scene2_defence_win' },
        {
          id: 'mc_complete_win_ledger',
          text: 'Put the cup beside the wage ledger and make Bell sign the purse',
          consequences: [flag('mc_legacy_won_with_ledger'), rep(6), morale(3), press(-2), fan(-1), next('season_complete')],
          nextSceneId: 'scene2_defence_win',
          gates: [{ type: 'pressPressure', min: 5 }],
        },
      ],
    },
    {
      id: 'scene2_defence_draw',
      background: stadium,
      characters: [{ id: 'mc_captain_eddie', position: 'center', pose: 'captain_flatcap', expression: 'determined' }],
      dialogue: [say('mc_captain_eddie', '"They could not beat us. Some days that is how a working man writes his name."')],
      choices: [
        { id: 'mc_complete_draw', text: 'Leave Turin with the story intact', consequences: [flag('mc_legacy_survived'), rep(4), morale(2), next('season_complete')], nextSceneId: 'scene2_defence_draw' },
        {
          id: 'mc_complete_draw_respected',
          text: 'Tell the men a draw abroad can still feed the story at home',
          consequences: [flag('mc_legacy_respected_draw'), rep(3), morale(3), fan(-1), next('season_complete')],
          nextSceneId: 'scene2_defence_draw',
          gates: [{ type: 'fanPressure', max: 6 }],
        },
      ],
    },
    {
      id: 'scene2_defence_loss',
      background: stadium,
      characters: [{ id: 'mc_wife_mary', position: 'center', pose: 'family_casual', expression: 'concerned' }],
      dialogue: [say('mc_wife_mary', '"Then bring the men home. A cup can be lost. A village cannot."')],
      choices: [
        { id: 'mc_complete_loss', text: 'Come home without pretending it did not hurt', consequences: [flag('mc_legacy_lost'), pressure(2), morale(-1), next('season_complete')], nextSceneId: 'scene2_defence_loss' },
        {
          id: 'mc_complete_loss_room_split',
          text: 'Face the village meeting before anyone can call the trip vanity',
          consequences: [flag('mc_legacy_room_split'), pressure(3), press(-1), fan(-2), morale(-2), next('season_complete')],
          nextSceneId: 'scene2_defence_loss',
          gates: [{ type: 'fanPressure', min: 6 }],
        },
      ],
    },
  ],
};
