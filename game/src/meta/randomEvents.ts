/**
 * Between-game random events / jeopardy. Each event can produce a headline, a
 * phone message, an immediate morale effect, or a decision with consequences.
 * `rollEvents` selects a contextual handful; pure + deterministic given an rng.
 */
import type { MetaContext, MetaEvent, MoraleDelta } from './metaTypes';

interface EventTemplate extends Omit<MetaEvent, 'body' | 'title'> {
  title: string;
  body: string;
  /** weight 0..1 the higher the more likely */
  weight: number;
  /** only fire when this predicate passes */
  when?: (ctx: MetaContext) => boolean;
}

const fill = (s: string, ctx: MetaContext): string => s
  .replace(/\{team\}/g, ctx.teamName)
  .replace(/\{opponent\}/g, ctx.opponent ?? 'the next opponent')
  .replace(/\{star\}/g, ctx.star ?? 'your star man')
  .replace(/\{outOfForm\}/g, ctx.outOfForm ?? ctx.star ?? 'a fringe player')
  .replace(/\{manager\}/g, ctx.managerName);

const fillDelta = (delta: MoraleDelta | undefined, ctx: MetaContext): MoraleDelta | undefined => {
  if (!delta) return undefined;
  return {
    ...delta,
    players: delta.players?.map((p) => ({ name: fill(p.name, ctx), delta: p.delta })),
    availability: delta.availability?.map((p) => ({
      name: fill(p.name, ctx),
      unavailableMatches: p.unavailableMatches,
      reason: p.reason ? fill(p.reason, ctx) : undefined,
    })),
  };
};

const POOL: EventTemplate[] = [
  {
    id: 'injury-scare', title: 'Injury Scare in Training', senderType: 'physio', avatarSeed: 'physio',
    body: '{star} limped out of training with a tight hamstring. The medical team aren\'t sure he\'ll be right for the next match.',
    headline: 'SCARE: {star} limps out of {team} training', weight: 0.5,
    choices: [
      { id: 'rest', text: 'Rest him — protect the player', outcome: 'He sits out, fresh for later rounds, but the group misses its leader.', effect: { players: [{ name: '{star}', delta: 4 }], availability: [{ name: '{star}', unavailableMatches: 1, reason: 'Tight hamstring' }], squad: -2 } },
      { id: 'risk', text: 'Gamble and play him', outcome: 'He declares himself fit. The fans are thrilled — but it\'s a risk.', effect: { fans: 5, players: [{ name: '{star}', delta: 2 }], pressure: 4 } },
    ],
  },
  {
    id: 'bust-up', title: 'Training Ground Bust-Up', senderType: 'assistant', avatarSeed: 'assistant',
    body: 'Two of your players squared up after a heavy challenge in training. The assistant wants to know how to handle it.',
    headline: 'Tempers flare at {team} camp', weight: 0.35,
    choices: [
      { id: 'clear-air', text: 'Clear-the-air meeting', outcome: 'You get everyone talking. The air clears and bonds tighten.', effect: { squad: 6, pressure: -2 } },
      { id: 'fine', text: 'Fine them both, move on', outcome: 'Discipline restored, but a couple of egos are bruised.', effect: { squad: -3, board: 3 } },
      { id: 'ignore', text: 'Let it blow over', outcome: 'It festers. Whispers reach the media.', effect: { squad: -4, media: -3 } },
    ],
  },
  {
    id: 'transfer-rumour', title: 'Spotlight on the Star', senderType: 'media', avatarSeed: 'media',
    body: 'The whole tournament is talking about {star}. Every pundit and paper wants to know if he can deliver on the biggest stage of all.',
    headline: '{star}: the name on everyone\'s lips', weight: 0.45,
    effect: { media: 2, players: [{ name: '{star}', delta: 3 }], pressure: 2 },
    message: { from: 'Agent — Coyle', senderType: 'agent', text: 'Seen the back pages? The whole country\'s talking about the lad. Keep him starting and let him answer them on the pitch — that\'s all that matters now.' },
  },
  {
    id: 'wants-to-start', title: 'Player Wants to Start', senderType: 'teammate', avatarSeed: 'wantsstart',
    body: '{outOfForm} knocked on your door. He\'s unhappy on the bench and wants assurances about his place.',
    headline: '', weight: 0.4, when: (c) => (c.matchNumber ?? 0) >= 1,
    choices: [
      { id: 'promise', text: 'Promise him minutes', outcome: 'He leaves smiling — now you have to deliver.', effect: { players: [{ name: '{outOfForm}', delta: 7 }], pressure: 3 } },
      { id: 'honest', text: 'Be honest: earn it in training', outcome: 'A frank chat. He respects the honesty, even if he\'s not thrilled.', effect: { players: [{ name: '{outOfForm}', delta: -2 }], squad: 2 } },
      { id: 'dismiss', text: 'Tell him to focus on the team', outcome: 'He walks out unhappy. That could fester.', effect: { players: [{ name: '{outOfForm}', delta: -6 }] } },
    ],
  },
  {
    id: 'fan-protest', title: 'Fan Discontent', senderType: 'fan', avatarSeed: 'fanvoice',
    body: 'A section of supporters have voiced frustration online about the team\'s style of play.',
    headline: 'Fans split over {team} approach', weight: 0.3, when: (c) => c.tone === 'post-draw' || c.tone === 'post-loss',
    effect: { fans: -3 },
    message: { from: 'Supporters\' Club', senderType: 'fan', text: 'Boss, the fans want to see us go for it. We\'re behind you — but show us some ambition out there.' },
  },
  {
    id: 'sponsor', title: 'Federation Expectations', senderType: 'chairman', avatarSeed: 'exec_ceo',
    body: 'The federation\'s backers want a deep run — and the nation\'s eyes on {star}. The chief executive passed the message along.',
    headline: '', weight: 0.28,
    message: { from: 'G. Hartley · Chief Exec', senderType: 'chairman', text: 'The whole federation is behind this run — backers, blazers and supporters alike. Go deep and you put the nation on the map. No pressure. (There\'s pressure.)' },
    effect: { pressure: 3, board: 2 },
  },
  {
    id: 'federation-panic', title: 'Federation Alarm', senderType: 'chairman', avatarSeed: 'exec_panic',
    body: 'Senior federation figures are worried the tournament is slipping below expectation. They want a clearer plan before the next public appearance.',
    headline: '{team} federation demands answers after standards slip', weight: 0.9,
    when: (c) => (
      (c.expectationTier === 'favourite' || c.expectationTier === 'contender')
      && (c.performanceMood === 'collapse' || c.performanceMood === 'underperforming')
    ),
    message: {
      from: 'G. Hartley · Chief Exec',
      senderType: 'chairman',
      text: 'This cannot drift. The board expected control, not questions. I need to know what changes before the next match.',
      requiresResponse: true,
      replies: [
        { id: 'own', text: 'I will own it and tighten the group.', response: 'Good. Show leadership now.', effect: { board: 3, squad: 2, pressure: -1 } },
        { id: 'protect', text: 'I will protect the players publicly.', response: 'Fine, but results have to follow.', effect: { squad: 4, board: -1, pressure: 1 } },
        { id: 'change', text: 'There will be changes.', response: 'That will satisfy some people. Make sure they are the right ones.', effect: { media: 2, pressure: 2, players: [{ name: '{outOfForm}', delta: -3 }] } },
      ],
    },
  },
  {
    id: 'fairytale-wave', title: 'A Nation Swept Up', senderType: 'fan', avatarSeed: 'fairytale_wave',
    body: 'Videos from plazas, bars and living rooms back home are everywhere. The country has started to believe this run can become history.',
    headline: '{team} fairytale grips supporters back home', weight: 0.9,
    when: (c) => (
      !!c.underdog
      || ((c.expectationTier === 'minnow' || c.expectationTier === 'outsider') && (c.performanceMood === 'heroic' || c.performanceMood === 'overperforming'))
    ),
    effect: { fans: 7, squad: 3, media: 3, pressure: 2 },
    message: { from: 'Supporters\' Club', senderType: 'fan', text: 'Boss, it feels different now. Kids are wearing shirts in the streets, people believe. Give us one more night like that.' },
  },
  {
    id: 'one-result-from-history', title: 'History Feels Close', senderType: 'captain', avatarSeed: 'history_captain',
    body: 'The captain senses the players know how close they are to changing the way this team is remembered.',
    headline: '{team} stand one result from history', weight: 0.62,
    when: (c) => (
      (c.matchNumber ?? 0) >= 3
      && (!!c.underdog || c.expectationTier === 'minnow' || c.expectationTier === 'outsider')
      && (c.performanceMood === 'heroic' || c.performanceMood === 'overperforming' || c.tone === 'post-win')
    ),
    message: {
      from: 'Captain',
      senderType: 'captain',
      text: 'Boss, the lads can feel what is at stake. Do we lean into the history talk or shut it out?',
      replies: [
        { id: 'embrace', text: 'Embrace it. These chances are rare.', response: 'They will be ready for the moment.', effect: { squad: 5, pressure: 3, fans: 2 } },
        { id: 'quiet', text: 'Shut it out. Stay normal.', response: 'Understood. Same routine, same standards.', effect: { pressure: -3, squad: 2 } },
      ],
    },
  },
  {
    id: 'leaked-xi', title: 'Leaked Team News', senderType: 'media', avatarSeed: 'leak',
    body: 'Your starting XI for the next match has leaked to the press a day early. Someone in the camp is talking.',
    headline: '{team} XI leaks ahead of {opponent} clash', weight: 0.25, when: (c) => (c.matchNumber ?? 0) >= 1,
    effect: { media: -2, squad: -2, pressure: 3 },
  },
  {
    id: 'wonderkid', title: 'A Wonderkid Emerges', senderType: 'assistant', avatarSeed: 'wonderkid',
    body: 'A young squad player has been tearing it up in training. The staff think he\'s ready for a chance.',
    headline: 'Teen sensation pushing for {team} debut', weight: 0.3,
    effect: { squad: 3, fans: 2 },
    message: { from: 'Assistant', senderType: 'assistant', text: 'The kid\'s ready, gaffer. Give him 20 minutes and he\'ll repay you. Just a thought.' },
  },
  {
    id: 'family', title: 'A Word From Home', senderType: 'family', avatarSeed: 'family',
    body: 'Your family sent their support ahead of the big games. A reminder of why you do this.',
    headline: '', weight: 0.25,
    effect: { pressure: -3, reputation: 1 },
    message: { from: 'Home', senderType: 'family', text: 'So proud of you out there. Whatever happens, we\'re all watching and cheering. Bring it home! x' },
  },
  {
    id: 'illness', title: 'Bug in the Camp', senderType: 'physio', avatarSeed: 'illness',
    body: 'A 24-hour bug is going around the hotel. A couple of players are feeling rough.',
    headline: 'Virus sweeps {team} camp', weight: 0.22,
    effect: { squad: -3, players: [] },
  },
  {
    id: 'bonus-row', title: 'Bonus Row', senderType: 'captain', avatarSeed: 'captain',
    body: 'The squad and the federation are at odds over tournament bonuses. The captain is asking you to back the players.',
    headline: '{team} bonus dispute threatens camp', weight: 0.22, when: (c) => (c.matchNumber ?? 0) >= 2,
    choices: [
      { id: 'players', text: 'Back the players publicly', outcome: 'The squad loves you for it. The blazers, less so.', effect: { squad: 8, board: -5, media: 3 } },
      { id: 'board', text: 'Stay out of it', outcome: 'You keep the federation onside but the players feel let down.', effect: { squad: -5, board: 4 } },
    ],
  },
  {
    id: 'pundit-jab', title: 'Pundit Takes Aim', senderType: 'pundit', avatarSeed: 'pundit',
    body: 'A famous pundit questioned whether you\'re the right manager for this group, live on air.',
    headline: 'Pundit: "{team} are underachieving"', weight: 0.3,
    effect: { media: -3, pressure: 3, squad: 1 },
    message: { from: 'Old Teammate', senderType: 'teammate', text: 'Saw what that pundit said. Ignore him — he couldn\'t lace your boots. We\'ve got your back.' },
  },
  {
    id: 'morale-high', title: 'Spirits Soaring', senderType: 'assistant', avatarSeed: 'spirits',
    body: 'The mood in camp is electric after recent results. The players are flying in training.',
    headline: '', weight: 0.3, when: (c) => c.tone === 'post-win',
    effect: { squad: 5, fans: 2 },
  },
  {
    id: 'captain-unity-call', title: 'Captain Wants A Word', senderType: 'captain', avatarSeed: 'captain',
    body: 'The captain thinks the group needs a clear message before the next match. He is asking whether you want the room together tonight.',
    headline: 'Captain calls for unity inside {team} camp', weight: 0.36, when: (c) => c.tone === 'post-loss' || (c.pressure ?? 0) >= 58,
    message: {
      from: 'Captain',
      senderType: 'captain',
      text: 'Boss, the lads need to hear where this is going. Do you want me to get everyone together?',
      requiresResponse: true,
      replies: [
        { id: 'meet', text: 'Yes. I will speak to everyone.', response: 'Good. They need that from you.', effect: { squad: 5, pressure: -1 } },
        { id: 'captain', text: 'You handle it. I trust your voice.', response: 'Understood. I will get them together.', effect: { squad: 2, players: [{ name: '{star}', delta: 2 }] } },
        { id: 'pitch', text: 'No speeches. We answer on the pitch.', response: 'Fair enough. I hope they read it the same way.', effect: { pressure: 2, squad: -2 } },
      ],
    },
  },
  {
    id: 'journalist-bait', title: 'Journalist Chasing A Quote', senderType: 'media', avatarSeed: 'quote_chaser',
    body: 'A reporter has messaged asking for one line on the tension around the squad. It feels like bait.',
    headline: '', weight: 0.28, when: (c) => c.pressStance === 'hostile',
    message: {
      from: 'Mara Vale · Back Page',
      senderType: 'media',
      text: 'Quick quote, boss? People are saying the camp looks split. Care to answer that before we publish?',
      requiresResponse: true,
      replies: [
        { id: 'calm', text: 'There is no split. We are focused.', response: 'Appreciate the line. We will use it.', effect: { media: 2, pressure: -1 } },
        { id: 'protect', text: 'Do not drag my players into gossip.', response: 'Strong. That is a headline too.', effect: { squad: 3, media: -3 } },
        { id: 'ignore', text: 'No comment.', response: 'Understood. We will run what we have.', effect: { media: -2, pressure: 2 } },
      ],
    },
  },
  {
    id: 'star-pressure-talk', title: 'Star Carrying The Noise', senderType: 'teammate', avatarSeed: 'star_pressure',
    body: '{star} has stayed late after training. The attention is starting to weigh on him.',
    headline: '{star} shoulders {team} expectation', weight: 0.34, when: (c) => (c.matchNumber ?? 0) >= 1,
    choices: [
      { id: 'protect', text: 'Protect him publicly and lower the noise', outcome: 'He relaxes, and the group notices you protecting one of their own.', effect: { players: [{ name: '{star}', delta: 8 }], squad: 3, media: -1 } },
      { id: 'challenge', text: 'Tell him great players carry pressure', outcome: 'He takes the challenge. It could bring the best out of him.', effect: { players: [{ name: '{star}', delta: 4 }], pressure: 2, fans: 2 } },
      { id: 'rest', text: 'Quietly tell him he may start from the bench', outcome: 'The pressure drops, but his pride takes a hit.', effect: { players: [{ name: '{star}', delta: -5 }], pressure: -3 } },
    ],
  },
  {
    id: 'federation-warning', title: 'Federation Pressure', senderType: 'chairman', avatarSeed: 'exec_warning',
    body: 'The federation is nervous about the tone around the camp. The chief executive wants reassurance before the next media window.',
    headline: 'Federation seeks calm as {team} pressure rises', weight: 0.3, when: (c) => (c.pressure ?? 0) >= 55 || c.tone === 'post-loss',
    message: {
      from: 'G. Hartley · Chief Exec',
      senderType: 'chairman',
      text: 'We can absorb pressure, but not chaos. Keep the public message controlled and make sure the players still believe.',
      replies: [
        { id: 'controlled', text: 'The message will be controlled.', response: 'Good. That is what we need.', effect: { board: 3, pressure: -1 } },
        { id: 'players', text: 'I will always back the players first.', response: 'Fine, but remember the institution too.', effect: { squad: 3, board: -2 } },
      ],
    },
  },
  {
    id: 'underdog-hype', title: 'The Country Starts To Believe', senderType: 'fan', avatarSeed: 'fan_hype',
    body: 'Clips of fans celebrating back home are everywhere. The tournament is starting to feel bigger by the hour.',
    headline: '{team} fever sweeps the nation', weight: 0.35, when: (c) => c.tone === 'post-win' && (c.matchNumber ?? 0) >= 2,
    effect: { fans: 5, squad: 2, pressure: 2 },
    message: { from: 'Supporters\' Club', senderType: 'fan', text: 'Boss, everyone is out in the streets. Keep this going and you will make people remember this summer forever.' },
  },
  {
    id: 'assistant-shape-warning', title: 'Assistant Flags A Pattern', senderType: 'assistant', avatarSeed: 'assistant_shape',
    body: 'Your assistant has spotted a weakness the next opponent may target. The players need either reassurance or a sharper tactical message.',
    headline: '', weight: 0.31, when: (c) => c.tone === 'pre-match',
    message: {
      from: 'Assistant',
      senderType: 'assistant',
      text: 'One thing before selection: they will test our wide channels. We can drill it hard or keep the message simple.',
      replies: [
        { id: 'drill', text: 'Drill it hard. I want discipline.', response: 'Done. It may make the session heavier, but shape will be clearer.', effect: { squad: -1, pressure: 1 } },
        { id: 'simple', text: 'Keep it simple and confident.', response: 'Understood. Less detail, more belief.', effect: { squad: 2, pressure: -1 } },
      ],
    },
  },
];

export interface RolledEvents {
  events: MetaEvent[];
}

/** Pick 0-2 contextual events for a between-game window. */
export function rollEvents(ctx: MetaContext, rng: () => number, max = 2): MetaEvent[] {
  const eligible = POOL.filter((e) => !e.when || e.when(ctx));
  // shuffle by weight*rng
  const scored = eligible.map((e) => ({ e, s: rng() * e.weight })).sort((x, y) => y.s - x.s);
  const out: MetaEvent[] = [];
  for (const { e, s } of scored) {
    if (out.length >= max) break;
    // probability gate so quiet windows happen too
    if (rng() < 0.45 + s) {
      out.push({
        ...e,
        title: fill(e.title, ctx),
        body: fill(e.body, ctx),
        headline: e.headline ? fill(e.headline, ctx) : undefined,
        message: e.message ? {
          ...e.message,
          text: fill(e.message.text, ctx),
          replies: e.message.replies?.map((r) => ({
            ...r,
            text: fill(r.text, ctx),
            response: r.response ? fill(r.response, ctx) : undefined,
            effect: fillDelta(r.effect, ctx),
          })),
        } : undefined,
        choices: e.choices?.map((c) => ({ ...c, outcome: c.outcome ? fill(c.outcome, ctx) : undefined, effect: fillDelta(c.effect, ctx) })),
        effect: fillDelta(e.effect, ctx),
      });
    }
  }
  return out;
}

export function eventCount(): number { return POOL.length; }
