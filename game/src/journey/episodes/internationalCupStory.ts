import type { Episode, JourneyState, NPC } from '../types';

export const storyCampaignNPCs: NPC[] = [
  {
    id: 'doctor_evans',
    name: 'Dr. Alan Evans',
    role: 'physio',
    description: 'A quiet medical expert who tells the truth even when it hurts.',
    defaultPose: 'massage-table',
  },
  {
    id: 'manager_clough',
    name: 'Manager Clough',
    role: 'manager',
    description: 'Manager of your former club, who values budgets over sentiment.',
    defaultPose: 'manager_overcoat',
  },
  {
    id: 'agent_coyle',
    name: 'Tony Coyle',
    role: 'agent',
    description: 'Your loyal, smooth-talking agent who always has a plan.',
    defaultPose: 'agent_phone',
  },
  {
    id: 'ty_coach_bell',
    name: 'Manager Bell',
    role: 'manager',
    description: 'Harbour City FC manager. Tough, old-school, but rewards hard work.',
    defaultPose: 'ty_coach_bell',
  },
  {
    id: 'captain_whitlock',
    name: 'Carl Whitlock',
    role: 'teammate',
    description: 'Harbour City captain. An absolute warrior who demands 100% effort.',
    defaultPose: 'captain_red_kit',
  },
  {
    id: 'reporter_local',
    name: 'Danny Sloan',
    role: 'media',
    description: 'A sharp sports journalist who knows when to press for details.',
    defaultPose: 'reporter_notepad',
  },
  {
    id: 'england_roommate_fox',
    name: 'Daniel Fox',
    role: 'teammate',
    description: 'Your national squad roommate, quiet but a reliable friend.',
    defaultPose: 'young_teammate_red_kit',
  },
  {
    id: 'germany_captain_adler',
    name: 'Lukas Adler',
    role: 'rival',
    description: 'Germany\'s star defender, intense and physically imposing.',
    defaultPose: 'germany_defender',
  },
  // --- Expanded cast for the longer branching arc ---
  {
    id: 'rival_dane',
    name: 'Marcus Dane',
    role: 'rival',
    description: 'Harbour City\'s established striker. Talented, charming to the press, and quietly ruthless about protecting his shirt.',
    defaultPose: 'rival_striker',
  },
  {
    id: 'mentor_okafor',
    name: 'Eddie Okafor',
    role: 'assistant',
    description: 'Veteran assistant coach and former international. Sees the player you could become and refuses to let you waste it.',
    defaultPose: 'assistant_tracksuit',
  },
  {
    id: 'chairman_voss',
    name: 'Gerald Voss',
    role: 'manager',
    description: 'Harbour City\'s chairman. Smiles for the cameras, counts every penny behind closed doors.',
    defaultPose: 'chairman_suit',
  },
  {
    id: 'sister_mia',
    name: 'Mia',
    role: 'family',
    description: 'Your younger sister. Blunt, loyal, and the one person who tells you when your head\'s getting too big.',
    defaultPose: 'family_casual',
  },
  {
    id: 'agent_rival_sharpe',
    name: 'Dominic Sharpe',
    role: 'agent',
    description: 'A slick super-agent circling your signature, promising the world to anyone who\'ll listen.',
    defaultPose: 'agent_suit',
  },
  {
    id: 'pundit_grady',
    name: 'Ron Grady',
    role: 'media',
    description: 'A loud, old-school TV pundit who built a career on strong opinions and never apologising for them.',
    defaultPose: 'pundit_studio',
  },
  {
    id: 'physio_lane',
    name: 'Sara Lane',
    role: 'physio',
    description: 'Harbour City\'s head physio. Protective of her players and unafraid to overrule the manager on fitness.',
    defaultPose: 'physio_bag',
  },
  {
    id: 'teammate_reyes',
    name: 'Hugo Reyes',
    role: 'teammate',
    description: 'A flair winger and the joker of the dressing room — but a fierce friend when it counts.',
    defaultPose: 'young_teammate_red_kit',
  },
  {
    id: 'national_manager_strand',
    name: 'Coach Strand',
    role: 'manager',
    description: 'The national team manager. Calm, exacting, and impossible to read.',
    defaultPose: 'manager_overcoat',
  },
];

// Helper functions for building dialogue choices and actions
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

/**
 * Builds an `onEnter` handler that drops one or more phone messages into the
 * player's inbox when a scene is reached. Guards against undefined inboxes on
 * old saves and never adds the same message id twice.
 */
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

export const rtgEpisode1: Episode = {
  id: 'rtg_ep1_release',
  title: 'The Rejection',
  season: 2026,
  episodeNumber: 1,
  campaignId: 'international-cup-story',
  description: 'A career-threatening injury. A cold release letter. Your journey begins at the very bottom.',
  scenes: [
    {
      id: 'scene1_hospital',
      background: { type: 'hospital', variant: 'room' },
      music: 'tense-ambient',
      characters: [{ id: 'doctor_evans', position: 'right', pose: 'massage-table', expression: 'neutral' }],
      onEnter: pushMessages({
        id: 'rtg_m_sister_hospital',
        from: 'Mia',
        senderType: 'family',
        avatarSeed: 'sister_mia',
        time: 'Day 1',
        order: 3,
        text: 'Mum won\'t say it but she\'s been crying. Whatever that doctor tells you today, you come home and we figure it out together, alright? Don\'t do anything stupid. x',
      }),
      dialogue: [
        say('doctor_evans', '"The scans look clear, son. The knee reconstruction has held. You are cleared for light training."'),
        say('doctor_evans', '"But let\'s be honest. Returning to the level you were at before... it is going to take a miracle."'),
      ],
      choices: [
        choice('rehab-focus', 'Focus on aggressive physical recovery', [stat('physical', 4), pressure(2), injury(2), flag('rtg_aggr_rehab')], 'scene1b_evans_warning'),
        choice('rehab-careful', 'Take it slow and steady', [stat('mental', 4), morale(1), injury(-1), flag('rtg_slow_rehab')], 'scene1b_evans_warning'),
      ],
    },
    {
      id: 'scene1b_evans_warning',
      background: { type: 'hospital', variant: 'room' },
      music: 'tense-ambient',
      characters: [{ id: 'doctor_evans', position: 'right', pose: 'massage-table', expression: 'concerned' }],
      dialogue: [
        say('doctor_evans', '"One more thing, and I want you to hear it. The knee will tell you when it\'s had enough. Listen to it."'),
        say('doctor_evans', '"Push through real pain and you might not get a second reconstruction. There won\'t be a third career."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_aggr_rehab }),
        say('doctor_evans', '"Patience isn\'t weakness, whatever the lads in the dressing room tell you. Smart heals faster than stubborn."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_slow_rehab }),
      ],
      choices: [
        choice('evans-trust', 'Promise to keep him in the loop', [rel('doctor_evans', 3), flag('rtg_evans_trust')], 'scene2_old_club_office'),
        choice('evans-nod', 'Nod and head for the manager\'s office', [pressure(1)], 'scene2_old_club_office'),
      ],
    },
    {
      id: 'scene2_old_club_office',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'manager_clough', position: 'right', pose: 'manager_overcoat', expression: 'concerned' }],
      dialogue: [
        say('manager_clough', '"Take a seat. I\'ll get straight to it. We\'re releasing you. We can\'t carry a player with a reconstructed knee."'),
        say('manager_clough', '"It\'s business, son. I wish you the best, but your time here is done."'),
      ],
      choices: [
        choice('release-thank', 'Thank him for the opportunities', [rep(3), morale(1), flag('rtg_left_classy')], 'scene2b_corridor'),
        choice('release-angry', 'Tell him he is making a huge mistake', [pressure(3), stat('mental', -2), flag('rtg_left_angry')], 'scene2b_corridor'),
        choice('release-quiet', 'Say nothing and walk out', [stat('mental', 2), flag('rtg_left_quiet')], 'scene2b_corridor'),
      ],
    },
    {
      id: 'scene2b_corridor',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'reporter_local', position: 'right', pose: 'reporter_notepad', expression: 'neutral' }],
      onEnter: pushMessages({
        id: 'rtg_m_coyle_released',
        from: 'Agent — Coyle',
        senderType: 'agent',
        avatarSeed: 'agent_coyle',
        time: 'Day 1',
        order: 4,
        text: 'Heard already. Vultures move fast in this game, kid. Say NOTHING to the press until I\'ve had a word. Trust me — I\'ll have a club for you by the weekend.',
      }),
      dialogue: [
        say('reporter_local', '"Danny Sloan, local paper. Released the day you\'re cleared to train — that\'s cold. Any reaction?"'),
      ],
      choices: [
        choice('press-corridor-dignity', '"No hard feelings. I just want to play football again."', [rep(4), rel('reporter_local', 2), flag('rtg_corridor_classy')], 'scene3_agent_meeting'),
        choice('press-corridor-fire', '"They\'ll regret letting me go. Print that."', [pressure(2), rep(-1), flag('rtg_corridor_fire')], 'scene3_agent_meeting'),
        choice('press-corridor-silent', 'Brush past without a word', [stat('mental', 1)], 'scene3_agent_meeting'),
      ],
    },
    {
      id: 'scene3_agent_meeting',
      background: { type: 'town', variant: 'pub' },
      music: 'ambient-morning',
      characters: [{ id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'happy' }],
      dialogue: [
        say('agent_coyle', '"Don\'t let it get you down, kid. I\'ve been working the phones. Harbour City FC needs a forward."'),
        say('agent_coyle', '"They\'re willing to give you a trial in their next inter-squad match. It\'s your only shot. There\'s a catch though — money\'s tight there."'),
      ],
      choices: [
        choice('accept-trial', 'Accept the trial and travel to Harbour City', [morale(2), rel('agent_coyle', 1), flag('rtg_accepted_trial')], 'scene3b_home'),
        choice('ask-bigger', 'Ask if there\'s anything bigger out there', [pressure(2), flag('rtg_wanted_bigger')], 'scene3b_home'),
      ],
    },
    {
      id: 'scene3b_home',
      background: { type: 'home', variant: 'kitchen' },
      music: 'warm-ambient',
      characters: [{ id: 'sister_mia', position: 'right', pose: 'family_casual', expression: 'concerned' }],
      dialogue: [
        say('sister_mia', '"So. A trial. At a club that can barely pay the kit man." She slides a cup of tea across the table.'),
        say('sister_mia', '"Mum\'s pretending she isn\'t worried. You don\'t have to carry all of it on your own, you know."'),
      ],
      choices: [
        choice('mia-open', 'Tell her the truth — you\'re terrified', [rel('sister_mia', 3), stat('mental', 2), morale(1), flag('rtg_mia_open')], 'scene3c_night'),
        choice('mia-brave', 'Put on a brave face for the family', [pressure(2), flag('rtg_mia_brave')], 'scene3c_night'),
      ],
    },
    {
      id: 'scene3c_night',
      background: { type: 'home', variant: 'bedroom' },
      music: 'tense-ambient',
      characters: [],
      onEnter: pushMessages({
        id: 'rtg_m_dad_trial_eve',
        from: 'Home',
        senderType: 'family',
        avatarSeed: 'dad',
        time: 'Trial Eve',
        order: 5,
        text: 'Set the alarm for you. Boots are by the door, I cleaned them. One game changes everything, son. Go and take it. — Dad',
      }),
      dialogue: [
        say('narrator', 'The night before the trial. The ceiling stares back at you. Every old doubt picks tonight to visit.'),
      ],
      choices: [
        choice('night-visualise', 'Lie still and visualise the chances you\'ll take', [stat('mental', 3), pressure(-1), flag('rtg_night_focus')], 'scene4_trial_match'),
        choice('night-gym', 'Slip out for one more light session', [stat('physical', 2), pressure(1), flag('rtg_night_gym')], 'scene4_trial_match'),
      ],
    },
    {
      id: 'scene4_trial_match',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [{ id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'neutral' }],
      dialogue: [
        say('ty_coach_bell', '"Listen up. You have 90 minutes. Run yourself empty, score, and prove that knee is solid."'),
        say('ty_coach_bell', '"One of my lads, Dane, thinks this trial is a waste of his afternoon. Make him eat that."'),
      ],
      choices: [
        {
          ...choice('start-trial', 'Play the Harbour City trial match', [flag('rtg_played_trial')], 'scene5_trial_verdict_win', { matchId: 'rtg_trial' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'rtg_trial', result: 'win' }], nextSceneId: 'scene5_trial_verdict_win' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_trial', result: 'draw' }], nextSceneId: 'scene5_trial_verdict_draw' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_trial', result: 'loss' }], nextSceneId: 'scene5_trial_verdict_loss' },
          ],
        },
      ],
    },
    {
      id: 'scene5_trial_verdict_win',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'warm-ambient',
      characters: [
        { id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'happy' },
        { id: 'rival_dane', position: 'left', pose: 'rival_striker', expression: 'angry' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_coyle_signed',
        from: 'Agent — Coyle',
        senderType: 'agent',
        avatarSeed: 'agent_coyle',
        time: 'Signing Day',
        order: 6,
        text: 'YES! Told you. Short-term deal but the door\'s open. Keep scoring and we renegotiate by Christmas. This is just chapter one, kid.',
      }),
      dialogue: [
        say('ty_coach_bell', '"I saw enough. You\'re rusty, but you\'ve got the hunger. Here\'s a short-term contract till the end of the year."'),
        say('rival_dane', '"Welcome to the club." He doesn\'t smile. "Just so we\'re clear — the number nine shirt is mine. You\'re cover."'),
      ],
      choices: [
        choice('dane-respect', 'Tell Dane you respect the challenge', [rel('rival_dane', 1), stat('mental', 1), flag('rtg_dane_respect')], 'scene6_sign'),
        choice('dane-warn', '"Cover doesn\'t score the way I do."', [rel('rival_dane', -2), pressure(2), morale(1), flag('rtg_dane_feud')], 'scene6_sign'),
      ],
    },
    {
      id: 'scene5_trial_verdict_draw',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'tense-ambient',
      characters: [
        { id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'neutral' },
        { id: 'rival_dane', position: 'left', pose: 'rival_striker', expression: 'angry' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_coyle_trial_draw',
        from: 'Agent — Coyle',
        senderType: 'agent',
        avatarSeed: 'agent_coyle',
        time: 'Trial Night',
        order: 6,
        text: 'Not clean, not pretty, but Bell saw enough to keep the door open. Short-term deal. Now turn nearly into undeniable.',
      }),
      dialogue: [
        say('ty_coach_bell', '"You didn\'t tear the place apart. You also didn\'t hide. I can work with a player who refuses to disappear."'),
        say('ty_coach_bell', '"Short-term contract. One bad month and it ends. One good month and you make it impossible to drop you."'),
        say('rival_dane', '"A draw in a trial match and they hand you a lifeline. Must be nice being everyone\'s charity case."'),
      ],
      choices: [
        choice('trial-draw-humble', 'Accept the lifeline and promise Bell more', [rel('ty_coach_bell', 1), stat('mental', 1), pressure(1), flag('rtg_trial_lifeline')], 'scene6_sign'),
        choice('trial-draw-bite', 'Tell Dane the next one will not be close', [rel('rival_dane', -2), morale(1), pressure(2), flag('rtg_dane_feud')], 'scene6_sign'),
      ],
    },
    {
      id: 'scene5_trial_verdict_loss',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'tense-ambient',
      characters: [
        { id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'concerned' },
        { id: 'agent_coyle', position: 'left', pose: 'agent_phone', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_coyle_trial_loss',
        from: 'Agent — Coyle',
        senderType: 'agent',
        avatarSeed: 'agent_coyle',
        time: 'Trial Night',
        order: 6,
        text: 'Bell nearly walked. I had to fight for the deal. You have one month, reduced wages, no guarantees. Take it personally.',
      }),
      dialogue: [
        say('ty_coach_bell', '"You looked scared of the sprint. Scared of the contact. Scared of the old scar. That cannot happen in my team."'),
        say('agent_coyle', '"Give him the month, gaffer. If he fails, I\'ll drive him home myself. But you know there is a player in there."'),
        say('ty_coach_bell', '"One month. Minimum money. You earn everything else from zero."'),
      ],
      choices: [
        choice('trial-loss-swallow', 'Swallow the humiliation and sign anyway', [pressure(3), morale(-1), rel('agent_coyle', 1), flag('rtg_trial_last_chance')], 'scene6_sign'),
        choice('trial-loss-vow', '"You will not regret this. I will make the month count."', [stat('mental', 2), pressure(2), flag('rtg_trial_last_chance')], 'scene6_sign'),
      ],
    },
    {
      id: 'scene6_sign',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'warm-ambient',
      characters: [{ id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'determined' }],
      dialogue: [
        say('ty_coach_bell', '"Sign here. From tomorrow you\'re a Harbour City player. We start at the bottom of the table — and we climb."'),
      ],
      choices: [
        choice('sign-harbour', 'Sign the contract with Harbour City FC', [morale(3), rep(2), { type: 'nextEpisode', episodeId: 'rtg_ep2_fightback' }], 'scene_complete'),
      ],
    },
  ],
};

export const rtgEpisode2: Episode = {
  id: 'rtg_ep2_fightback',
  title: 'The Benchwarmer',
  season: 2026,
  episodeNumber: 2,
  campaignId: 'international-cup-story',
  description: 'Signed, but not trusted. A rival in your shirt, a mentor in your corner, and a bench to fight your way off.',
  scenes: [
    {
      id: 'scene1_training',
      background: { type: 'training', variant: 'morning' },
      music: 'ambient-morning',
      characters: [{ id: 'mentor_okafor', position: 'right', pose: 'assistant_tracksuit', expression: 'neutral' }],
      onEnter: pushMessages({
        id: 'rtg_m_okafor_welcome',
        from: 'Eddie Okafor',
        senderType: 'assistant',
        avatarSeed: 'mentor_okafor',
        time: 'First Session',
        order: 7,
        text: 'Saw your trial tape. There\'s a real player in there hiding behind two years of fear. Extra session, 7am, just you and me. Don\'t be late.',
      }),
      dialogue: [
        say('mentor_okafor', '"First one in, last one out — that\'s the only language a manager really hears." He rolls a ball under his boot.'),
        say('mentor_okafor', '"I played at the very top once. Threw it away being clever instead of being committed. Don\'t make my mistake."'),
      ],
      choices: [
        choice('okafor-extra', 'Commit to extra one-on-one sessions with Okafor', [rel('mentor_okafor', 3), stat('shooting', 2), flag('rtg_okafor_mentor')], 'scene1b_dressing_room'),
        choice('okafor-polite', 'Thank him but keep your distance for now', [stat('mental', 1), flag('rtg_okafor_distance')], 'scene1b_dressing_room'),
      ],
    },
    {
      id: 'scene1b_dressing_room',
      background: { type: 'lockerRoom', variant: 'before' },
      music: 'ambient-morning',
      characters: [
        { id: 'teammate_reyes', position: 'left', pose: 'young_teammate_red_kit', expression: 'happy' },
        { id: 'rival_dane', position: 'right', pose: 'rival_striker', expression: 'neutral' },
      ],
      dialogue: [
        say('teammate_reyes', '"New boy! Ignore Dane, he\'s allergic to competition." Reyes grins and tosses you a bib.'),
        say('rival_dane', '"Funny. We\'ll see who\'s laughing when the gaffer reads the teamsheet." He doesn\'t look up.'),
      ],
      choices: [
        choice('reyes-friend', 'Joke back with Reyes and build a friend in the room', [rel('teammate_reyes', 3), morale(1), flag('rtg_reyes_friend')], 'scene1c_dane_clash'),
        choice('head-down', 'Keep it professional, focus on the work', [stat('mental', 2), rel('rival_dane', 1)], 'scene1c_dane_clash'),
      ],
    },
    {
      id: 'scene1c_dane_clash',
      background: { type: 'training', variant: 'morning' },
      music: 'tense-ambient',
      characters: [
        { id: 'rival_dane', position: 'right', pose: 'rival_striker', expression: 'angry' },
        { id: 'teammate_reyes', position: 'left', pose: 'young_teammate_red_kit', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_reyes_dane_warning',
        from: 'Hugo Reyes',
        senderType: 'teammate',
        avatarSeed: 'teammate_reyes',
        time: 'Training',
        order: 7.5,
        text: 'Watch Dane in the small-sided game today. He\'s been telling the lads the gaffer only signed you out of pity. He WANTS you to snap in front of the coaches. Don\'t give him it.',
      }),
      dialogue: [
        say('narrator', 'A routine fifty-fifty in the training match. You get there first — and Dane goes through the back of you, studs up, right across the surgically-repaired knee.'),
        say('rival_dane', '"Whoops. Reflexes." He stands over you, voice low so the staff can\'t hear. "Glass knee like yours, I\'d be careful in this league. Accidents happen."'),
        say('teammate_reyes', '"That had NOTHING to do with the ball and you know it, Dane!" Reyes is already in his face.'),
      ],
      choices: [
        choice('dane-clash-square', 'Get up and square up — let him see you don\'t scare', [morale(2), pressure(2), rel('rival_dane', -2), rel('teammate_reyes', 1), flag('rtg_stood_to_dane')], 'scene2_captain_talk'),
        choice('dane-clash-ice', 'Say nothing — bury the next chance in training instead', [stat('mental', 2), stat('shooting', 1), rep(1), flag('rtg_iced_dane')], 'scene2_captain_talk'),
        choice('dane-clash-report', 'Walk to the coaches and report the challenge', [rel('rival_dane', -1), rel('ty_coach_bell', 1), pressure(1), flag('rtg_reported_dane')], 'scene2_captain_talk'),
      ],
    },
    {
      id: 'scene2_captain_talk',
      background: { type: 'lockerRoom', variant: 'before' },
      music: 'ambient-morning',
      characters: [{ id: 'captain_whitlock', position: 'right', pose: 'captain_red_kit', expression: 'determined' }],
      dialogue: [
        say('captain_whitlock', '"We\'re playing Marsden United today. Tough match. You\'re on the bench, but be ready."'),
        say('captain_whitlock', '"When the boss calls your name, you play for the badge. Nothing else."'),
      ],
      choices: [
        choice('pearce-ready', 'Tell him you\'re ready to fight', [morale(2), rel('captain_whitlock', 2), flag('rtg_ready_fight')], 'scene3_pressroom'),
        choice('pearce-calm', 'Keep your composure and focus', [stat('mental', 3), pressure(-1), flag('rtg_composed_bench')], 'scene3_pressroom'),
      ],
    },
    {
      id: 'scene3_pressroom',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'reporter_local', position: 'left', pose: 'reporter_notepad', expression: 'neutral' },
        { id: 'pundit_grady', position: 'right', pose: 'pundit_studio', expression: 'angry' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_grady_dig',
        from: 'Ron Grady (TV)',
        senderType: 'pundit',
        avatarSeed: 'pundit_grady',
        time: 'Matchday',
        order: 8,
        text: 'Following up after the presser. Off the record — prove me wrong, kid. I love being wrong. Makes better telly. — Grady',
      }),
      dialogue: [
        say('pundit_grady', '"Let\'s be honest — a reconstructed knee and a free transfer from a relegation club. Why should anyone rate you?"'),
      ],
      choices: [
        choice('grady-humble', '"You shouldn\'t. Yet. Judge me in twenty games."', [rep(3), pressure(-1), rel('reporter_local', 1), flag('rtg_grady_humble')], 'scene4_match_bench'),
        choice('grady-fire', '"Keep my name in your mouth, Ron. It\'s good for my motivation."', [morale(2), pressure(2), rep(1), flag('rtg_grady_fire')], 'scene4_match_bench'),
        choice('grady-deflect', '"The lads in that dressing room rate me. That\'s all I need."', [rel('captain_whitlock', 1), stat('mental', 1), flag('rtg_grady_team')], 'scene4_match_bench'),
      ],
    },
    {
      id: 'scene4_match_bench',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [{ id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'concerned' }],
      dialogue: [
        say('ty_coach_bell', '"We are 1-0 down in the 60th minute. Dane\'s done nothing. Get out there and get us a result!"'),
      ],
      choices: [
        {
          ...choice('enter-match', 'Enter the pitch as a substitute', [flag('rtg_subbed_on')], 'scene5_match_aftermath_win', { matchId: 'rtg_league_comeback' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'rtg_league_comeback', result: 'win' }], nextSceneId: 'scene5_match_aftermath_win' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_league_comeback', result: 'draw' }], nextSceneId: 'scene5_match_aftermath_draw' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_league_comeback', result: 'loss' }], nextSceneId: 'scene5_match_aftermath_loss' },
          ],
        },
      ],
    },
    {
      id: 'scene5_match_aftermath_win',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'warm-ambient',
      characters: [
        { id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'happy' },
        { id: 'captain_whitlock', position: 'left', pose: 'captain_red_kit', expression: 'happy' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_dane_aftermath',
        from: 'Marcus Dane',
        senderType: 'teammate',
        avatarSeed: 'rival_dane',
        time: 'Full Time',
        order: 9,
        text: 'Good cameo. Don\'t get comfortable. I\'ve scored in this league when you were still learning to walk on that knee.',
      }),
      dialogue: [
        say('ty_coach_bell', '"Good shift. The squad is starting to see what you bring." He pauses. "Dane\'s not happy. Tough."'),
        say('captain_whitlock', '"That\'s how we fight. Keep this up and you make the gaffer\'s decision for him."'),
      ],
      choices: [
        choice('aftermath-hungry', 'Tell the gaffer you want to start the next one', [morale(2), pressure(1), flag('rtg_demanded_start')], 'scene6_setback'),
        choice('aftermath-team', '"Whatever the team needs. Bench, start, doesn\'t matter."', [rel('captain_whitlock', 2), rel('ty_coach_bell', 1), flag('rtg_team_first')], 'scene6_setback'),
      ],
    },
    {
      id: 'scene5_match_aftermath_draw',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'tense-ambient',
      characters: [
        { id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'neutral' },
        { id: 'captain_whitlock', position: 'left', pose: 'captain_red_kit', expression: 'determined' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_marsden_draw',
        from: 'Carl Whitlock',
        senderType: 'captain',
        avatarSeed: 'captain_whitlock',
        time: 'Full Time',
        order: 9,
        text: 'You dragged us back into it. Not enough for the headlines, enough for the room to notice. Next time, we finish it.',
      }),
      dialogue: [
        say('ty_coach_bell', '"You changed the temperature. I asked for a result and you got us halfway there."'),
        say('captain_whitlock', '"Halfway hurts. Remember that. The lads respect the fight, but starters turn draws into wins."'),
      ],
      choices: [
        choice('draw-own-it', 'Own the missed chance and ask for another shot', [stat('mental', 1), pressure(1), rel('ty_coach_bell', 1), flag('rtg_marsden_draw_owned')], 'scene6_setback'),
        choice('draw-fire', '"Give me the start and I finish that game."', [morale(1), pressure(2), flag('rtg_demanded_start')], 'scene6_setback'),
      ],
    },
    {
      id: 'scene5_match_aftermath_loss',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'tense-ambient',
      characters: [
        { id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'angry' },
        { id: 'rival_dane', position: 'left', pose: 'rival_striker', expression: 'neutral' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_marsden_loss',
        from: 'Ron Grady (TV)',
        senderType: 'pundit',
        avatarSeed: 'pundit_grady',
        time: 'Full Time',
        order: 9,
        text: 'Hard to sell a comeback story when the comeback loses. Prove that was rust, not reality. — Grady',
      }),
      dialogue: [
        say('ty_coach_bell', '"I put you on to save us. You did not. That is the job, not the romance."'),
        say('rival_dane', '"Great speech in the papers. Shame the ball did not listen."'),
        say('ty_coach_bell', '"You get one more week because I saw flashes. Flashes do not keep clubs up."'),
      ],
      choices: [
        choice('loss-take-blame', 'Take the blame in front of the dressing room', [stat('mental', 2), rel('captain_whitlock', 1), pressure(1), flag('rtg_marsden_loss_owned')], 'scene6_setback'),
        choice('loss-burn', 'Use the embarrassment as fuel', [morale(1), pressure(3), rel('rival_dane', -1), flag('rtg_marsden_loss_fuel')], 'scene6_setback'),
      ],
    },
    {
      id: 'scene6_setback',
      background: { type: 'training', variant: 'rain' },
      music: 'tense-ambient',
      characters: [{ id: 'physio_lane', position: 'right', pose: 'physio_bag', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_lane_scare',
        from: 'Sara Lane (Physio)',
        senderType: 'physio',
        avatarSeed: 'physio_lane',
        time: 'Training',
        order: 10,
        text: 'That twinge in the session wasn\'t nothing. I want you in for a scan before you even THINK about the weekend. This is me protecting your career, not your ego.',
      }),
      dialogue: [
        say('physio_lane', '"Stop. I saw you pull up. The knee. Don\'t you dare tell me you\'re fine — I watch feet for a living."'),
        say('physio_lane', '"I can clear you for the weekend, or I can rest you and we protect the season. Your call — but be honest with me."'),
      ],
      choices: [
        choice('setback-rest', 'Rest the knee — protect the long game', [injury(-2), stat('physical', 1), morale(-1), rel('physio_lane', 3), flag('rtg_rested_knee')], 'scene7_rest_branch'),
        choice('setback-push', 'Insist you\'re fit — you can\'t lose your place now', [injury(2), stat('mental', 2), pressure(3), flag('rtg_pushed_knee')], 'scene7_push_branch'),
      ],
    },
    {
      id: 'scene7_rest_branch',
      background: { type: 'physio', variant: 'treatment' },
      music: 'warm-ambient',
      characters: [
        { id: 'physio_lane', position: 'left', pose: 'physio_bag', expression: 'happy' },
        { id: 'mentor_okafor', position: 'right', pose: 'assistant_tracksuit', expression: 'neutral' },
      ],
      dialogue: [
        say('physio_lane', '"Scan\'s clean. You made the smart call — a week off saves you two months. Dane starts Saturday, but you\'ll be back fresh."'),
        say('physio_lane', '"Remember this feeling. The career you saved by resting the knee is the career you get to keep fighting for."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_rested_knee }),
        say('mentor_okafor', '"Sitting one out won\'t cost you the season. Sitting out the whole season will. You did right."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_okafor_mentor }),
      ],
      choices: [
        choice('rest-finish', 'Recover, then push for the run-in', [morale(2), stat('physical', 2), { type: 'nextEpisode', episodeId: 'rtg_ep3_tension' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene7_push_branch',
      background: { type: 'managerOffice', variant: 'night' },
      music: 'tense-ambient',
      characters: [{ id: 'ty_coach_bell', position: 'right', pose: 'ty_coach_bell', expression: 'angry' }],
      onEnter: pushMessages({
        id: 'rtg_m_sister_worried',
        from: 'Mia',
        senderType: 'family',
        avatarSeed: 'sister_mia',
        time: 'Late',
        order: 11,
        text: 'Heard you played through pain again. I\'m proud you\'re brave but I am NOT burying that ambition with your knee. Please be careful. x',
      }),
      dialogue: [
        say('ty_coach_bell', '"You overruled my physio to play hurt. Brave. Stupid. Both." He sighs. "It half came off. You ran your legs into the ground and we drew."'),
        say('ty_coach_bell', '"Pushing the knee bought you minutes. It also bought you my doubt. You need to earn that back."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_pushed_knee }),
        say('ty_coach_bell', '"I respect the guts. But pull a stunt like that again without telling me and you\'re finished here, hero or not."'),
      ],
      choices: [
        choice('push-apologise', 'Apologise — promise to trust the medical staff', [rel('ty_coach_bell', 2), rel('physio_lane', 1), pressure(-1), flag('rtg_learned_lesson')], 'scene8_reconverge'),
        choice('push-defiant', '"I\'d do it again. I won\'t lose my career to the bench."', [morale(2), rel('ty_coach_bell', -1), pressure(2), flag('rtg_stayed_defiant')], 'scene8_reconverge'),
      ],
    },
    {
      id: 'scene8_reconverge',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'warm-ambient',
      characters: [{ id: 'captain_whitlock', position: 'right', pose: 'captain_red_kit', expression: 'determined' }],
      dialogue: [
        say('captain_whitlock', '"Win, lose or limp, you showed the room something this week. Run-in starts now. National selectors are watching this division."'),
      ],
      choices: [
        choice('finish-ep2', 'Prepare for the final matches of the season', [morale(2), { type: 'nextEpisode', episodeId: 'rtg_ep3_tension' }], 'scene_complete'),
      ],
    },
  ],
};

export const rtgEpisode3: Episode = {
  id: 'rtg_ep3_tension',
  title: 'The Scout in the Stands',
  season: 2026,
  episodeNumber: 3,
  campaignId: 'international-cup-story',
  description: 'Your form has caught fire. Now a super-agent, a tabloid, and a loyalty-versus-money decision all want a piece of you.',
  scenes: [
    {
      id: 'scene1_form',
      background: { type: 'training', variant: 'morning' },
      music: 'ambient-morning',
      characters: [{ id: 'mentor_okafor', position: 'right', pose: 'assistant_tracksuit', expression: 'happy' }],
      onEnter: pushMessages({
        id: 'rtg_m_okafor_form',
        from: 'Eddie Okafor',
        senderType: 'assistant',
        avatarSeed: 'mentor_okafor',
        time: 'Run-In',
        order: 12,
        text: 'Seven goals in nine. The phone won\'t stop ringing about you now. Remember who you were six months ago — keep THAT lad\'s hunger.',
      }),
      dialogue: [
        say('mentor_okafor', '"Six months ago you couldn\'t trust your own knee. Now you\'re top scorer in the run-in. Let it sink in for one second."'),
        say('mentor_okafor', '"And brace yourself — the sharks smell blood now. Money\'s about to test what you\'re really made of."'),
      ],
      choices: [
        choice('form-grounded', 'Stay grounded — credit the work, not the hype', [stat('mental', 3), rel('mentor_okafor', 2), flag('rtg_stayed_grounded')], 'scene2_agent_rival'),
        choice('form-ambitious', 'Admit you want the move and the money', [morale(2), pressure(2), flag('rtg_wants_move')], 'scene2_agent_rival'),
      ],
    },
    {
      id: 'scene2_agent_rival',
      background: { type: 'town', variant: 'pub' },
      music: 'tense-ambient',
      characters: [{ id: 'agent_rival_sharpe', position: 'right', pose: 'agent_suit', expression: 'happy' }],
      onEnter: pushMessages({
        id: 'rtg_m_sharpe_pitch',
        from: 'Dominic Sharpe',
        senderType: 'agent',
        avatarSeed: 'agent_rival_sharpe',
        time: 'Run-In',
        order: 13,
        text: 'You don\'t know me yet but you will. Coyle is a corner-shop agent. I move players to giants. Have lunch with me before you sign anything you\'ll regret.',
      }),
      dialogue: [
        say('agent_rival_sharpe', '"Dominic Sharpe. I represent the elite, and right now, you should be on that list."'),
        say('agent_rival_sharpe', '"Coyle got you off the scrapheap, fine. But he can\'t take you to the top. I can. Drop him and I\'ll triple your wages by August."'),
      ],
      choices: [
        choice('sharpe-listen', 'Agree to hear Sharpe out — this could be huge', [pressure(2), flag('rtg_tempted_sharpe')], 'scene3_loyalty_branch'),
        choice('sharpe-loyal', '"Coyle believed in me when no one did. We\'re done here."', [rel('agent_coyle', 3), rep(2), flag('rtg_loyal_coyle')], 'scene3_coyle_branch'),
      ],
    },
    {
      id: 'scene3_loyalty_branch',
      background: { type: 'car', variant: 'interior' },
      music: 'tense-ambient',
      characters: [{ id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_coyle_hurt',
        from: 'Agent — Coyle',
        senderType: 'agent',
        avatarSeed: 'agent_coyle',
        time: 'Tonight',
        order: 14,
        text: 'Heard you took a meeting with Sharpe. I\'m not going to beg, kid. Just remember who answered the phone the day you got released. Whatever you decide, I\'ll respect it.',
      }),
      dialogue: [
        say('agent_coyle', '"So. Sharpe got to you." He stares out of the windscreen. "I\'m not angry. I just need to know if I\'m still your man."'),
        say('agent_coyle', '"He\'ll dangle a giant club. But giants buy you to sit you on a bench. Here, you play. Your call."'),
      ],
      choices: [
        choice('loyalty-stay', 'Stay with Coyle and Harbour City — you play, you grow', [rel('agent_coyle', 4), rel('ty_coach_bell', 1), morale(2), flag('rtg_chose_loyalty')], 'scene4_chairman'),
        choice('loyalty-sign-sharpe', 'Sign with Sharpe — chase the giant club', [rel('agent_coyle', -4), rel('agent_rival_sharpe', 3), pressure(3), flag('rtg_chose_money')], 'scene4_chairman'),
      ],
    },
    {
      id: 'scene3_coyle_branch',
      background: { type: 'car', variant: 'interior' },
      music: 'warm-ambient',
      characters: [{ id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'happy' }],
      dialogue: [
        say('agent_coyle', '"You turned down Sharpe? For me?" He laughs, properly, for the first time in months.'),
        say('agent_coyle', '"Then I owe you this straight: stay one more season, become the man here, and I\'ll get you a giant who actually wants you in the XI. Deal?"'),
      ],
      choices: [
        choice('coyle-deal', 'Shake on it — build it the right way', [rel('agent_coyle', 3), morale(2), flag('rtg_chose_loyalty')], 'scene4_chairman'),
      ],
    },
    {
      id: 'scene4_chairman',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'chairman_voss', position: 'right', pose: 'chairman_suit', expression: 'neutral' }],
      onEnter: pushMessages({
        id: 'rtg_m_voss_contract',
        from: 'G. Voss (Chairman)',
        senderType: 'chairman',
        avatarSeed: 'chairman_voss',
        time: 'This Week',
        order: 15,
        text: 'My office. We protect our assets here — and right now you\'re the most valuable thing at this club. Let\'s talk about your future before anyone else does.',
      }),
      dialogue: [
        say('chairman_voss', '"You\'ve become an asset, son. Assets get protected — or sold for the right number." He smiles thinly.'),
        say('chairman_voss', '"There\'s a giant sniffing around. I can cash in now, or I can build a story around you. Convince me you\'re worth keeping."'),
      ],
      choices: [
        choice('voss-stay', '"Keep me. I\'ll fire this club up the table and double my value."', [rep(2), rel('chairman_voss', 2), morale(1), flag('rtg_voss_persuaded')], 'scene5_scandal'),
        choice('voss-leverage', '"Sell me at the peak — we both win, and you get your fee."', [rel('chairman_voss', 1), pressure(2), flag('rtg_voss_sale')], 'scene5_scandal'),
        choice('voss-defiant', '"I\'m not a number on a spreadsheet. I\'ll decide my future, not you."', [rel('chairman_voss', -2), morale(2), pressure(1), flag('rtg_voss_clash')], 'scene5_scandal'),
      ],
    },
    {
      id: 'scene5_scandal',
      background: { type: 'home', variant: 'livingRoom' },
      music: 'tense-ambient',
      characters: [{ id: 'sister_mia', position: 'right', pose: 'family_casual', expression: 'angry' }],
      onEnter: pushMessages({
        id: 'rtg_m_tabloid',
        from: 'Unknown Number',
        senderType: 'unknown',
        avatarSeed: 'tabloid_source',
        time: 'Morning',
        order: 16,
        text: 'Page 7 of the tabloid this morning. Photo of you leaving a casino, headline says you\'ve gone Hollywood. We both know it was your cousin\'s birthday. Call me. — Mia',
      }),
      dialogue: [
        say('sister_mia', '"Have you SEEN the back page? \'New star already drunk on fame.\' From ONE photo at a family birthday!" She throws the paper down.'),
        say('sister_mia', '"They\'re building you up to knock you down. How do you want to handle this?"'),
      ],
      choices: [
        choice('scandal-statement', 'Issue a calm, honest statement through the club', [rep(3), pressure(-1), rel('reporter_local', 1), flag('rtg_scandal_calm')], 'scene6_scandal_press'),
        choice('scandal-ignore', 'Say nothing and let it blow over', [stat('mental', 2), pressure(1), flag('rtg_scandal_silent')], 'scene6_scandal_press'),
        choice('scandal-warpath', 'Go after the paper publicly — you\'re furious', [morale(1), rep(-2), pressure(3), rel('pundit_grady', -1), flag('rtg_scandal_war')], 'scene6_scandal_press'),
      ],
    },
    {
      id: 'scene6_scandal_press',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'reporter_local', position: 'left', pose: 'reporter_notepad', expression: 'neutral' },
        { id: 'pundit_grady', position: 'right', pose: 'pundit_studio', expression: 'concerned' },
      ],
      dialogue: [
        say('reporter_local', '"The room\'s only here for the casino story. The national squad list drops next week. This is your last impression before the call."'),
        say('pundit_grady', '"So go on then. Tell the country whether the hype was real or whether you\'ve already lost the plot."'),
      ],
      choices: [
        choice('scandalpress-humble', '"One photo doesn\'t define me. My goals do. Judge those."', [rep(4), pressure(-1), flag('rtg_scandalpress_humble')], 'scene6b_betrayal'),
        choice('scandalpress-funny', 'Defuse it with a joke — win the room over', [rel('reporter_local', 2), rel('pundit_grady', 1), morale(1), flag('rtg_scandalpress_charm')], 'scene6b_betrayal'),
        choice('scandalpress-fiery', '"Print lies about me and I\'ll let my football do the answering. Watch Saturday."', [morale(2), pressure(2), rep(1), flag('rtg_scandalpress_fire')], 'scene6b_betrayal'),
      ],
    },
    {
      id: 'scene6b_betrayal',
      background: { type: 'lockerRoom', variant: 'empty' },
      music: 'tense-ambient',
      characters: [
        { id: 'teammate_reyes', position: 'left', pose: 'young_teammate_red_kit', expression: 'angry' },
        { id: 'rival_dane', position: 'right', pose: 'rival_striker', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_reyes_leak',
        from: 'Hugo Reyes',
        senderType: 'teammate',
        avatarSeed: 'teammate_reyes',
        time: 'Before You See Him',
        order: 16.5,
        text: 'That casino photo didn\'t come from a stranger. It came from inside this dressing room. Meet me before training — you need to hear who, from me, before you do something daft.',
      }),
      dialogue: [
        say('teammate_reyes', '"It was Dane. He sold the photo to the paper. A few quid and a chance to knock you off your perch." Reyes can barely look at him.'),
        say('rival_dane', '"You took my shirt. My goals. My move away from this dump." For once there\'s no smirk. "I panicked. I needed you to fall."'),
        say('rival_dane', '"So go on. Tell the gaffer, get me fined, get me dropped. Whatever you\'re doing — do it before the decider. I won\'t fight it."'),
      ],
      choices: [
        choice('betrayal-expose', 'Take it to the manager — he answers for it', [rel('rival_dane', -3), rel('ty_coach_bell', 1), rep(2), pressure(1), flag('rtg_exposed_dane')], 'scene7_decider'),
        choice('betrayal-fuel', 'Say nothing — let ninety minutes on Saturday be the reply', [stat('mental', 2), morale(2), pressure(1), flag('rtg_fuelled_by_dane')], 'scene7_decider'),
        choice('betrayal-redeem', '"Own it to the lads and we\'re done with it. I need a teammate, not an enemy."', [rel('rival_dane', 4), rel('teammate_reyes', 1), morale(1), rep(1), flag('rtg_dane_redeemed')], 'scene7_decider'),
      ],
    },
    {
      id: 'scene7_decider',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [{ id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'determined' }],
      onEnter: pushMessages({
        id: 'rtg_m_strand_watching',
        from: 'Eddie Okafor',
        senderType: 'assistant',
        avatarSeed: 'mentor_okafor',
        time: 'Decider',
        order: 17,
        text: 'Coach Strand is in the director\'s box. The national manager himself. Don\'t play for him — play like you always do. He\'ll see it. Go.',
      }),
      dialogue: [
        say('agent_coyle', '"The national manager, Coach Strand, is in the director\'s box. Not a scout — the man himself. Kingsbridge City, final league decider."'),
        say('agent_coyle', '"Bell told me you exposed Dane and still kept your head on the decider. Strand notices that sort of control."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_exposed_dane }),
        say('agent_coyle', '"If Dane\'s betrayal is still burning in your chest, use it clean. Fuel, not fire."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_fuelled_by_dane }),
        say('agent_coyle', '"For what it is worth, Dane owning it to the lads changed the room. You might need that room today."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_dane_redeemed }),
        say('agent_coyle', '"Everything you\'ve fought for since that hospital bed is riding on these ninety minutes. Give it the lot."'),
      ],
      choices: [
        {
          ...choice('start-final-match', 'Play the final league decider', [flag('rtg_played_decider')], 'scene8_scout_call_win', { matchId: 'rtg_final_chance' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'rtg_final_chance', result: 'win' }], nextSceneId: 'scene8_scout_call_win' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_final_chance', result: 'draw' }], nextSceneId: 'scene8_scout_call_draw' },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_final_chance', result: 'loss' },
                { type: 'reputation', min: 30 },
              ],
              nextSceneId: 'scene8_scout_call_loss_hearing_reputation',
            },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_final_chance', result: 'loss' },
                { type: 'stat', stat: 'mental', min: 58 },
              ],
              nextSceneId: 'scene8_scout_call_loss_hearing_mental',
            },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_final_chance', result: 'loss' },
                { type: 'relationship', npcId: 'captain_whitlock', min: 2 },
              ],
              nextSceneId: 'scene8_scout_call_loss_hearing_trust',
            },
            { gates: [{ type: 'matchResult', matchId: 'rtg_final_chance', result: 'loss' }], nextSceneId: 'scene8_scout_call_loss_lifeline' },
          ],
        },
      ],
    },
    {
      id: 'scene8_scout_call_win',
      background: { type: 'home', variant: 'livingRoom' },
      music: 'warm-ambient',
      characters: [{ id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'happy' }],
      onEnter: pushMessages(
        {
          id: 'rtg_m_callup_official',
          from: 'National Team',
          senderType: 'unknown',
          avatarSeed: 'national_manager_strand',
          time: 'Squad Day',
          order: 18,
          text: 'Official: you are named in the provisional squad for the International Cup 2026. Report to the training camp Monday. Bring boots and humility. — Coach Strand',
        },
        {
          id: 'rtg_m_dad_callup',
          from: 'Home',
          senderType: 'family',
          avatarSeed: 'dad',
          time: 'Squad Day',
          order: 19,
          text: 'Two years ago I carried you out of that hospital. Today my son plays for his country. Your mum hasn\'t stopped crying. We love you. — Dad',
        },
      ),
      dialogue: [
        say('agent_coyle', '"Pick up the phone! You did it! The national squad list was just announced. You\'re in. INTERNATIONAL CUP, kid!"'),
        say('agent_coyle', '"Loyalty paid off. Now go and write the rest of it."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_chose_loyalty }),
        say('agent_coyle', '"You went your own way on the agent thing. Doesn\'t matter now — you\'re an international."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_chose_money }),
      ],
      choices: [
        choice('celebrate-callup', 'Celebrate making the national squad', [morale(4), rep(4), { type: 'nextEpisode', episodeId: 'rtg_ep4_groups' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene8_scout_call_draw',
      background: { type: 'home', variant: 'livingRoom' },
      music: 'tense-ambient',
      characters: [{ id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'concerned' }],
      onEnter: pushMessages(
        {
          id: 'rtg_m_callup_provisional_draw',
          from: 'National Team',
          senderType: 'unknown',
          avatarSeed: 'national_manager_strand',
          time: 'Squad Day',
          order: 18,
          text: 'You are named in the provisional International Cup squad. Final place subject to camp assessment. Coach Strand expects answers, not excuses.',
        },
        {
          id: 'rtg_m_mia_provisional',
          from: 'Mia',
          senderType: 'family',
          avatarSeed: 'sister_mia',
          time: 'Squad Day',
          order: 19,
          text: 'Provisional still means they called. Do not let that word eat you alive. Go there and make them afraid to cut you. x',
        },
      ),
      dialogue: [
        say('agent_coyle', '"It is not the golden phone call. It is better than silence. Provisional squad, camp assessment, all eyes on you."'),
        say('agent_coyle', '"You drew when you needed a statement. Now the statement has to happen in front of Coach Strand."'),
      ],
      choices: [
        choice('accept-provisional-draw', 'Accept the provisional call-up and prepare for camp', [morale(1), pressure(2), rep(2), flag('rtg_provisional_callup'), { type: 'nextEpisode', episodeId: 'rtg_ep4_groups' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene8_scout_call_loss_hearing_reputation',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'neutral' }],
      dialogue: [
        say('national_manager_strand', '"You lost the decider. I will not pretend otherwise. But your body of work has made noise I cannot ignore."'),
        say('national_manager_strand', '"Come to camp. Provisional. Your reputation opened the door; your next week decides whether it stays open."'),
      ],
      choices: [
        choice('hearing-reputation-accept', 'Take the reputation lifeline', [pressure(2), morale(1), rep(1), flag('rtg_loss_callup_reputation'), { type: 'nextEpisode', episodeId: 'rtg_ep4_groups' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene8_scout_call_loss_hearing_mental',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'neutral' }],
      dialogue: [
        say('national_manager_strand', '"The result was poor. Your reaction after it was not. I watched you pull two younger lads off the floor when you had every reason to hide."'),
        say('national_manager_strand', '"Mentality travels. Goals come and go. Come to camp and prove the loss did not define you."'),
      ],
      choices: [
        choice('hearing-mental-accept', 'Promise Strand the loss will sharpen you', [stat('mental', 1), pressure(1), flag('rtg_loss_callup_mental'), { type: 'nextEpisode', episodeId: 'rtg_ep4_groups' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene8_scout_call_loss_hearing_trust',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'neutral' }],
      dialogue: [
        say('national_manager_strand', '"I asked people I trust about you. They said you listen, you learn, and the dressing room follows when you speak."'),
        say('national_manager_strand', '"The decider hurt your case. Their trust saved it. Do not waste that."'),
      ],
      choices: [
        choice('hearing-trust-accept', 'Accept the trusted-player lifeline', [rel('national_manager_strand', 1), pressure(1), flag('rtg_loss_callup_trust'), { type: 'nextEpisode', episodeId: 'rtg_ep4_groups' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene8_scout_call_loss_lifeline',
      background: { type: 'home', variant: 'kitchen' },
      music: 'tense-ambient',
      characters: [{ id: 'sister_mia', position: 'right', pose: 'family_casual', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_lifeline_loss',
        from: 'Agent — Coyle',
        senderType: 'agent',
        avatarSeed: 'agent_coyle',
        time: 'Squad Day',
        order: 18,
        text: 'This is the smallest possible yes: emergency provisional list, no promises, first cut if camp goes badly. But it is still yes. Pack the boots.',
      }),
      dialogue: [
        say('sister_mia', '"You lost. You cried in the car. Then the phone rang anyway."'),
        say('sister_mia', '"Emergency provisional list is not the fairytale. It is a rope. You can climb it or hang yourself with the pressure."'),
      ],
      choices: [
        choice('lifeline-accept', 'Take the smallest possible yes', [pressure(4), morale(-1), flag('rtg_loss_callup_lifeline'), { type: 'nextEpisode', episodeId: 'rtg_ep4_groups' }], 'scene_complete'),
      ],
    },
  ],
};

export const rtgEpisode4: Episode = {
  id: 'rtg_ep4_groups',
  title: 'The Big Stage',
  season: 2026,
  episodeNumber: 4,
  campaignId: 'international-cup-story',
  description: 'The tournament. A new manager to convince, a starting spot to win, and the whole world watching.',
  scenes: [
    {
      id: 'scene1_camp',
      background: { type: 'managerOffice', variant: 'day' },
      music: 'tense-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'neutral' }],
      onEnter: pushMessages({
        id: 'rtg_m_strand_camp',
        from: 'Coach Strand',
        senderType: 'unknown',
        avatarSeed: 'national_manager_strand',
        time: 'Camp Day 1',
        order: 20,
        text: 'You made the squad on form. You make the XI on attitude. I have eleven proven internationals ahead of you on paper. Change my mind on the grass.',
      }),
      dialogue: [
        say('national_manager_strand', '"Welcome to camp. I won\'t flatter you — you\'re the bolter. The romantic story. Stories don\'t win tournaments. Performances do."'),
        say('national_manager_strand', '"Earn my trust in training and the shirt is yours. Coast on the comeback narrative and you\'ll watch from the bench. Clear?"'),
      ],
      choices: [
        choice('camp-prove', '"I didn\'t come back from a wrecked knee to sit and watch. I\'ll earn it."', [morale(2), rel('national_manager_strand', 2), flag('rtg_camp_hungry')], 'scene2_roommate'),
        choice('camp-humble', '"I\'ll do whatever the team needs, starter or not."', [stat('mental', 2), rel('national_manager_strand', 1), flag('rtg_camp_humble')], 'scene2_roommate'),
      ],
    },
    {
      id: 'scene2_roommate',
      background: { type: 'lockerRoom', variant: 'empty' },
      music: 'ambient-morning',
      characters: [{ id: 'england_roommate_fox', position: 'right', pose: 'young_teammate_red_kit', expression: 'concerned' }],
      dialogue: [
        say('england_roommate_fox', '"Can you believe we\'re actually here? The International Cup 2026. The atmosphere is insane."'),
        say('england_roommate_fox', '"Word of warning — half the strikers in this camp want your story to end so theirs can start. Watch your back, but you\'ve got me."'),
        say('england_roommate_fox', '"We play Germany first. Adler anchors their back line. How do we break them down?"'),
      ],
      choices: [
        choice('groups-attack', 'We play our attacking style and break them down', [stat('shooting', 3), stat('dribbling', 2), rel('england_roommate_fox', 1), flag('rtg_groups_attack')], 'scene2b_home_crisis'),
        choice('groups-tactical', 'Play smart, look for the counter', [stat('passing', 3), stat('mental', 2), rel('england_roommate_fox', 1), flag('rtg_groups_tactical')], 'scene2b_home_crisis'),
      ],
    },
    {
      id: 'scene2b_home_crisis',
      background: { type: 'home', variant: 'bedroom' },
      music: 'tense-ambient',
      characters: [{ id: 'england_roommate_fox', position: 'right', pose: 'young_teammate_red_kit', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_mia_dad_collapse',
        from: 'Mia',
        senderType: 'family',
        avatarSeed: 'sister_mia',
        time: 'Camp — Night',
        order: 20.5,
        text: 'Don\'t panic reading this. Dad collapsed at work — chest pains. He\'s in hospital and he is STABLE, the doctors are with him. He is shouting that you are NOT to come home. Call me. x',
      }),
      dialogue: [
        say('narrator', 'Eleven at night in the team hotel. Mia\'s name lights up your phone. Your father is in a hospital bed two hundred miles away — on the eve of the tournament of your life.'),
        say('england_roommate_fox', '"Mate. I heard you on the phone. Whatever it is, I\'ll get the team doctor, get a car to the door, wake the manager — just say the word."'),
        say('england_roommate_fox', '"And your sister texted me too. She made me promise to read you this, word for word: \'Dad says the best medicine in the world is watching you walk out in that shirt. Don\'t you dare come home.\'"'),
      ],
      choices: [
        choice('crisis-stay-dedicate', 'Stay — and dedicate every minute of this tournament to him', [morale(2), rel('sister_mia', 2), rel('england_roommate_fox', 1), flag('rtg_playing_for_dad'), flag('rtg_dad_crisis')], 'scene3_press'),
        choice('crisis-bottle', 'Tell no one, bottle it up, pour it into the football', [stat('mental', 2), pressure(3), flag('rtg_bottled_crisis'), flag('rtg_dad_crisis')], 'scene3_press'),
        choice('crisis-nearly-leave', 'Pack your bag for home — until Fox stops you at the door', [rel('england_roommate_fox', 3), pressure(1), morale(1), flag('rtg_nearly_left'), flag('rtg_dad_crisis')], 'scene3_press'),
      ],
    },
    {
      id: 'scene3_press',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'reporter_local', position: 'left', pose: 'reporter_notepad', expression: 'neutral' },
        { id: 'germany_captain_adler', position: 'right', pose: 'germany_defender', expression: 'neutral' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_adler_mindgames',
        from: 'L. Adler',
        senderType: 'unknown',
        avatarSeed: 'germany_captain_adler',
        time: 'Pre-Germany',
        order: 21,
        text: 'They tell me you came back from a destroyed knee. Admirable. I will test it for ninety minutes tomorrow. Nothing personal. — Adler',
      }),
      dialogue: [
        say('reporter_local', '"You\'re sharing this stage with Lukas Adler, the world\'s best defender. He says your comeback is, quote, \'a nice story that ends tomorrow.\' Response?"'),
        say('narrator', 'The first question lands and your mouth goes dry. You can still hear Mia on the phone.', {
          condition: (s: JourneyState) => (s.storyPressure ?? 0) >= 6 || !!s.storyFlags.rtg_bottled_crisis,
        }),
      ],
      choices: [
        choice('adlerpress-respect', '"He\'s the best there is. That\'s exactly why I want to face him."', [rep(3), rel('germany_captain_adler', 1), pressure(-1), flag('rtg_adlerpress_respect')], 'scene4_group_match'),
        choice('adlerpress-confident', '"Stories have a way of surprising people. Watch the final, Lukas."', [morale(3), pressure(2), rep(1), flag('rtg_adlerpress_confident')], 'scene4_group_match'),
        choice('adlerpress-deflect', '"I worry about my team, not one defender\'s soundbites."', [stat('mental', 2), rel('england_roommate_fox', 1), flag('rtg_adlerpress_team')], 'scene4_group_match'),
      ],
    },
    {
      id: 'scene4_group_match',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [{ id: 'england_roommate_fox', position: 'right', pose: 'young_teammate_red_kit', expression: 'determined' }],
      dialogue: [
        say('england_roommate_fox', '"The fans are roaring. The national anthem is playing. Let\'s make history."'),
      ],
      choices: [
        {
          ...choice('play-group-match', 'Play the International Cup Group Match', [flag('rtg_played_group_match')], 'scene5_selection_draw', { matchId: 'rtg_group_stage' }),
          postMatchRoutes: [
            { gates: [{ type: 'matchResult', matchId: 'rtg_group_stage', result: 'win' }], nextSceneId: 'scene5_selection_win' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_group_stage', result: 'draw' }], nextSceneId: 'scene5_selection_draw' },
            { gates: [{ type: 'matchResult', matchId: 'rtg_group_stage', result: 'loss' }], nextSceneId: 'scene5_selection_loss' },
          ],
        },
      ],
    },
    {
      id: 'scene5_selection_win',
      background: { type: 'managerOffice', variant: 'night' },
      music: 'warm-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'determined' }],
      onEnter: pushMessages({
        id: 'rtg_m_strand_selection_win',
        from: 'Coach Strand',
        senderType: 'unknown',
        avatarSeed: 'national_manager_strand',
        time: 'Knockouts',
        order: 22,
        text: 'You answered Adler and Germany on the pitch. See me before the knockout. I need to know whether you can carry the shirt again.',
      }),
      dialogue: [
        say('national_manager_strand', '"You gave me a win against Germany. That changes the room. It also changes the pressure."'),
        say('national_manager_strand', '"The veteran is safer on paper. You are louder on the grass. Convince me I should keep trusting the grass."'),
      ],
      choices: [
        choice('selection-win-demand', '"Keep me in. I earned the shirt and I can carry the noise."', [morale(2), rel('national_manager_strand', 2), pressure(1), flag('rtg_kept_shirt')], 'scene6_kept_branch'),
        choice('selection-win-team', '"Use me wherever it wins the knockout. I am ready either way."', [stat('mental', 2), rel('national_manager_strand', 1), flag('rtg_dropped_grace')], 'scene6_dropped_branch'),
      ],
    },
    {
      id: 'scene5_selection_draw',
      background: { type: 'managerOffice', variant: 'night' },
      music: 'tense-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_strand_selection',
        from: 'Coach Strand',
        senderType: 'unknown',
        avatarSeed: 'national_manager_strand',
        time: 'Knockouts',
        order: 22,
        text: 'See me before the knockout. Selection isn\'t about the past, it\'s about who I trust at 0-0 in the 89th minute. We need to talk about your role.',
      }),
      dialogue: [
        say('national_manager_strand', '"We\'re through. But I\'m changing it for the knockouts. The press want the fairytale — I want control. I\'m thinking of benching you for a veteran."'),
        say('national_manager_strand', '"So tell me, plainly: why should the comeback kid keep the shirt when the moment gets heaviest?"'),
      ],
      choices: [
        choice('axed-fight', '"Because I\'ve already played the biggest game of my life — surviving. The 89th minute doesn\'t scare me."', [morale(3), rel('national_manager_strand', 2), pressure(1), flag('rtg_kept_shirt')], 'scene6_kept_branch'),
        choice('axed-accept', '"If the team\'s better with him, play him. I\'ll be ready when you need me."', [rel('national_manager_strand', 1), stat('mental', 2), morale(-1), flag('rtg_dropped_grace')], 'scene6_dropped_branch'),
      ],
    },
    {
      id: 'scene5_selection_loss',
      background: { type: 'managerOffice', variant: 'night' },
      music: 'tense-ambient',
      characters: [{ id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_strand_selection_loss',
        from: 'Coach Strand',
        senderType: 'unknown',
        avatarSeed: 'national_manager_strand',
        time: 'Knockouts',
        order: 22,
        text: 'We survived the group. You need to come to my office before the knockout. This is not punishment; this is selection pressure.',
      }),
      dialogue: [
        say('national_manager_strand', '"Germany exposed us. They also exposed you. I am leaning toward the veteran for the knockout."'),
        say('national_manager_strand', '"If you want the shirt, you need more than emotion now. Give me a football reason."'),
      ],
      choices: [
        {
          ...choice('selection-loss-mental', '"Because one bad result will not shake me. I have lived through worse."', [stat('mental', 1), rel('national_manager_strand', 1), pressure(-1), flag('rtg_kept_shirt')], 'scene6_kept_branch'),
          gates: [{ type: 'stat', stat: 'mental', min: 58 }],
        },
        {
          ...choice('selection-loss-reputation', '"Because teams still change shape when I step on the pitch."', [rep(1), pressure(1), flag('rtg_kept_shirt')], 'scene6_kept_branch'),
          gates: [{ type: 'reputation', min: 34 }],
        },
        choice('selection-loss-accept', 'Accept the bench and promise to be ready', [stat('mental', 2), morale(-1), rel('national_manager_strand', 1), flag('rtg_dropped_grace')], 'scene6_dropped_branch'),
      ],
    },
    {
      id: 'scene6_kept_branch',
      background: { type: 'lockerRoom', variant: 'before' },
      music: 'warm-ambient',
      characters: [{ id: 'england_roommate_fox', position: 'right', pose: 'young_teammate_red_kit', expression: 'happy' }],
      dialogue: [
        say('england_roommate_fox', '"He kept you in. He NEVER does that with a young one. Whatever you said in there, it worked." He grips your shoulder.'),
        say('england_roommate_fox', '"Now you owe the whole knockout run a performance. No pressure." He grins.'),
      ],
      choices: [
        choice('kept-finish', 'Lead the line through the knockout bracket', [morale(3), stat('shooting', 2), { type: 'nextEpisode', episodeId: 'rtg_ep5_final' }], 'scene_complete'),
      ],
    },
    {
      id: 'scene6_dropped_branch',
      background: { type: 'lockerRoom', variant: 'after' },
      music: 'tense-ambient',
      characters: [{ id: 'mentor_okafor', position: 'right', pose: 'assistant_tracksuit', expression: 'neutral' }],
      onEnter: pushMessages({
        id: 'rtg_m_okafor_dropped',
        from: 'Eddie Okafor',
        senderType: 'assistant',
        avatarSeed: 'mentor_okafor',
        time: 'Knockouts',
        order: 23,
        text: 'Benched for a knockout. Hurts. But I watched you take it like a man, not a sulk. That\'s the version of you the manager remembers when he needs a hero off the bench. Be ready.',
      }),
      dialogue: [
        say('mentor_okafor', '"You took the demotion without poisoning the camp. You\'ve no idea how rare that is." He sits beside you.'),
        say('mentor_okafor', '"The bracket\'s a war. He\'ll need you before it\'s over. When he calls your name, the whole comeback comes down to that one moment. Stay sharp."'),
      ],
      choices: [
        choice('dropped-finish', 'Bide your time — be ready when the call comes', [stat('mental', 3), morale(2), { type: 'nextEpisode', episodeId: 'rtg_ep5_final' }], 'scene_complete'),
      ],
    },
  ],
};

export const rtgEpisode5: Episode = {
  id: 'rtg_ep5_final',
  title: 'Road to Glory',
  season: 2026,
  episodeNumber: 5,
  campaignId: 'international-cup-story',
  description: 'The International Cup Final. Everyone who shaped your journey is watching. Ninety minutes from immortality.',
  scenes: [
    {
      id: 'scene1_tunnel',
      background: { type: 'pitch', variant: 'empty' },
      music: 'tense-ambient',
      characters: [{ id: 'germany_captain_adler', position: 'right', pose: 'germany_defender', expression: 'neutral' }],
      onEnter: pushMessages(
        {
          id: 'rtg_m_family_final',
          from: 'Home',
          senderType: 'family',
          avatarSeed: 'dad',
          time: 'Final',
          order: 24,
          text: 'Mum, Mia and me are in row Z with the cheap seats and the loudest voices in the stadium. We\'ve already won, son. Anything else is a bonus. GO. — Dad',
        },
        {
          id: 'rtg_m_coyle_final',
          from: 'Agent — Coyle',
          senderType: 'agent',
          avatarSeed: 'agent_coyle',
          time: 'Final',
          order: 25,
          text: 'From a release letter to a World Cup final in one season. Whatever happens out there, you already proved everyone wrong. Now go and prove yourself right. — Coyle',
        },
      ),
      dialogue: [
        say('germany_captain_adler', '"So it comes down to this. You had a long road back from that injury, but it ends here. Brazil won\'t go easy on you."'),
        say('narrator', 'Dad is somewhere above the tunnel, hospital bracelet still on his wrist, waiting to see what you stayed for.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_playing_for_dad }),
        say('narrator', 'You nearly left camp for home once. Tonight, home has come all this way to watch you finish the promise.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_nearly_left }),
        say('germany_captain_adler', '"For what it is worth... the story was real. Now beat them, and earn the ending." He offers a hand.', { condition: (s: JourneyState) => (s.relationships.germany_captain_adler ?? 0) >= 1 }),
      ],
      choices: [
        choice('tunnel-ignore', 'Focus silently and stare down the tunnel', [stat('mental', 4), pressure(-2), press(-1), flag('rtg_tunnel_silent')], 'scene1b_warmup_knee'),
        choice('tunnel-speak', 'Tell him the trophy belongs to us', [morale(3), pressure(2), press(1), fan(1), flag('rtg_tunnel_speak')], 'scene1b_warmup_knee'),
        choice('tunnel-handshake', 'Shake his hand and let your football answer', [rep(2), stat('mental', 2), rel('germany_captain_adler', 1), flag('rtg_tunnel_class')], 'scene1b_warmup_knee'),
      ],
    },
    {
      id: 'scene1b_warmup_knee',
      background: { type: 'lockerRoom', variant: 'before' },
      music: 'tense-ambient',
      characters: [{ id: 'doctor_evans', position: 'right', pose: 'massage-table', expression: 'concerned' }],
      onEnter: pushMessages({
        id: 'rtg_m_evans_final_warmup',
        from: 'Dr. Evans',
        senderType: 'physio',
        avatarSeed: 'doctor_evans',
        time: 'Warm-Up',
        order: 25.5,
        text: 'I flew out for this. Two years ago I told you it would take a miracle. Whatever that knee just did out on the grass — see me before you tell anyone. Quietly.',
      }),
      dialogue: [
        say('narrator', 'The final warm-up. You plant to turn — and the knee that took two years to rebuild locks, white-hot, then lets go. The same knee. The biggest night of your life.'),
        say('doctor_evans', '"I saw it from the bench. Don\'t lie to me — I rebuilt that joint myself. It\'ll get you through ninety minutes. Probably. What it does after that, I can\'t promise you."'),
        say('doctor_evans', '"Three roads. I tell Strand and he protects you — you might not start your own final. We numb it with an injection and roll the dice. Or you carry it and say nothing. Your career, your call."'),
      ],
      choices: [
        choice('warmup-tell', 'Tell Strand the truth and trust him with the call', [rel('national_manager_strand', 2), rel('doctor_evans', 2), stat('mental', 2), injury(-2), flag('rtg_final_honest')], 'scene2_team_talk'),
        choice('warmup-inject', 'Take the injection — numb it and chase immortality', [morale(2), pressure(2), press(1), fan(1), rep(1), injury(3), rel('doctor_evans', -1), flag('rtg_final_injection')], 'scene2_team_talk'),
        choice('warmup-hide', 'Say nothing — you didn\'t come this far to be saved from yourself', [morale(3), pressure(3), press(2), injury(4), stat('physical', -1), flag('rtg_final_hid_injury')], 'scene2_team_talk'),
      ],
    },
    {
      id: 'scene2_team_talk',
      background: { type: 'lockerRoom', variant: 'before' },
      music: 'tense-ambient',
      characters: [
        { id: 'national_manager_strand', position: 'right', pose: 'manager_overcoat', expression: 'determined' },
        { id: 'mentor_okafor', position: 'left', pose: 'assistant_tracksuit', expression: 'happy' },
      ],
      dialogue: [
        say('national_manager_strand', '"I doubted you in the group stage. You answered every doubt. You start. Lead the line." He says it to the whole room, eyes on you.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_kept_shirt }),
        say('national_manager_strand', '"Plan A is on the bench. You\'re my plan A now. When the game needs a hero, I\'m sending you in. Be ready from minute one in your head."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_dropped_grace }),
        say('national_manager_strand', '"And the knee — Evans told me everything. You get an hour. Then I bring you off a hero, not a casualty. We win this one smart." He grips your shoulder.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_final_honest }),
        say('doctor_evans', '"The injection will buy quiet, not safety. Pain is information. You just chose to mute it."', { condition: (s: JourneyState) => !!s.storyFlags.rtg_final_injection }),
        say('narrator', 'You say nothing about the knee. Every step toward the tunnel feels like a secret you are daring the universe to expose.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_final_hid_injury }),
        say('doctor_evans', '"Your injury risk is not theoretical anymore. If it spikes again out there, the trophy will not be the only thing decided tonight."', { condition: (s: JourneyState) => (s.injuryRisk ?? 0) >= 6 }),
        say('national_manager_strand', '"Win, and you\'re immortal. Lose, and you\'re still the man who clawed back from a hospital bed to this tunnel. Now go and decide which."'),
        say('mentor_okafor', '"Everything I wasted, you took and built into this. Whatever happens next — thank you for letting me see it." His eyes are wet.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_okafor_mentor }),
      ],
      choices: [
        choice('teamtalk-roar', 'Roar the dressing room to its feet', [morale(3), rel('captain_whitlock', 1), flag('rtg_final_roar')], 'scene3_final_kickoff'),
        choice('teamtalk-calm', 'Settle them with quiet, ice-cold focus', [stat('mental', 3), pressure(-2), flag('rtg_final_calm')], 'scene3_final_kickoff'),
      ],
    },
    {
      id: 'scene3_final_kickoff',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [{ id: 'england_roommate_fox', position: 'right', pose: 'young_teammate_red_kit', expression: 'determined' }],
      dialogue: [
        say('england_roommate_fox', '"This is it. The ultimate match of our lives. Play for the family, play for the country. Let\'s win this."'),
      ],
      choices: [
        {
          ...choice('play-final-match', 'Play the International Cup Final vs Brazil', [flag('rtg_played_final')], 'scene4_final_win_clean', { matchId: 'rtg_world_cup_final' }),
          postMatchRoutes: [
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'win' },
                { type: 'injuryRisk', min: 6 },
              ],
              nextSceneId: 'scene4_final_win_cost',
            },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'win' },
              ],
              nextSceneId: 'scene4_final_win_clean',
            },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'loss' },
                { type: 'flag', flag: 'rtg_final_injection' },
              ],
              nextSceneId: 'scene4_final_loss_harsh',
            },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'loss' },
                { type: 'flag', flag: 'rtg_final_hid_injury' },
              ],
              nextSceneId: 'scene4_final_loss_harsh',
            },
            {
              gates: [
                { type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'loss' },
                { type: 'injuryRisk', min: 6 },
              ],
              nextSceneId: 'scene4_final_loss_harsh',
            },
            {
              gates: [{ type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'loss' }],
              nextSceneId: 'scene4_final_loss_bittersweet',
            },
            {
              gates: [{ type: 'matchResult', matchId: 'rtg_world_cup_final', result: 'draw' }],
              nextSceneId: 'scene4_final_loss_bittersweet',
            },
          ],
        },
      ],
    },
    {
      id: 'scene4_final_win_clean',
      background: { type: 'pitch', variant: 'match' },
      music: 'warm-ambient',
      characters: [
        { id: 'england_roommate_fox', position: 'left', pose: 'young_teammate_red_kit', expression: 'happy' },
        { id: 'germany_captain_adler', position: 'right', pose: 'germany_defender', expression: 'surprised' },
      ],
      dialogue: [
        say('england_roommate_fox', '"FULL TIME! Look at the scoreboard — we did it! WORLD CHAMPIONS!" He collapses into you, both of you in tears.'),
        say('england_roommate_fox', '"Row Z — LOOK! They let your old man out of that hospital bed to be here. He\'s on his feet, screaming your name." He spins you toward the stand.', { condition: (s: JourneyState) => !!s.storyFlags.rtg_dad_crisis }),
        say('germany_captain_adler', '"The story was real after all." He embraces you. "Wear it well, champion."'),
      ],
      choices: [
        choice('whistle-family', 'Run to the stand to find your family first', [morale(3), rel('sister_mia', 2), flag('rtg_ran_to_family')], 'scene5_victory_aftermath'),
        choice('whistle-team', 'Pile into the bundle with your teammates', [rel('captain_whitlock', 1), rel('england_roommate_fox', 2), flag('rtg_ran_to_team')], 'scene5_victory_aftermath'),
      ],
    },
    {
      id: 'scene4_final_win_cost',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [
        { id: 'england_roommate_fox', position: 'left', pose: 'young_teammate_red_kit', expression: 'happy' },
        { id: 'doctor_evans', position: 'right', pose: 'massage-table', expression: 'concerned' },
      ],
      dialogue: [
        say('england_roommate_fox', '"FULL TIME! We did it! World champions!" His voice cracks when he sees you still on the turf.'),
        say('doctor_evans', '"Do not move. Trophy later. Knee first." He drops beside you, one hand already bracing the joint.'),
        say('narrator', 'The stadium is roaring your name. For one perfect, terrible second, you cannot tell whether you won everything or spent everything.'),
      ],
      choices: [
        choice('cost-accept-help', 'Let Evans help you up before the trophy lift', [rel('doctor_evans', 2), pressure(-1), flag('rtg_final_paid_cost')], 'scene5_medical_cost'),
        choice('cost-stand-alone', 'Force yourself up and limp toward the team', [morale(2), injury(1), pressure(2), flag('rtg_final_paid_cost')], 'scene5_medical_cost'),
      ],
    },
    {
      id: 'scene5_medical_cost',
      background: { type: 'physio', variant: 'treatment' },
      music: 'tense-ambient',
      characters: [
        { id: 'doctor_evans', position: 'left', pose: 'massage-table', expression: 'concerned' },
        { id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_final_cost',
        from: 'Mia',
        senderType: 'family',
        avatarSeed: 'sister_mia',
        time: 'After the Final',
        order: 26,
        text: 'You won. Dad cried. I screamed. Then I saw the limp. Do not you dare pretend the cup makes that fine. We need you walking tomorrow. x',
      }),
      dialogue: [
        say('doctor_evans', '"You are a world champion. You are also getting scans before you climb those steps."'),
        say('agent_coyle', '"The whole world wants you at the podium. They can wait ninety seconds. For once, we protect the man before the myth."'),
      ],
      choices: [
        choice('medical-cost-press', 'Face the cameras with the truth about the cost', [rep(5), rel('doctor_evans', 2), flag('rtg_cost_truth')], 'scene6_press_final'),
        choice('medical-cost-smile', 'Smile through it and keep the night alive', [morale(2), pressure(2), flag('rtg_cost_smiled')], 'scene6_press_final'),
      ],
    },
    {
      id: 'scene4_final_loss_harsh',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [
        { id: 'doctor_evans', position: 'left', pose: 'massage-table', expression: 'concerned' },
        { id: 'england_roommate_fox', position: 'right', pose: 'young_teammate_red_kit', expression: 'concerned' },
      ],
      dialogue: [
        say('england_roommate_fox', '"It is over. Brazil have it. And you can barely stand."'),
        say('doctor_evans', '"This is why I needed the truth before kick-off. We will deal with the result later. Right now, we deal with the knee."'),
        say('narrator', 'The trophy is being carried away in yellow shirts. The pain you muted comes back all at once.'),
      ],
      choices: [
        choice('harsh-loss-own', 'Own the choice and ask what the damage is', [rel('doctor_evans', 1), pressure(2), morale(-2), flag('rtg_final_loss_harsh')], 'scene5_loss_aftermath'),
        choice('harsh-loss-break', 'Sit on the grass until Fox pulls you up', [rel('england_roommate_fox', 2), morale(-1), flag('rtg_final_loss_harsh')], 'scene5_loss_aftermath'),
      ],
    },
    {
      id: 'scene4_final_loss_bittersweet',
      background: { type: 'pitch', variant: 'match' },
      music: 'tense-ambient',
      characters: [
        { id: 'england_roommate_fox', position: 'left', pose: 'young_teammate_red_kit', expression: 'concerned' },
        { id: 'germany_captain_adler', position: 'right', pose: 'germany_defender', expression: 'neutral' },
      ],
      dialogue: [
        say('england_roommate_fox', '"Full time. We came so close. I am sorry, mate."'),
        say('germany_captain_adler', '"You lost a final. You did not lose the story." He offers his hand. "It will hurt. It should."'),
        say('narrator', 'Across the pitch, Brazil lift the trophy. In row Z, your family are still standing. Still clapping.'),
      ],
      choices: [
        choice('bittersweet-family', 'Walk to your family before the medals', [rel('sister_mia', 2), morale(1), flag('rtg_final_loss_bittersweet')], 'scene5_loss_aftermath'),
        choice('bittersweet-team', 'Stay with the team and face the medals together', [rel('england_roommate_fox', 2), stat('mental', 2), flag('rtg_final_loss_bittersweet')], 'scene5_loss_aftermath'),
      ],
    },
    {
      id: 'scene5_loss_aftermath',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'tense-ambient',
      characters: [
        { id: 'reporter_local', position: 'left', pose: 'reporter_notepad', expression: 'concerned' },
        { id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'concerned' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_clough_after_loss',
        from: 'Manager Clough',
        senderType: 'unknown',
        avatarSeed: 'manager_clough',
        time: 'After the Final',
        order: 26,
        text: 'Finals can be cruel. You still proved every one of us wrong, son. That matters more than you know tonight. — Clough',
      }),
      dialogue: [
        say('reporter_local', '"No trophy tonight. But a year ago you were unemployed with a reconstructed knee. What do you say now?"'),
        say('agent_coyle', '"Careful, kid. You do not owe them a perfect quote. Just the truth."'),
      ],
      choices: [
        choice('losspress-honest', '"It hurts because we believed. That belief is coming home with me."', [rep(3), stat('mental', 2), morale(1), press(-1), fan(-1), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
        choice('losspress-vow', '"This is not the end of the comeback. It is the reason I come back again."', [morale(3), pressure(-1), fan(1), rep(2), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
        {
          ...choice('losspress-shield-room', '"Write my name if you need blame. Leave that dressing room alone."', [rel('england_roommate_fox', 2), stat('mental', 2), press(-3), fan(-1), flag('rtg_shielded_room'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'pressPressure', min: 6 }],
        },
        {
          ...choice('losspress-believers', '"The fans who stayed singing saw the real story. We build from them."', [morale(2), rep(3), fan(-2), flag('rtg_backed_believers'), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
          gates: [{ type: 'fanPressure', min: 5 }],
        },
      ],
    },
    {
      id: 'scene5_victory_aftermath',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'warm-ambient',
      characters: [
        { id: 'agent_coyle', position: 'right', pose: 'agent_phone', expression: 'happy' },
        { id: 'doctor_evans', position: 'left', pose: 'massage-table', expression: 'happy' },
      ],
      onEnter: pushMessages({
        id: 'rtg_m_clough_apology',
        from: 'Manager Clough',
        senderType: 'unknown',
        avatarSeed: 'manager_clough',
        time: 'After the Final',
        order: 26,
        text: 'Releasing you was the worst call of my career, and the best thing that ever happened to you. Congratulations, son. You proved every one of us wrong. — Clough',
      }),
      dialogue: [
        say('doctor_evans', '"Reconstructed knee and all... you actually went and did it. Unbelievable."'),
        say('agent_coyle', '"You\'re a legend, kid. A world champion. Your name will be remembered forever."'),
      ],
      choices: [
        choice('aftermath-thank', 'Thank the people who carried you here', [rep(4), rel('doctor_evans', 2), rel('agent_coyle', 2), flag('rtg_thanked_all')], 'scene6_press_final'),
        choice('aftermath-quiet', 'Sit in the quiet and let it all land', [stat('mental', 3), morale(2), flag('rtg_savoured')], 'scene6_press_final'),
      ],
    },
    {
      id: 'scene6_press_final',
      background: { type: 'media', variant: 'pressRoom' },
      music: 'warm-ambient',
      characters: [
        { id: 'reporter_local', position: 'left', pose: 'reporter_notepad', expression: 'happy' },
        { id: 'pundit_grady', position: 'right', pose: 'pundit_studio', expression: 'surprised' },
      ],
      dialogue: [
        say('pundit_grady', '"I called you a free transfer with a dodgy knee who didn\'t deserve the hype. I\'ve never been happier to eat my words on live TV. What do you say to the doubters?"'),
        say('reporter_local', '"And to the kid in a hospital bed somewhere watching this, terrified their career\'s over?"'),
      ],
      choices: [
        choice('finalpress-humble', '"To them: the bottom isn\'t the end. It\'s just chapter one. Keep going."', [rep(6), morale(3), press(-2), fan(1), flag('rtg_legacy_humble')], 'scene7_lift'),
        choice('finalpress-fiery', '"To the doubters: thanks. You were the fuel. Stay loud — I\'m not done."', [morale(4), rep(3), press(2), fan(1), rel('pundit_grady', 1), flag('rtg_legacy_fire')], 'scene7_lift'),
        choice('finalpress-grateful', '"This isn\'t mine. It belongs to a physio, an agent, a coach and a family who never quit on me."', [rep(5), rel('mentor_okafor', 2), rel('doctor_evans', 1), morale(2), fan(-1), flag('rtg_legacy_grateful')], 'scene7_lift'),
      ],
    },
    {
      id: 'scene7_lift',
      background: { type: 'pitch', variant: 'match' },
      music: 'warm-ambient',
      characters: [{ id: 'captain_whitlock', position: 'right', pose: 'captain_red_kit', expression: 'happy' }],
      dialogue: [
        say('captain_whitlock', '"From a trial nobody wanted you at... to this. Get up those steps. The world\'s waiting." He hands you up toward the trophy.'),
      ],
      choices: [
        choice('complete-story', 'Hold the International Cup Trophy high!', [rep(10), morale(10), fan(2), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
        choice('complete-story-family', 'Lift it toward your family in the cheap seats', [rep(8), morale(8), rel('sister_mia', 3), fan(1), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
        choice('complete-story-room', 'Pass it down the line before lifting it yourself', [rep(7), morale(10), rel('captain_whitlock', 2), fan(-1), { type: 'nextEpisode', episodeId: 'season_complete' }], 'season_complete'),
      ],
    },
  ],
};
