import { evaluateChallengeObjective, type ChallengeObjective, type ChallengeVerdict } from './challenges';
import type { FormationId, TeamData } from '../sim/types';

export type ChallengeChapterId =
  | 'wc-1930-riverplate-final'
  | 'wc-1934-rome-extra-time'
  | 'wc-1938-paris-final'
  | 'wc-1950-maracana-silence'
  | 'wc-1954-bern-comeback'
  | 'wc-1958-stockholm-breakout'
  | 'wc-1962-santiago-recovery'
  | 'wc-1966-wembley-extra-time'
  | 'wc-1970-azteca-semi'
  | 'wc-1974-munich-final'
  | 'wc-1978-buenos-aires-extra-time'
  | 'wc-1982-seville-shootout'
  | 'wc-1986-azteca-handball'
  | 'wc-1990-turin-semi'
  | 'wc-1994-rose-bowl-pens'
  | 'wc-1998-paris-final'
  | 'wc-2002-yokohama-final'
  | 'wc-2006-berlin-final'
  | 'wc-2010-soccer-city-final'
  | 'wc-2014-belo-horizonte-shock'
  | 'wc-2018-rostov-comeback'
  | 'wc-2022-lusail-final'
  | 'capstone-spain-cape-verde';

export interface ChallengeTeamSide {
  baseTeamId: string;
  fictionalName: string;
  short: string;
  formation: FormationId;
  namePool: string[];
}

export interface ChallengeChapter {
  id: ChallengeChapterId;
  year: number;
  title: string;
  sourceMatch: string;
  sourceTeams: [string, string];
  home: ChallengeTeamSide;
  away: ChallengeTeamSide;
  playerTeam: 0 | 1;
  startScore: [number, number];
  startTimeSec: number;
  startHalf: 1 | 2 | 3 | 4;
  difficulty: 0 | 1 | 2 | 3;
  objective: ChallengeObjective;
  objectiveText: string;
  storySetup: string;
  resultSuccess: string;
  resultFailure: string;
  backdropKey: string;
}

export interface ChallengeProgress {
  currentIndex: number;
  completedIds: ChallengeChapterId[];
  finalMargin: number | null;
  chapterScores: ChallengeChapterScoreMap;
  runActive: boolean;
}

export interface ChallengeApplyResult {
  chapter: ChallengeChapter;
  verdict: ChallengeVerdict;
  progress: ChallengeProgress;
  leaderboardPoints: number;
  scoreBreakdown: ChallengeScoreBreakdown;
  scoreImproved: boolean;
}

export interface ChallengeLeaderboardRow {
  playerLabel: string;
  points: number;
}

export interface ChallengeChapterScore {
  bestPoints: number;
}

export type ChallengeChapterScoreMap = Partial<Record<ChallengeChapterId, ChallengeChapterScore>>;

export interface ChallengeScoreBreakdownItem {
  label: string;
  points: number;
}

export interface ChallengeScoreBreakdown {
  items: ChallengeScoreBreakdownItem[];
  total: number;
  goalsScored: number;
  goalsConceded: number;
}

export const CHALLENGE_SCORING = {
  clear: 1000,
  goalScored: 150,
  cleanSegment: 500,
  oneConceded: 250,
  twoConceded: 100,
  firstClear: 750,
  finalMarginGoal: 100,
} as const;

const SECOND_HALF = 2;
const EXTRA_TIME_FIRST = 3;
const EXTRA_TIME_SECOND = 4;

function min(matchMinute: number): number {
  const minuteInHalf = matchMinute <= 45 ? matchMinute : matchMinute - 45;
  return Math.max(0, Math.min(45, minuteInHalf)) / 45 * 120;
}

function etMin(extraMinute: number): number {
  return Math.max(0, Math.min(15, extraMinute)) / 15 * 120;
}

function side(
  baseTeamId: string,
  fictionalName: string,
  short: string,
  formation: FormationId,
  namePool: string[],
): ChallengeTeamSide {
  return { baseTeamId, fictionalName, short, formation, namePool };
}

export const CHALLENGE_CHRONICLE: ChallengeChapter[] = [
  {
    id: 'wc-1930-riverplate-final',
    year: 1930,
    title: 'The First Final',
    sourceMatch: 'Uruguay v Argentina, 1930 final',
    sourceTeams: ['Uruguay', 'Argentina'],
    home: side('uruguay', 'Harbor Blues', 'HBL', '2-3-5', ['Silva', 'Rivas', 'Duarte', 'Pereyra', 'Costa', 'Lamas']),
    away: side('argentina', 'River Whites', 'RWH', '2-3-5', ['Varela', 'Sosa', 'Acuna', 'Ferreyra', 'Molina', 'Luna']),
    playerTeam: 0,
    startScore: [2, 2],
    startTimeSec: min(55),
    startHalf: SECOND_HALF,
    difficulty: 1,
    objective: { kind: 'win' },
    objectiveText: 'Win the first final from 2-2.',
    storySetup: 'A packed river city is split in two. The first world crown is there for whoever stops trembling first.',
    resultSuccess: 'The first name on the old trophy is yours.',
    resultFailure: 'The noise wins. The first final slips away.',
    backdropKey: 'challenge_1930_montevideo_final',
  },
  {
    id: 'wc-1934-rome-extra-time',
    year: 1934,
    title: 'Rome Refuses Silence',
    sourceMatch: 'Italy v Czechoslovakia, 1934 final',
    sourceTeams: ['Italy', 'Czechoslovakia'],
    home: side('italy', 'Imperial Reds', 'IRD', 'w-m', ['Berti', 'Ferraro', 'Conti', 'Rossi', 'Marini', 'Lombardi']),
    away: side('czechia', 'Bohemian Lions', 'BOL', 'w-m', ['Novak', 'Svoboda', 'Dvorak', 'Vesely', 'Kral', 'Hora']),
    playerTeam: 0,
    startScore: [0, 1],
    startTimeSec: min(70),
    startHalf: SECOND_HALF,
    difficulty: 2,
    objective: { kind: 'win' },
    objectiveText: 'Come from behind and win.',
    storySetup: 'The host nation is behind, the clock is cruel, and every clearance sounds like a verdict.',
    resultSuccess: 'The late surge rewrites the evening.',
    resultFailure: 'The final stays frozen at the worst possible score.',
    backdropKey: 'challenge_1934_rome_final',
  },
  {
    id: 'wc-1938-paris-final',
    year: 1938,
    title: 'Paris With No Shelter',
    sourceMatch: 'Italy v Hungary, 1938 final',
    sourceTeams: ['Italy', 'Hungary'],
    home: side('italy', 'Azzurri City', 'AZC', 'w-m', ['Ricci', 'Gallo', 'Fontana', 'Bellini', 'Serra', 'Greco']),
    away: side('hungary', 'Danube Magyars', 'DMG', 'w-m', ['Nagy', 'Kovacs', 'Toth', 'Farkas', 'Szabo', 'Barta']),
    playerTeam: 0,
    startScore: [2, 1],
    startTimeSec: min(30),
    startHalf: 1,
    difficulty: 1,
    objective: { kind: 'winByMargin', margin: 2 },
    objectiveText: 'Hold the lead and win by at least two.',
    storySetup: 'The lead has arrived too early. Now the final becomes a long argument with panic.',
    resultSuccess: 'You turn the early strike into control.',
    resultFailure: 'The final never feels secure enough.',
    backdropKey: 'challenge_1938_paris_final',
  },
  {
    id: 'wc-1950-maracana-silence',
    year: 1950,
    title: 'The Stadium Goes Quiet',
    sourceMatch: 'Uruguay v Brazil, 1950 decisive final-group match',
    sourceTeams: ['Uruguay', 'Brazil'],
    home: side('brazil', 'Rio Gold', 'RIO', 'w-m', ['Santos', 'Almeida', 'Barros', 'Nogueira', 'Pinto', 'Rocha']),
    away: side('uruguay', 'Montevideo Sky', 'MTS', 'w-m', ['Ibarra', 'Paz', 'Medina', 'Vega', 'Rojas', 'Ortega']),
    playerTeam: 1,
    startScore: [1, 0],
    startTimeSec: min(50),
    startHalf: SECOND_HALF,
    difficulty: 2,
    objective: { kind: 'win' },
    objectiveText: 'As the underdog, turn 0-1 into a win.',
    storySetup: 'The giant stadium believes the trophy is already home. Your only weapon is the part of the ground that has gone too confident.',
    resultSuccess: 'The silence arrives like thunder.',
    resultFailure: 'The favourite gets the draw it needed.',
    backdropKey: 'challenge_1950_maracana',
  },
  {
    id: 'wc-1954-bern-comeback',
    year: 1954,
    title: 'Rain In Bern',
    sourceMatch: 'West Germany v Hungary, 1954 final',
    sourceTeams: ['West Germany', 'Hungary'],
    home: side('germany', 'Rhine Eagles', 'RHE', 'w-m', ['Keller', 'Brandt', 'Weiss', 'Kruger', 'Vogel', 'Hartmann']),
    away: side('hungary', 'Danube Comets', 'DCO', '4-2-4', ['Biro', 'Molnar', 'Balogh', 'Kiss', 'Halasz', 'Pinter']),
    playerTeam: 0,
    startScore: [0, 2],
    startTimeSec: min(8),
    startHalf: 1,
    difficulty: 2,
    objective: { kind: 'win' },
    objectiveText: 'Complete the comeback from 0-2.',
    storySetup: 'Two down before boots have settled. The rain makes heroes or excuses.',
    resultSuccess: 'The miracle belongs to the side that kept running.',
    resultFailure: 'The favourite never lets the wound close.',
    backdropKey: 'challenge_1954_bern',
  },
  {
    id: 'wc-1958-stockholm-breakout',
    year: 1958,
    title: 'Stockholm Learns A New Rhythm',
    sourceMatch: 'Brazil v Sweden, 1958 final',
    sourceTeams: ['Brazil', 'Sweden'],
    home: side('brazil', 'Samba Gold', 'SBG', '4-2-4', ['Moreira', 'Lima', 'Teixeira', 'Campos', 'Nunes', 'Vieira']),
    away: side('sweden', 'Nordic Blues', 'NBL', 'w-m', ['Lind', 'Berg', 'Soder', 'Nyholm', 'Ekstrom', 'Dahl']),
    playerTeam: 0,
    startScore: [1, 1],
    startTimeSec: min(30),
    startHalf: 1,
    difficulty: 1,
    objective: { kind: 'winByMargin', margin: 2 },
    objectiveText: 'Win by at least two.',
    storySetup: 'The hosts have answered the first blow. The young attackers must make the world look older than them.',
    resultSuccess: 'The final opens into colour.',
    resultFailure: 'The occasion stays heavier than the talent.',
    backdropKey: 'challenge_1958_stockholm',
  },
  {
    id: 'wc-1962-santiago-recovery',
    year: 1962,
    title: 'Santiago Answers Back',
    sourceMatch: 'Brazil v Czechoslovakia, 1962 final',
    sourceTeams: ['Brazil', 'Czechoslovakia'],
    home: side('brazil', 'Canary Gold', 'CNG', '4-3-3', ['Moura', 'Tavares', 'Rangel', 'Freitas', 'Coelho', 'Brito']),
    away: side('czechia', 'Prague Steel', 'PRS', '4-5-1', ['Cerny', 'Urban', 'Kadlec', 'Marek', 'Janda', 'Pokorny']),
    playerTeam: 0,
    startScore: [0, 1],
    startTimeSec: min(15),
    startHalf: 1,
    difficulty: 2,
    objective: { kind: 'win' },
    objectiveText: 'Recover from the early shock and win.',
    storySetup: 'The holders are behind. The crowd smells doubt, and doubt travels faster than the ball.',
    resultSuccess: 'The early blow becomes a footnote.',
    resultFailure: 'The champions never fully stand back up.',
    backdropKey: 'challenge_1962_santiago',
  },
  {
    id: 'wc-1966-wembley-extra-time',
    year: 1966,
    title: 'The Line No One Forgets',
    sourceMatch: 'England v West Germany, 1966 final',
    sourceTeams: ['England', 'West Germany'],
    home: side('england', 'Albion Reds', 'ALB', '4-4-2', ['Hawthorne', 'Blythe', 'Mercer', 'Dawson', 'Wade', 'Carter']),
    away: side('germany', 'Rhine Whites', 'RHW', '4-2-4', ['Adler', 'Bauer', 'Kern', 'Schulte', 'Fischer', 'Wendt']),
    playerTeam: 0,
    startScore: [2, 2],
    startTimeSec: 0,
    startHalf: EXTRA_TIME_FIRST,
    difficulty: 2,
    objective: { kind: 'win' },
    objectiveText: 'Win it in extra time.',
    storySetup: 'The late equaliser has hollowed the stadium out. Extra time begins with history refusing to pick a side.',
    resultSuccess: 'The argument ends with the cup in your hands.',
    resultFailure: 'Extra time finds another ending.',
    backdropKey: 'challenge_1966_wembley',
  },
  {
    id: 'wc-1970-azteca-semi',
    year: 1970,
    title: 'Azteca Will Not Blink',
    sourceMatch: 'Italy v West Germany, 1970 semi-final',
    sourceTeams: ['Italy', 'West Germany'],
    home: side('italy', 'Roman Blues', 'RBL', '4-4-2', ['De Luca', 'Vitale', 'Ferri', 'Costa', 'Amato', 'Leone']),
    away: side('germany', 'Teutonic Whites', 'TEW', '4-3-3', ['Schwarz', 'Hoffman', 'Kraus', 'Mayer', 'Wolf', 'Becker']),
    playerTeam: 0,
    startScore: [1, 1],
    startTimeSec: 0,
    startHalf: EXTRA_TIME_FIRST,
    difficulty: 3,
    objective: { kind: 'win' },
    objectiveText: 'Survive the extra-time storm and win.',
    storySetup: 'The heat has emptied both lungs. Five minutes of bravery now cost fifteen.',
    resultSuccess: 'You outlast the game that would not stop.',
    resultFailure: 'Azteca keeps demanding more than you have left.',
    backdropKey: 'challenge_1970_azteca',
  },
  {
    id: 'wc-1974-munich-final',
    year: 1974,
    title: 'The First Minute Is A Trap',
    sourceMatch: 'West Germany v Netherlands, 1974 final',
    sourceTeams: ['West Germany', 'Netherlands'],
    home: side('germany', 'Munich Eagles', 'MUE', '4-4-2', ['Dietz', 'Kohler', 'Braun', 'Seidel', 'Franke', 'Busch']),
    away: side('netherlands', 'Orange Cyclones', 'ORC', '4-3-3', ['Van Dalen', 'De Vries', 'Koster', 'Smit', 'Jansen', 'Bos']),
    playerTeam: 0,
    startScore: [0, 1],
    startTimeSec: min(2),
    startHalf: 1,
    difficulty: 2,
    objective: { kind: 'win' },
    objectiveText: 'Recover from the early penalty and win.',
    storySetup: 'The ball has barely moved and the scoreboard already mocks the host. Panic is the opponent now.',
    resultSuccess: 'You turn the perfect opening against them.',
    resultFailure: 'The early wound decides too much.',
    backdropKey: 'challenge_1974_munich',
  },
  {
    id: 'wc-1978-buenos-aires-extra-time',
    year: 1978,
    title: 'The Bar Still Shakes',
    sourceMatch: 'Argentina v Netherlands, 1978 final',
    sourceTeams: ['Argentina', 'Netherlands'],
    home: side('argentina', 'Buenos Aires Stripes', 'BAS', '4-3-3', ['Carrizo', 'Mendoza', 'Arias', 'Quiroga', 'Valdez', 'Serrano']),
    away: side('netherlands', 'Lowland Oranje', 'LOR', '4-3-3', ['Van Eijk', 'Dekker', 'Vos', 'Meijer', 'Kuiper', 'Blom']),
    playerTeam: 0,
    startScore: [1, 1],
    startTimeSec: 0,
    startHalf: EXTRA_TIME_FIRST,
    difficulty: 2,
    objective: { kind: 'winByMargin', margin: 2 },
    objectiveText: 'Win by two in extra time.',
    storySetup: 'A post saved the night. Extra time asks whether that was luck or warning.',
    resultSuccess: 'The final breaks open when legs should fail.',
    resultFailure: 'The reprieve never becomes punishment.',
    backdropKey: 'challenge_1978_buenos_aires',
  },
  {
    id: 'wc-1982-seville-shootout',
    year: 1982,
    title: 'Seville After Dark',
    sourceMatch: 'West Germany v France, 1982 semi-final',
    sourceTeams: ['West Germany', 'France'],
    home: side('germany', 'Federal Whites', 'FDW', '4-2-2-2', ['Reuter', 'Zimmer', 'Lang', 'Schroder', 'Heinz', 'Voigt']),
    away: side('france', 'Gallic Blues', 'GLB', '4-2-2-2', ['Martin', 'Laurent', 'Moreau', 'Girard', 'Renard', 'Blanc']),
    playerTeam: 1,
    startScore: [3, 3],
    startTimeSec: etMin(14),
    startHalf: EXTRA_TIME_SECOND,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'Reach penalties or find a winner.',
    storySetup: 'The match has already gone beyond reason. One more minute decides whether nerve survives the night.',
    resultSuccess: 'You refuse to lose the wildest game in memory.',
    resultFailure: 'After everything, the last wound is yours.',
    backdropKey: 'challenge_1982_seville',
  },
  {
    id: 'wc-1986-azteca-handball',
    year: 1986,
    title: 'The Goal Everyone Saw',
    sourceMatch: 'Argentina v England, 1986 quarter-final',
    sourceTeams: ['Argentina', 'England'],
    home: side('argentina', 'Pampas Sky', 'PMS', '3-5-2', ['Palacios', 'Romero', 'Benitez', 'Suarez', 'Navarro', 'Cruz']),
    away: side('england', 'Albion Whites', 'ALW', '4-4-2', ['Stone', 'Hughes', 'Foster', 'Reed', 'Barlow', 'Mason']),
    playerTeam: 1,
    startScore: [1, 0],
    startTimeSec: min(52),
    startHalf: SECOND_HALF,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'After the handball goal, do not lose.',
    storySetup: 'A hand has changed the match and no whistle is coming. Rage will help for ten seconds; then you need football.',
    resultSuccess: 'You turn fury into control.',
    resultFailure: 'The injustice becomes the story because the comeback never arrives.',
    backdropKey: 'challenge_1986_azteca',
  },
  {
    id: 'wc-1990-turin-semi',
    year: 1990,
    title: 'Twelve Yards In Turin',
    sourceMatch: 'West Germany v England, 1990 semi-final',
    sourceTeams: ['West Germany', 'England'],
    home: side('germany', 'Unified Eagles', 'UNE', '3-5-2', ['Bruckner', 'Sommer', 'Klein', 'Werner', 'Grimm', 'Haas']),
    away: side('england', 'Three Lions Club', 'TLC', '4-4-2', ['Archer', 'Keane', 'Lowe', 'Turner', 'Gibbs', 'Walsh']),
    playerTeam: 1,
    startScore: [1, 1],
    startTimeSec: etMin(10),
    startHalf: EXTRA_TIME_SECOND,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'Survive to penalties or win it late.',
    storySetup: 'Every pass is tired. Every mistake has a country attached to it.',
    resultSuccess: 'You carry the night to the spot.',
    resultFailure: 'The semi-final closes its fist.',
    backdropKey: 'challenge_1990_turin',
  },
  {
    id: 'wc-1994-rose-bowl-pens',
    year: 1994,
    title: 'Rose Bowl Nerve',
    sourceMatch: 'Brazil v Italy, 1994 final',
    sourceTeams: ['Brazil', 'Italy'],
    home: side('brazil', 'Canary Gold', 'CNG', '4-4-2', ['Azevedo', 'Matos', 'Carvalho', 'Dantas', 'Lopes', 'Ribeiro']),
    away: side('italy', 'Roman Azure', 'RAZ', '4-4-2', ['Mancini', 'Esposito', 'Rinaldi', 'Caruso', 'Marchetti', 'Moretti']),
    playerTeam: 0,
    startScore: [0, 0],
    startTimeSec: etMin(14),
    startHalf: EXTRA_TIME_SECOND,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'Reach penalties or steal the final.',
    storySetup: 'No one can score. The game has become a slow walk toward the spot.',
    resultSuccess: 'Your nerve survives the blankest final.',
    resultFailure: 'The wait beats you before the penalties arrive.',
    backdropKey: 'challenge_1994_rose_bowl',
  },
  {
    id: 'wc-1998-paris-final',
    year: 1998,
    title: 'Paris At Full Voice',
    sourceMatch: 'France v Brazil, 1998 final',
    sourceTeams: ['France', 'Brazil'],
    home: side('france', 'Tricolor Blues', 'TRB', '4-3-2-1', ['Bernard', 'Faure', 'Garnier', 'Leroux', 'Marchand', 'Perrin']),
    away: side('brazil', 'Rio Gold', 'RIO', '4-2-2-2', ['Pacheco', 'Farias', 'Mendes', 'Queiroz', 'Batista', 'Leal']),
    playerTeam: 0,
    startScore: [1, 0],
    startTimeSec: min(27),
    startHalf: 1,
    difficulty: 2,
    objective: { kind: 'cleanSheetWin' },
    objectiveText: 'Win without conceding.',
    storySetup: 'The hosts have struck first. Now the favourites begin circling the box.',
    resultSuccess: 'The clean sheet makes the upset feel inevitable.',
    resultFailure: 'The lead is not enough without control.',
    backdropKey: 'challenge_1998_paris',
  },
  {
    id: 'wc-2002-yokohama-final',
    year: 2002,
    title: 'Yokohama Redemption',
    sourceMatch: 'Brazil v Germany, 2002 final',
    sourceTeams: ['Brazil', 'Germany'],
    home: side('brazil', 'Canary Crown', 'CCR', '3-4-1-2', ['Nascimento', 'Rezende', 'Assis', 'Braga', 'Sales', 'Moraes']),
    away: side('germany', 'Berlin Whites', 'BEW', '4-5-1', ['Lehner', 'Graf', 'Baumann', 'Heller', 'Jung', 'Ott']),
    playerTeam: 0,
    startScore: [0, 0],
    startTimeSec: min(65),
    startHalf: SECOND_HALF,
    difficulty: 2,
    objective: { kind: 'winByMargin', margin: 2 },
    objectiveText: 'Score twice and win by two.',
    storySetup: 'The final is locked. One mistake from the keeper, one predator awake, and history can turn.',
    resultSuccess: 'The redemption arc gets its finish.',
    resultFailure: 'The wall holds too long.',
    backdropKey: 'challenge_2002_yokohama',
  },
  {
    id: 'wc-2006-berlin-final',
    year: 2006,
    title: 'Berlin Keeps Count',
    sourceMatch: 'Italy v France, 2006 final',
    sourceTeams: ['Italy', 'France'],
    home: side('italy', 'Azzurri Shield', 'AZS', '4-3-2-1', ['Longo', 'De Santis', 'Pellegrini', 'Fiore', 'Sanna', 'Martini']),
    away: side('france', 'Gallic Blues', 'GLB', '4-2-3-1', ['Rousseau', 'Chevalier', 'Mercier', 'Dupont', 'Fontaine', 'Gillet']),
    playerTeam: 0,
    startScore: [1, 1],
    startTimeSec: etMin(5),
    startHalf: EXTRA_TIME_SECOND,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'Hold your nerve to penalties or win it.',
    storySetup: 'The final has turned brittle. Discipline matters as much as the next pass.',
    resultSuccess: 'You keep the head when the night tries to take it.',
    resultFailure: 'The final becomes too jagged to hold.',
    backdropKey: 'challenge_2006_berlin',
  },
  {
    id: 'wc-2010-soccer-city-final',
    year: 2010,
    title: 'One Pass Before Midnight',
    sourceMatch: 'Spain v Netherlands, 2010 final',
    sourceTeams: ['Spain', 'Netherlands'],
    home: side('spain', 'Iberia Reds', 'IBR', '4-3-3', ['Soler', 'Vidal', 'Mora', 'Castillo', 'Ramosa', 'Herrera']),
    away: side('netherlands', 'Orange Press', 'ORP', '4-2-3-1', ['De Jongh', 'Verbeek', 'Mulder', 'Hoek', 'Willems', 'Prins']),
    playerTeam: 0,
    startScore: [0, 0],
    startTimeSec: etMin(0),
    startHalf: EXTRA_TIME_SECOND,
    difficulty: 3,
    objective: { kind: 'win' },
    objectiveText: 'Find the winner before penalties.',
    storySetup: 'The final has been fouls, nerves and missed chances. One clean passing lane would feel like a revolution.',
    resultSuccess: 'The pass arrives, and so does the cup.',
    resultFailure: 'The final drifts where nerve can betray technique.',
    backdropKey: 'challenge_2010_soccer_city',
  },
  {
    id: 'wc-2014-belo-horizonte-shock',
    year: 2014,
    title: 'Seven Minutes Of Falling',
    sourceMatch: 'Brazil v Germany, 2014 semi-final',
    sourceTeams: ['Brazil', 'Germany'],
    home: side('brazil', 'Canary Hosts', 'CNH', '4-2-3-1', ['Teles', 'Gomes', 'Barreto', 'Frota', 'Diniz', 'Macedo']),
    away: side('germany', 'National Whites', 'NTW', '4-2-3-1', ['Kappel', 'Neumann', 'Bender', 'Lorenz', 'Stark', 'Ebert']),
    playerTeam: 1,
    startScore: [0, 1],
    startTimeSec: min(20),
    startHalf: 1,
    difficulty: 2,
    objective: { kind: 'winByMargin', margin: 3 },
    objectiveText: 'Exploit the collapse and win by three.',
    storySetup: 'The hosts have cracked once. If you hesitate, the stadium remembers how to breathe.',
    resultSuccess: 'The shock becomes an avalanche.',
    resultFailure: 'The moment closes before it becomes legend.',
    backdropKey: 'challenge_2014_belo_horizonte',
  },
  {
    id: 'wc-2018-rostov-comeback',
    year: 2018,
    title: 'The Counterpunch',
    sourceMatch: 'Belgium v Japan, 2018 round of 16',
    sourceTeams: ['Belgium', 'Japan'],
    home: side('belgium', 'Lowland Reds', 'LWR', '3-4-3', ['Verhaeghe', 'Maes', 'Peeters', 'Claes', 'Wouters', 'Jacobs']),
    away: side('japan', 'Rising Blues', 'RSB', '4-2-3-1', ['Tanaka', 'Sato', 'Kobayashi', 'Mori', 'Ito', 'Nakamura']),
    playerTeam: 0,
    startScore: [0, 2],
    startTimeSec: min(52),
    startHalf: SECOND_HALF,
    difficulty: 3,
    objective: { kind: 'win' },
    objectiveText: 'Come back from 0-2 and win.',
    storySetup: 'The favourites are two down and running out of excuses. The only way out is through risk.',
    resultSuccess: 'The last counter lands like a bell.',
    resultFailure: 'The brave start from the underdog holds.',
    backdropKey: 'challenge_2018_rostov',
  },
  {
    id: 'wc-2022-lusail-final',
    year: 2022,
    title: 'Lusail Loses Its Shape',
    sourceMatch: 'Argentina v France, 2022 final',
    sourceTeams: ['Argentina', 'France'],
    home: side('argentina', 'Pampas Sky', 'PMS', '4-3-3', ['Alvarez', 'Medrano', 'Correa', 'Funes', 'Escobar', 'Godoy']),
    away: side('france', 'Hexagon Blues', 'HXB', '4-2-3-1', ['Lacroix', 'Besson', 'Noel', 'Perrot', 'Delmas', 'Aubert']),
    playerTeam: 0,
    startScore: [2, 0],
    startTimeSec: min(75),
    startHalf: SECOND_HALF,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'Survive the comeback and do not lose.',
    storySetup: 'Two goals should have ended the final. Instead, the air changes and every second feels borrowed.',
    resultSuccess: 'You survive the wildest final swing.',
    resultFailure: 'The lead melts all the way down.',
    backdropKey: 'challenge_2022_lusail',
  },
  {
    id: 'capstone-spain-cape-verde',
    year: 2026,
    title: 'The Atlantic Line',
    sourceMatch: 'Spain v Cape Verde, fictional International Cup capstone',
    sourceTeams: ['Spain', 'Cape Verde'],
    home: side('spain', 'Iberia Reds', 'IBR', '4-2-3-1', ['Santos', 'Del Rio', 'Marin', 'Fuentes', 'Cortes', 'Vega']),
    away: side('cape-verde', 'Atlantic Sharks', 'ATS', '4-3-3', ['Andrade', 'Tavares', 'Monteiro', 'Pina', 'Lopes', 'Varela']),
    playerTeam: 1,
    startScore: [1, 1],
    startTimeSec: min(70),
    startHalf: SECOND_HALF,
    difficulty: 3,
    objective: { kind: 'drawOrWin' },
    objectiveText: 'As Cape Verde, win or draw against Spain.',
    storySetup: 'The final fax is blunt: Spain only need one mistake. Cape Verde need one more brave passage of play.',
    resultSuccess: 'Cape Verde reaches the line and the leaderboard remembers the margin.',
    resultFailure: 'The final step is still waiting.',
    backdropKey: 'challenge_2026_spain_cape_verde',
  },
];

export function isChallengeTrophyMatch(chapter: Pick<ChallengeChapter, 'id' | 'sourceMatch'>): boolean {
  if (chapter.id === 'capstone-spain-cape-verde' || chapter.id === 'wc-1950-maracana-silence') return false;
  const source = chapter.sourceMatch.toLowerCase();
  return source.includes('final')
    && !source.includes('semi-final')
    && !source.includes('quarter-final');
}

export function isChallengeCelebrationMatch(chapter: Pick<ChallengeChapter, 'id'>): boolean {
  return chapter.id === 'wc-1950-maracana-silence' || chapter.id === 'capstone-spain-cape-verde';
}

export function defaultChallengeProgress(): ChallengeProgress {
  return { currentIndex: 0, completedIds: [], finalMargin: null, chapterScores: {}, runActive: false };
}

export function currentChallengeChapter(progress: ChallengeProgress): ChallengeChapter {
  return CHALLENGE_CHRONICLE[Math.max(0, Math.min(progress.currentIndex, CHALLENGE_CHRONICLE.length - 1))];
}

export function applyChallengeResult(
  progress: ChallengeProgress,
  chapterId: ChallengeChapterId,
  score: [number, number],
): ChallengeApplyResult {
  const chapter = CHALLENGE_CHRONICLE.find((entry) => entry.id === chapterId);
  if (!chapter) throw new Error(`Unknown challenge chapter: ${chapterId}`);

  const playerGoals = score[chapter.playerTeam];
  const opponentGoals = score[1 - chapter.playerTeam];
  const verdict = evaluateChallengeObjective(chapter.objective, playerGoals, opponentGoals);
  const completedIds = progress.completedIds.slice();
  const wasCompleted = completedIds.includes(chapter.id);
  const chapterScores: ChallengeChapterScoreMap = { ...(progress.chapterScores ?? {}) };
  let currentIndex = progress.currentIndex;
  let finalMargin = progress.finalMargin;
  const finalChapter = chapter.id === CHALLENGE_CHRONICLE.at(-1)?.id;
  const runActive = Boolean(progress.runActive && verdict.success && !finalChapter);
  let scoreImproved = false;
  const scoreBreakdown = verdict.success
    ? challengeScoreBreakdown(chapter, score, !wasCompleted)
    : emptyChallengeScoreBreakdown(chapter, score);

  if (verdict.success && chapter.id === 'capstone-spain-cape-verde') {
    finalMargin = Math.max(finalMargin ?? 0, playerGoals - opponentGoals, 0);
  }

  if (verdict.success) {
    const previousBest = chapterScores[chapter.id]?.bestPoints ?? (wasCompleted ? CHALLENGE_SCORING.clear : 0);
    const nextBest = Math.max(previousBest, scoreBreakdown.total);
    scoreImproved = nextBest > previousBest;
    chapterScores[chapter.id] = { bestPoints: nextBest };
  }

  if (verdict.success && !wasCompleted) {
    completedIds.push(chapter.id);
    const nextIndex = CHALLENGE_CHRONICLE.findIndex((entry) => entry.id === chapter.id) + 1;
    currentIndex = Math.max(currentIndex, Math.min(nextIndex, CHALLENGE_CHRONICLE.length - 1));
  }

  const nextProgress = { currentIndex, completedIds, finalMargin, chapterScores, runActive };
  return {
    chapter,
    verdict,
    progress: nextProgress,
    leaderboardPoints: challengeLeaderboardPoints(completedIds.length, CHALLENGE_CHRONICLE.length, finalMargin, chapterScores),
    scoreBreakdown,
    scoreImproved,
  };
}

export function challengeLeaderboardPoints(
  completedCount: number,
  totalChapters: number,
  finalMargin: number | null,
  chapterScores?: ChallengeChapterScoreMap,
): number {
  const safeCompleted = Math.max(0, Math.min(totalChapters, Math.floor(completedCount)));
  const scoreTotal = chapterScores
    ? Object.values(chapterScores).reduce((total, entry) => total + Math.max(0, Math.floor(entry?.bestPoints ?? 0)), 0)
    : safeCompleted * CHALLENGE_SCORING.clear;
  const safeMargin = safeCompleted >= totalChapters
    ? Math.max(0, Math.min(99, Math.floor(finalMargin ?? 0))) * CHALLENGE_SCORING.finalMarginGoal
    : 0;
  return scoreTotal + safeMargin;
}

export function challengeScoreBreakdown(
  chapter: ChallengeChapter,
  score: [number, number],
  firstClear: boolean,
): ChallengeScoreBreakdown {
  const playerGoals = Math.max(0, score[chapter.playerTeam] - chapter.startScore[chapter.playerTeam]);
  const opponentGoals = Math.max(0, score[1 - chapter.playerTeam] - chapter.startScore[1 - chapter.playerTeam]);
  const goalPoints = playerGoals * CHALLENGE_SCORING.goalScored;
  const defencePoints = challengeDefencePoints(opponentGoals);
  const items: ChallengeScoreBreakdownItem[] = [
    { label: 'CLEAR', points: CHALLENGE_SCORING.clear },
  ];
  if (goalPoints > 0) items.push({ label: 'GOALS', points: goalPoints });
  if (defencePoints > 0) items.push({ label: 'DEFENCE', points: defencePoints });
  if (firstClear) items.push({ label: 'FIRST CLEAR', points: CHALLENGE_SCORING.firstClear });
  return {
    items,
    total: items.reduce((sum, item) => sum + item.points, 0),
    goalsScored: playerGoals,
    goalsConceded: opponentGoals,
  };
}

export function challengeScoreRules(): ChallengeScoreBreakdownItem[] {
  return [
    { label: 'CLEAR', points: CHALLENGE_SCORING.clear },
    { label: 'GOAL', points: CHALLENGE_SCORING.goalScored },
    { label: 'NO CONCEDE', points: CHALLENGE_SCORING.cleanSegment },
    { label: 'FIRST CLEAR', points: CHALLENGE_SCORING.firstClear },
  ];
}

export function formatChallengeScoreItems(items: ChallengeScoreBreakdownItem[]): string {
  return items.map((item) => `${item.label} +${item.points.toLocaleString()}`).join(' / ');
}

function challengeDefencePoints(goalsConceded: number): number {
  if (goalsConceded <= 0) return CHALLENGE_SCORING.cleanSegment;
  if (goalsConceded === 1) return CHALLENGE_SCORING.oneConceded;
  if (goalsConceded === 2) return CHALLENGE_SCORING.twoConceded;
  return 0;
}

function emptyChallengeScoreBreakdown(chapter: ChallengeChapter, score: [number, number]): ChallengeScoreBreakdown {
  return {
    items: [],
    total: 0,
    goalsScored: Math.max(0, score[chapter.playerTeam] - chapter.startScore[chapter.playerTeam]),
    goalsConceded: Math.max(0, score[1 - chapter.playerTeam] - chapter.startScore[1 - chapter.playerTeam]),
  };
}

export function challengeResultCopy(success: boolean, finalChapter: boolean): { headline: string; continueLabel: string } {
  if (!success) return { headline: 'TRY AGAIN?', continueLabel: 'ONE MORE MATCH' };
  if (finalChapter) return { headline: 'RUN COMPLETE', continueLabel: 'CHASE HIGH SCORE' };
  return { headline: 'YEAR CLEARED', continueLabel: 'NEXT YEAR' };
}

export function sortChallengeLeaderboardRows<T extends ChallengeLeaderboardRow>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const byPoints = b.points - a.points;
    if (byPoints !== 0) return byPoints;
    return a.playerLabel.localeCompare(b.playerLabel);
  });
}

export function buildChallengeTeamData(base: TeamData, side: ChallengeTeamSide): TeamData {
  const suffix = side.short.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    ...base,
    id: `${side.baseTeamId}-challenge-${suffix}`,
    name: base.name,
    short: base.short,
    players: base.players.map((player, index) => ({
      ...player,
      name: `${side.namePool[index % side.namePool.length]} ${index + 1}`,
    })),
  };
}
