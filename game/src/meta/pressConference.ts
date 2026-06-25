/**
 * Press conferences shared by the cup and story modes. A contextual question
 * pool (`buildPressConference`) + a fixed-layout DOM overlay
 * (`mountPressConference`) where the speaker and reporters live in the stage and
 * the Q&A sits in a solid bottom panel they never cover.
 */
import type { MetaContext, MoraleDelta, PressAnswer, PressConference, PressQuestion, PressResult } from './metaTypes';
import { addDelta, emptyDelta } from './metaTypes';
import { reporterAvatar } from './avatarAssets';

const a = (
  id: string,
  text: string,
  tone: PressAnswer['tone'],
  effect: MoraleDelta,
  reaction: string,
  narrative?: PressAnswer['narrative'],
  followUp?: PressQuestion,
): PressAnswer => ({ id, text, tone, effect, reaction, narrative, followUp });

/** Build a follow-up question (shown right after the answer that prompts it). */
const fu = (id: string, reporter: string, text: string, answers: PressAnswer[]): PressQuestion => ({
  id, reporter, reporterSeed: reporter, text, answers,
});

interface QTemplate {
  id: string;
  tones: MetaContext['tone'][];
  reporter: string;
  /** text may contain {opponent} {team} {stage} {star} {outOfForm} substitutions */
  text: string;
  answers: PressAnswer[];
  when?: (ctx: MetaContext) => boolean;
}

const POOL: QTemplate[] = [
  {
    id: 'expectation', tones: ['pre-tournament'], reporter: 'Sky Sports',
    text: 'The nation expects. Are {team} here to win this tournament, or just to compete?',
    answers: [
      a('a1', "We're here to win it. Nothing less is acceptable.", 'confident', { fans: 8, squad: 4, pressure: 9, board: 5 }, 'The room sits up — bold words that just raised the stakes.', undefined,
        fu('expectation-fu', 'The Athletic', 'Bold. Then name your biggest rival for the title.', [
          a('f1', 'Ourselves. Beat that and the rest follows.', 'calm', { media: 3, pressure: -2 }, "A diplomat's answer."),
          a('f2', 'Everyone. We fear no one.', 'defiant', { fans: 4, squad: 3, pressure: 3 }, 'A rallying cry.'),
          a('f3', "I'm not handing anyone a headline.", 'deflect', { media: -2 }, 'A wry smile — moving on.'),
        ])),
      a('a2', 'One game at a time. Respect every opponent.', 'humble', { media: 6, pressure: -4, board: 3 }, 'A measured, safe answer. The press nod along.'),
      a('a3', "We've got the talent to trouble anyone. Watch us.", 'defiant', { fans: 6, squad: 6, media: -3, pressure: 4 }, 'A few smiles in the room, a couple of raised eyebrows.'),
      a('a4', "I'd rather let the football do the talking.", 'deflect', { media: -2, pressure: -2 }, 'A reporter sighs — not much of a headline there.'),
    ],
  },
  {
    id: 'group', tones: ['pre-tournament'], reporter: 'The Athletic',
    text: 'A tough group on paper. Which game worries you most?',
    answers: [
      a('a1', 'None of them. We fear no one.', 'defiant', { squad: 5, fans: 5, pressure: 5 }, 'The squad will love that line.'),
      a('a2', "Every game's a final at this level. We're ready for all of them.", 'calm', { board: 4, media: 3 }, 'Professional, no fireworks.'),
      a('a3', "Honestly? I worry about us, not them — about our standards.", 'honest', { media: 5, squad: -2, pressure: 3 }, 'An interesting, candid answer.'),
    ],
  },
  {
    id: 'gameplan', tones: ['pre-match'], reporter: 'BBC Sport',
    text: "What's the plan against {opponent} tomorrow?",
    answers: [
      a('a1', "We'll take the game to them. Front foot, high line.", 'confident', { squad: 5, fans: 4, pressure: 4 }, "Attacking intent — that'll please the fans."),
      a('a2', "We respect {opponent}, but we'll play our way.", 'calm', { media: 4, board: 3 }, 'Balanced and assured.'),
      a('a3', "I'm not giving my tactics away in here.", 'deflect', { media: -3, pressure: -2 }, 'A wry laugh — fair enough, boss.'),
      a('a4', "Whatever it takes to win. This is knockout football now.", 'fiery', { squad: 4, fans: 5, media: -2, pressure: 3 }, 'The pundits scribble that one down.'),
    ],
  },
  {
    id: 'hostile-pressure', tones: ['pre-match', 'post-loss', 'crisis'], reporter: 'Back Page',
    text: '{manager}, critics say the camp looks tense and the football has gone flat. Why should supporters believe this changes against {opponent}?',
    when: (ctx) => ctx.pressStance === 'hostile',
    answers: [
      a('a1', 'Because this group has more character than the noise around it.', 'defiant', { squad: 4, media: -2, pressure: 2 }, 'That answer will split the room.', { arc: { type: 'press-feud', heat: 6 }, headline: { title: '{manager} fires back as {team} heat rises', source: 'Back Page', tone: 'sensational' } }),
      a('a2', 'The criticism is fair. It is on me to get a reaction.', 'honest', { media: 4, pressure: -2, squad: 1 }, 'A few reporters nod at the honesty.', { headline: { title: '{manager} takes blame as {team} seek response', source: 'World Game Wire', tone: 'neutral' } }),
      a('a3', 'I will not hang players out to dry for a headline.', 'protective', { squad: 5, media: -3 }, 'The squad will like that. The back pages might not.', { arc: { type: 'squad-unity', heat: 5 } }),
    ],
  },
  {
    id: 'friendly-buzz', tones: ['pre-match', 'post-win'], reporter: 'Matchday Live',
    text: 'The mood around {team} is lifting. Does this feel like the start of something special?',
    when: (ctx) => ctx.pressStance === 'friendly',
    answers: [
      a('a1', 'It feels good, but nothing is won in a press room.', 'calm', { pressure: -2, media: 3, board: 2 }, 'A neat way to keep everyone grounded.'),
      a('a2', 'The fans can dream. That is what tournaments are for.', 'public', { fans: 6, media: 3, pressure: 2 }, 'That line will travel fast.', { arc: { type: 'underdog-run', heat: 5 }, headline: { title: '{team} dare to dream after {manager} rallying cry', source: 'Supporters Voice', tone: 'positive' } }),
      a('a3', 'Inside the camp, we only talk about the next game.', 'private', { squad: 3, pressure: -3 }, 'Businesslike and controlled.'),
    ],
  },
  {
    id: 'favourite-crisis', tones: ['post-loss', 'post-draw', 'crisis', 'pre-match'], reporter: 'World Game Wire',
    text: 'For a squad with {team} standards, is this a crisis or a warning that expectations have got ahead of reality?',
    when: (ctx) => (
      (ctx.expectationTier === 'favourite' || ctx.expectationTier === 'contender')
      && (ctx.performanceMood === 'collapse' || ctx.performanceMood === 'underperforming' || ctx.pressStance === 'hostile')
    ),
    answers: [
      a('a1', 'The standards are high because the players are good enough. We accept that.', 'honest', { media: 4, pressure: -2, board: 2 }, 'A clear answer that owns the expectation.', { arc: { type: 'favourite-pressure', heat: 5 }, headline: { title: '{manager} says {team} must live with elite standards', source: 'World Game Wire', tone: 'neutral' } }),
      a('a2', 'Crisis is your word. Inside the camp it is one poor result, not a collapse.', 'defiant', { squad: 3, media: -3, pressure: 3 }, 'The back row bristles at that.', { arc: { type: 'press-feud', heat: 5 }, headline: { title: '{manager} rejects crisis talk as {team} scrutiny grows', source: 'Back Page', tone: 'sensational' } }),
      a('a3', 'The alarm is fair. Now I need to make sure it wakes us up.', 'blunt', { media: 5, squad: -1, pressure: 1 }, 'That line will lead every bulletin.', { arc: { type: 'federation-panic', heat: 4 }, headline: { title: 'Alarm admitted inside {team} camp', source: 'Tournament Desk', tone: 'negative' } }),
      a('a4', 'I will explain it to the players, not perform an inquest for cameras.', 'private', { squad: 3, media: -2, pressure: -1 }, 'A boundary drawn sharply.'),
    ],
  },
  {
    id: 'minnow-dream', tones: ['post-win', 'post-draw', 'pre-match'], reporter: 'Supporters Voice',
    text: 'People back home are calling this a fairytale. Do you let {team} dream now, or do you keep everyone grounded?',
    when: (ctx) => (
      !!ctx.underdog
      || ((ctx.expectationTier === 'minnow' || ctx.expectationTier === 'outsider') && (ctx.performanceMood === 'heroic' || ctx.performanceMood === 'overperforming'))
    ),
    answers: [
      a('a1', 'Let them dream. Football belongs to people who believe before anyone else does.', 'public', { fans: 8, media: 4, pressure: 3 }, 'That will be replayed all night back home.', { arc: { type: 'fairytale-run', heat: 8 }, headline: { title: '{team} fairytale gathers pace after {manager} dream line', source: 'Supporters Voice', tone: 'positive' }, message: { from: 'Supporters\' Club', senderType: 'fan', text: 'Boss, that line hit home. Everyone is talking about belief now. Keep us dreaming.', replies: [{ id: 'together', text: 'We keep going together.', response: 'Always.', effect: { fans: 3, pressure: 1 } }] } }),
      a('a2', 'History is close enough to see, but only if we stay humble.', 'humble', { squad: 4, fans: 4, pressure: -2 }, 'Measured, but still full of feeling.', { arc: { type: 'one-result-from-history', heat: 5 } }),
      a('a3', 'The story is nice. The next training session matters more.', 'calm', { squad: 3, pressure: -4, media: 1 }, 'The staff will appreciate the reset.'),
    ],
  },
  {
    id: 'golden-generation-pressure', tones: ['pre-match', 'post-win', 'post-draw'], reporter: 'The Athletic',
    text: 'This group has been called a golden generation. Is that inspiring the players, or weighing on them?',
    when: (ctx) => ctx.expectationTier === 'favourite' || ctx.expectationTier === 'contender',
    answers: [
      a('a1', 'It inspires them. Big players should want big labels.', 'confident', { fans: 5, squad: 3, pressure: 4 }, 'Ambitious, and risky if the next result goes wrong.', { arc: { type: 'golden-generation', heat: 6 } }),
      a('a2', 'Labels do not win knockout matches. Habits do.', 'calm', { media: 3, pressure: -3, board: 2 }, 'The answer lands with the analysts.'),
      a('a3', 'I would rather talk about the squad we are becoming than the one people imagined.', 'honest', { squad: 3, media: 4, pressure: -1 }, 'A thoughtful answer that shifts the frame.'),
    ],
  },
  {
    id: 'pressure-match', tones: ['pre-match'], reporter: 'TalkSport',
    text: 'Lose tomorrow and the knives come out. Feeling the heat?',
    answers: [
      a('a1', 'Pressure is a privilege. We embrace it.', 'confident', { squad: 4, fans: 5, pressure: 2 }, 'A quotable line — the back pages will run it.'),
      a('a2', "I sleep fine. My players are ready.", 'calm', { board: 4, pressure: -3 }, 'Cool under fire.'),
      a('a3', "Write what you like. We'll answer on the pitch.", 'defiant', { fans: 6, media: -5, pressure: 3 }, 'A frosty exchange — the journalist bristles.'),
    ],
  },
  {
    id: 'win-reaction', tones: ['post-win'], reporter: 'ITV',
    text: 'A big win. How proud are you of the players?',
    answers: [
      a('a1', "Immensely. They were magnificent today.", 'humble', { squad: 8, fans: 4, board: 3 }, 'The dressing room will glow at that praise.'),
      a('a2', "Good, but we can be better. We move on.", 'calm', { squad: 2, board: 4, pressure: -2 }, 'Eyes already on the next one.'),
      a('a3', "This is just the start. We're going all the way.", 'confident', { fans: 8, squad: 5, pressure: 6 }, 'The fans are dreaming now.'),
    ],
  },
  {
    id: 'win-star', tones: ['post-win'], reporter: 'Sky Sports',
    text: '{star} was the difference-maker. Is he the best in the tournament?',
    answers: [
      a('a1', 'On that form? Nobody touches him.', 'confident', { players: [{ name: '{star}', delta: 10 }], media: 3, pressure: 4 }, '{star} will be buzzing reading that.', undefined,
        fu('win-star-fu', 'Sky Sports', 'So is {star} the player of the season, no debate?', [
          a('f1', "No debate. He's been unplayable.", 'confident', { players: [{ name: '{star}', delta: 6 }], fans: 4, pressure: 3 }, 'A bold endorsement — that writes itself.'),
          a('f2', "He's in the conversation. Let others decide.", 'humble', { media: 4, players: [{ name: '{star}', delta: 2 }] }, 'A politic answer.'),
          a('f3', 'Individual awards are a distraction.', 'deflect', { media: -3, squad: 2 }, 'The room wanted more.'),
        ])),
      a('a2', "He's a team player. The win was collective.", 'humble', { squad: 5, players: [{ name: '{star}', delta: 3 }] }, 'A unifying message.'),
      a('a3', "Let's not get carried away. He'll keep his feet on the ground.", 'calm', { players: [{ name: '{star}', delta: -2 }], board: 3 }, 'Keeping the hype in check.'),
    ],
  },
  {
    id: 'loss-blame', tones: ['post-loss'], reporter: 'The Sun',
    text: 'A damaging defeat. Who takes responsibility for that?',
    answers: [
      a('a1', "I do. The buck stops with me.", 'honest', { board: 5, fans: 6, media: 6, pressure: -3 }, 'A statesmanlike answer that wins the room over.', undefined,
        fu('loss-blame-fu', 'BBC Sport', 'Will you shake up the team after that?', [
          a('f1', 'If needed, yes. No one is undroppable.', 'honest', { squad: -3, media: 4, pressure: 2 }, 'A warning shot across the dressing room.'),
          a('f2', 'I back this group to respond. Few changes.', 'protective', { squad: 5, board: 2 }, 'The players will rally round that.'),
          a('f3', "You'll see on matchday.", 'deflect', { media: -2, pressure: 1 }, 'A smirk — no clues given.'),
        ])),
      a('a2', "We win together, we lose together. No one's hiding.", 'calm', { squad: 7, fans: 3 }, 'The players will appreciate the cover.'),
      a('a3', 'Some individuals have to look at themselves.', 'fiery', { squad: -8, media: 4, pressure: 5 }, 'Gasps — that will land hard in the dressing room.'),
      a('a4', "Ask me after the next game.", 'deflect', { media: -5, board: -3, pressure: 3 }, 'A non-answer that frustrates everyone.'),
    ],
  },
  {
    id: 'loss-future', tones: ['post-loss', 'crisis'], reporter: 'BBC Sport',
    text: "Is your position under threat after that?",
    answers: [
      a('a1', "I'm going nowhere. We'll fix this.", 'defiant', { squad: 4, fans: 4, board: -2, pressure: 4 }, 'Defiant — but he just put a target on his back.'),
      a('a2', "That's for others to decide. I'll keep working.", 'humble', { board: 4, media: 5, pressure: -2 }, 'Dignified under pressure.'),
      a('a3', "One result doesn't define us. Judge us at the end.", 'calm', { board: 3, fans: 2 }, 'A reasonable plea for patience.'),
    ],
  },
  {
    id: 'selection', tones: ['selection', 'pre-match'], reporter: 'The Athletic',
    text: 'Big calls in your XI. Why leave out some of the big names?',
    answers: [
      a('a1', "I pick on form and fitness, not reputation.", 'honest', { squad: 3, media: 5, players: [{ name: '{outOfForm}', delta: -4 }] }, 'A clear philosophy laid out.'),
      a('a2', "Every player here is ready when called. It's a squad game.", 'calm', { squad: 5, board: 3 }, 'Keeping the group onside.'),
      a('a3', "Trust me, I know what I'm doing.", 'defiant', { media: -3, pressure: 3, board: -2 }, 'A little prickly with the press.'),
    ],
  },
  {
    id: 'selection-scrutiny', tones: ['selection', 'pre-match', 'post-loss'], reporter: 'Tournament Desk',
    text: 'There are questions about selection. Is {outOfForm} still part of your plan?',
    when: (ctx) => !!ctx.unhappy?.length || ctx.pressStance === 'hostile',
    answers: [
      a('a1', 'He is part of the group, but nobody gets a free shirt.', 'blunt', { media: 3, players: [{ name: '{outOfForm}', delta: -4 }], pressure: 2 }, 'A direct answer that will reach the player.', { arc: { type: 'selection-scrutiny', heat: 6 } }),
      a('a2', 'He has my backing. I need him ready when called.', 'protective', { squad: 3, players: [{ name: '{outOfForm}', delta: 7 }] }, 'A public arm around the shoulder.'),
      a('a3', 'That conversation stays between us.', 'private', { media: -2, pressure: -1, players: [{ name: '{outOfForm}', delta: 3 }] }, 'The room wanted more, but the player may appreciate it.'),
    ],
  },
  {
    id: 'speculation', tones: ['speculation'], reporter: 'Fabrizio (reporter)',
    text: 'There are rumours {star} could be on the move after the tournament. Any truth?',
    answers: [
      a('a1', "He's fully focused here. The rest is noise.", 'calm', { players: [{ name: '{star}', delta: 4 }], media: 3 }, 'Smoothly shut down.'),
      a('a2', "I can't control transfer gossip. Next question.", 'deflect', { media: -2, pressure: 2 }, 'Brushed aside, but the story runs anyway.'),
      a('a3', "If clubs want him, they can pay what he's worth.", 'confident', { players: [{ name: '{star}', delta: 6 }], board: -3, media: 5 }, 'That headline writes itself.'),
    ],
  },
  {
    id: 'form', tones: ['form'], reporter: 'TalkSport',
    text: '{outOfForm} has been off the boil. Is his place in danger?',
    answers: [
      a('a1', "He's a top player going through a dip. He has my full backing.", 'humble', { players: [{ name: '{outOfForm}', delta: 8 }], squad: 3 }, 'A real arm round the shoulder.'),
      a('a2', "Nobody's place is guaranteed. He knows that.", 'honest', { players: [{ name: '{outOfForm}', delta: -5 }], media: 4, pressure: 2 }, 'A pointed message to the player.'),
      a('a3', "Form is temporary. I judge over a tournament, not a game.", 'calm', { players: [{ name: '{outOfForm}', delta: 3 }], board: 3 }, 'Patient and considered.'),
    ],
  },
  {
    id: 'unrest', tones: ['crisis'], reporter: 'The Guardian',
    text: "There are whispers of unrest in the camp. Have you lost the dressing room?",
    answers: [
      a('a1', "Absolutely not. This group is rock solid.", 'defiant', { squad: 6, media: -2, pressure: 3 }, 'Strong denial — the players hear it.'),
      a('a2', "Show me a camp with no disagreements and I'll show you a camp that doesn't care.", 'honest', { media: 6, squad: 2 }, 'A clever, disarming line.'),
      a('a3', "I won't dignify dressing-room gossip.", 'deflect', { media: -4, pressure: 3 }, 'The story keeps legs.'),
    ],
  },
  {
    id: 'deep-run-final', tones: ['pre-match', 'post-win'], reporter: 'World Game Wire',
    text: '{stage} pressure is different. Are you protecting the players from the size of the occasion?',
    when: (ctx) => (ctx.matchNumber ?? 0) >= 3,
    answers: [
      a('a1', 'They know exactly how big it is, and they are ready.', 'confident', { squad: 4, fans: 4, pressure: 3 }, 'The confidence is unmistakable.'),
      a('a2', 'We keep the week normal. Same boots, same pitch, same ball.', 'calm', { pressure: -4, media: 2 }, 'A grounded answer.'),
      a('a3', 'This is where leaders step forward.', 'public', { players: [{ name: '{star}', delta: 5 }], squad: 2, pressure: 2 }, 'The senior players have been challenged.'),
    ],
  },
  {
    id: 'squad-depth', tones: ['pre-match', 'post-win', 'post-draw'], reporter: 'The Athletic',
    text: 'A few injuries about. Is the squad deep enough to cope with the run-in?',
    answers: [
      a('a1', 'That is exactly why we have a squad. Trust the lads coming in.', 'calm', { squad: 5, board: 3 }, 'Reassuring — the fringe players hear that.'),
      a('a2', 'Depth can always be better. We work with what we have.', 'honest', { media: 4, board: 2 }, 'A candid nod to the board.'),
      a('a3', 'Injuries are an excuse for people who want them.', 'defiant', { squad: 3, media: -2, pressure: 2 }, 'No room for excuses there.'),
    ],
  },
  {
    id: 'youth-prospect', tones: ['pre-match', 'post-win', 'form', 'selection'], reporter: 'BBC Sport',
    text: 'There is excitement about a young player in the group. Will we see him given a chance?',
    answers: [
      a('a1', 'If he earns it in training, yes. The door is open.', 'honest', { squad: 3, media: 4 }, 'A meritocratic line the press like.'),
      a('a2', "He is one for the future — we will not rush him.", 'calm', { board: 3, squad: 2 }, 'Protective and patient.'),
      a('a3', "He is ready now. Age is just a number.", 'confident', { fans: 5, squad: 2, pressure: 3 }, 'A headline for the back pages.'),
    ],
  },
  {
    id: 'mind-games', tones: ['pre-match'], reporter: 'TalkSport',
    text: 'The {opponent} manager has been talking you up all week. Mind games, or genuine respect?',
    when: (ctx) => !!ctx.opponent,
    answers: [
      a('a1', 'I do not do mind games. I prepare a team to win.', 'calm', { media: 4, board: 3 }, 'A measured swat of the question.'),
      a('a2', 'Respect or not, we will see who is smiling at full time.', 'defiant', { fans: 5, pressure: 3 }, 'A spark for the build-up.'),
      a('a3', 'Let him talk. It says more about them than us.', 'deflect', { media: -1, squad: 2 }, 'Brushed aside coolly.'),
    ],
  },
];

const UNIVERSAL: QTemplate[] = [
  {
    id: 'fans', tones: ['pre-tournament', 'pre-match', 'post-win', 'post-loss', 'post-draw', 'selection', 'form', 'speculation', 'crisis'], reporter: 'Local Radio',
    text: 'A message for the travelling fans back home?',
    answers: [
      a('a1', "Get behind the lads — they'll run through walls for you.", 'confident', { fans: 8, squad: 3 }, 'The supporters will love that.'),
      a('a2', "Thank you. Your support means everything to us.", 'humble', { fans: 5, media: 2 }, 'Warm and genuine.'),
      a('a3', "Stay patient. We'll make them proud.", 'calm', { fans: 3, board: 2 }, 'Steady as you go.'),
    ],
  },
];

function fill(text: string, ctx: MetaContext): string {
  return text
    .replace(/\{team\}/g, ctx.teamName)
    .replace(/\{manager\}/g, ctx.managerName)
    .replace(/\{opponent\}/g, ctx.opponent ?? 'the opposition')
    .replace(/\{stage\}/g, ctx.stage ?? 'this stage')
    .replace(/\{star\}/g, ctx.star ?? 'your talisman')
    .replace(/\{outOfForm\}/g, ctx.outOfForm ?? ctx.star ?? 'the lad');
}

function fillAnswer(ans: PressAnswer, ctx: MetaContext, depth: number): PressAnswer {
  return {
    ...ans,
    text: fill(ans.text, ctx),
    effect: {
      ...ans.effect,
      players: ans.effect.players?.map((pl) => ({ name: fill(pl.name, ctx), delta: pl.delta })),
    },
    narrative: ans.narrative ? {
      ...ans.narrative,
      headline: ans.narrative.headline ? {
        ...ans.narrative.headline,
        title: fill(ans.narrative.headline.title, ctx),
        body: ans.narrative.headline.body ? fill(ans.narrative.headline.body, ctx) : undefined,
      } : undefined,
      message: ans.narrative.message ? {
        ...ans.narrative.message,
        text: fill(ans.narrative.message.text, ctx),
        replies: ans.narrative.message.replies?.map((reply) => ({
          ...reply,
          text: fill(reply.text, ctx),
          response: reply.response ? fill(reply.response, ctx) : undefined,
        })),
      } : undefined,
    } : undefined,
    followUp: depth > 0 && ans.followUp ? materializeQuestion(ans.followUp, ctx, depth - 1) : undefined,
  };
}

function materializeQuestion(q: PressQuestion, ctx: MetaContext, depth: number): PressQuestion {
  return {
    ...q,
    text: fill(q.text, ctx),
    answers: q.answers.map((ans) => fillAnswer(ans, ctx, depth)),
  };
}

function materialize(t: QTemplate, ctx: MetaContext): PressQuestion {
  return materializeQuestion(
    { id: t.id, reporter: t.reporter, reporterSeed: t.reporter, text: t.text, answers: t.answers },
    ctx,
    1, // allow one level of follow-up beneath a base question
  );
}

/** Build a 3-question conference appropriate to the context. `rng` lets tests
 * pin selection; defaults to Math.random for variety in play. */
export function buildPressConference(ctx: MetaContext, room: string, opts: { count?: number; rng?: () => number } = {}): PressConference {
  const rng = opts.rng ?? Math.random;
  const count = opts.count ?? 3;
  const relevant = POOL.filter((t) => t.tones.includes(ctx.tone) && (!t.when || t.when(ctx)));
  const shuffle = (arr: QTemplate[]): QTemplate[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  // Context-specific (gated) questions are the most topical — surface them first,
  // then vary the rest. Keeps hostile/crisis/fairytale situations on-topic.
  const pickFrom = [...shuffle(relevant.filter((t) => t.when)), ...shuffle(relevant.filter((t) => !t.when))];
  const chosen: QTemplate[] = pickFrom.slice(0, count);
  if (chosen.length < count) chosen.push(...UNIVERSAL);
  const questions = chosen.slice(0, count).map((t) => materialize(t, ctx));

  const toneLabel: Record<MetaContext['tone'], string> = {
    'pre-tournament': 'Pre-Tournament Press', 'pre-match': 'Pre-Match Press', 'post-win': 'Post-Match Press',
    'post-loss': 'Post-Match Press', 'post-draw': 'Post-Match Press', crisis: 'Crisis Press',
    selection: 'Team News', speculation: 'Press Conference', form: 'Press Conference',
  };
  return {
    title: `${ctx.teamName}${ctx.opponent ? ` vs ${ctx.opponent}` : ''}`,
    subtitle: `${toneLabel[ctx.tone]}${ctx.stage ? ` · ${ctx.stage}` : ''}`,
    room,
    speakerName: ctx.managerName,
    speakerSeed: ctx.managerName,
    questions,
  };
}

export interface PressOpts {
  onDone: (total: MoraleDelta, result?: PressResult) => void;
  reporterSeeds?: string[];
}

/** Mount the press-conference overlay. Returns an unmount function. */
export function mountPressConference(container: HTMLElement, conf: PressConference, opts: PressOpts): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'meta-overlay';
  container.appendChild(overlay);
  const total = emptyDelta();
  const selectedAnswers: PressAnswer[] = [];
  let qi = 0;

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const reporters = opts.reporterSeeds ?? ['Sky Sports', 'BBC Sport', 'The Athletic', 'TalkSport', 'ITV'];

  function pill() {
    return `<div class="press-meter">
      <div class="press-pill">FANS <b>${total.fans >= 0 ? '+' : ''}${total.fans}</b></div>
      <div class="press-pill">SQUAD <b>${total.squad >= 0 ? '+' : ''}${total.squad}</b></div>
      <div class="press-pill">PRESS <b>${total.media >= 0 ? '+' : ''}${total.media}</b></div>
    </div>`;
  }

  function render(reaction?: string) {
    const q = conf.questions[qi];
    const done = qi >= conf.questions.length;
    const reporterImgs = reporters.map((seed, i) => {
      const asking = !done && seed === conf.questions[qi].reporter;
      return `<img class="press-reporter ${asking ? 'asking' : ''}" style="order:${i}" src="${reporterAvatar(i)}" alt=""/>`;
    }).join('');
    const progress = conf.questions.map((_, i) => `<span class="${i < qi ? 'done' : ''}"></span>`).join('');

    const panel = done
      ? `<div class="press-progress">${progress}</div>
         <div class="press-reaction">That's all for today. ${total.fans + total.squad + total.media >= 0 ? 'You handled the room well.' : 'A tricky session — that one could rumble on.'}</div>
         <button class="press-done">LEAVE THE PODIUM</button>`
      : reaction
        ? `<div class="press-progress">${progress}</div><div class="press-reaction">${esc(reaction)}</div><button class="press-done">CONTINUE</button>`
        : `<div class="press-progress">${progress}</div>
           <div class="press-q">
             <img class="press-q-avatar" src="${reporterAvatar(Math.max(0, reporters.indexOf(q.reporter)))}" alt=""/>
             <div class="press-q-text"><span class="press-reporter-name">${esc(q.reporter)}</span>${esc(q.text)}</div>
           </div>
           <div class="press-answers">
             ${q.answers.map((ans) => `<button class="press-answer" data-aid="${ans.id}">${esc(ans.text)}<span class="press-tone">${ans.tone}</span></button>`).join('')}
           </div>`;

    overlay.innerHTML = `
      <div class="press-frame">
        <div class="press-stage" style="background-image:url('${conf.room}')">
          <div class="press-title"><div class="press-sub">${esc(conf.subtitle ?? '')}</div><h2>${esc(conf.title)}</h2></div>
          ${pill()}
          <div class="press-reporters">${reporterImgs}</div>
        </div>
        <div class="press-panel">${panel}</div>
      </div>`;

    if (done) {
      overlay.querySelector('.press-done')!.addEventListener('click', () => {
        overlay.remove();
        opts.onDone(total, { total, answers: selectedAnswers });
      });
      return;
    }
    if (reaction) {
      overlay.querySelector('.press-done')!.addEventListener('click', () => { qi++; render(); });
      return;
    }
    overlay.querySelectorAll('.press-answer').forEach((el) => {
      el.addEventListener('click', () => {
        const aid = (el as HTMLElement).dataset.aid!;
        const ans = q.answers.find((x) => x.id === aid)!;
        selectedAnswers.push(ans);
        addDelta(total, ans.effect);
        render(ans.reaction);
      });
    });
  }

  render();
  return () => overlay.remove();
}
