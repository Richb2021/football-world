import englandJson from '../data/teams/england.json';
import germanyJson from '../data/teams/germany.json';
import brazilJson from '../data/teams/brazil.json';
import capeVerdeJson from '../data/teams/cape-verde.json';
import curacaoJson from '../data/teams/curacao.json';
import usaJson from '../data/teams/usa.json';
import haitiJson from '../data/teams/haiti.json';
import canadaJson from '../data/teams/canada.json';
import { pickKits } from '../engine/kitTint';
import { eraRulesForYear } from '../game/eraRules';
import { autoLineup, normalizeTactics } from '../sim/formations';
import { applyConsequences } from './state';
import type {
  ControllerKind,
  FormationId,
  KitColors,
  MatchConfig,
  MatchCrowdDensity,
  MatchTeamConfig,
  MatchVenueProfile,
  PlayerAttrs,
  Pos,
  TeamData,
} from '../sim/types';
import type {
  ChoiceConsequence,
  JourneyMatchId,
  JourneyMatchOutcome,
  JourneyMatchRequest,
  JourneyState,
  MatchHistoryEntry,
} from './types';

export interface JourneyMatchBuildOptions {
  halfLengthSec: number;
  difficulty: 0 | 1 | 2 | 3;
  seed: number;
}

export interface JourneyResolvedMatch {
  cfg: MatchConfig;
  localTeam: 0 | 1;
  usePrematch: boolean;
}

interface JourneyMatchMeta {
  opponent: string;
  localTeam: 0 | 1;
  usePrematch: boolean;
  venueProfile: MatchVenueProfile;
  crowdDensity: MatchCrowdDensity;
  friendly: boolean;
}

const TRAINING_STADIUM = 'Harbour Training Ground';

const MATCH_META: Record<JourneyMatchId, JourneyMatchMeta> = {
  rtg_trial: {
    opponent: 'Harbour First XI',
    localTeam: 1, // play as reserves (away)
    usePrematch: false,
    venueProfile: 'training',
    crowdDensity: 'empty',
    friendly: true,
  },
  rtg_league_comeback: {
    opponent: 'Marsden United',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'sparse',
    friendly: false,
  },
  rtg_final_chance: {
    opponent: 'Kingsbridge City',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'medium',
    friendly: false,
  },
  rtg_group_stage: {
    opponent: 'Germany',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'main-stadium',
    crowdDensity: 'full',
    friendly: false,
  },
  rtg_world_cup_final: {
    opponent: 'Brazil',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'main-stadium',
    crowdDensity: 'full',
    friendly: false,
  },
  ld_return_friendly: {
    opponent: 'Curacao',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'medium',
    friendly: true,
  },
  ld_group_decider: {
    opponent: 'Germany',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'main-stadium',
    crowdDensity: 'full',
    friendly: false,
  },
  tp_showcase_match: {
    opponent: 'Atlantic FC',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'medium',
    friendly: false,
  },
  tp_heritage_playoff: {
    opponent: 'Canada',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'main-stadium',
    crowdDensity: 'full',
    friendly: false,
  },
  tp_birth_trial: {
    opponent: 'USA Camp XI',
    localTeam: 1,
    usePrematch: false,
    venueProfile: 'training',
    crowdDensity: 'empty',
    friendly: true,
  },
  tp_worldcup_vs_birth: {
    opponent: 'United States',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'main-stadium',
    crowdDensity: 'full',
    friendly: false,
  },
  mc_turin_semi: {
    opponent: 'Stuttgart Foundry',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'medium',
    friendly: false,
  },
  mc_turin_final: {
    opponent: 'Winterthur Watchmakers',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'medium',
    friendly: false,
  },
  mc_turin_defence: {
    opponent: 'Turin Mechanics',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'main-stadium',
    crowdDensity: 'full',
    friendly: false,
  },
  fe_hamilton_crescent: {
    opponent: 'Albion Association',
    localTeam: 0,
    usePrematch: true,
    venueProfile: 'small-stadium',
    crowdDensity: 'sparse',
    friendly: false,
  },
};

const RESULT_CONSEQUENCES: Record<JourneyMatchId, Partial<Record<MatchHistoryEntry['result'], ChoiceConsequence[]>>> = {
  rtg_trial: {
    win: [{ type: 'reputation', change: 2 }, { type: 'storyMorale', change: 2 }],
    draw: [{ type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 2 }, { type: 'storyMorale', change: -1 }],
  },
  rtg_league_comeback: {
    win: [{ type: 'reputation', change: 2 }, { type: 'storyMorale', change: 2 }],
    draw: [{ type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 2 }, { type: 'storyMorale', change: -2 }],
  },
  rtg_final_chance: {
    win: [{ type: 'reputation', change: 4 }, { type: 'storyMorale', change: 3 }],
    draw: [{ type: 'reputation', change: 1 }, { type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -2 }],
  },
  rtg_group_stage: {
    win: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 2 }],
    draw: [{ type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 2 }, { type: 'storyMorale', change: -1 }],
  },
  rtg_world_cup_final: {
    win: [{ type: 'reputation', change: 8 }, { type: 'storyMorale', change: 5 }],
    draw: [{ type: 'reputation', change: 3 }, { type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -3 }],
  },
  ld_return_friendly: {
    win: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 2 }, { type: 'relationship', npcId: 'ld_young_striker_elian', change: 1 }],
    draw: [{ type: 'storyPressure', change: 1 }, { type: 'relationship', npcId: 'ld_physio_mara', change: 1 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -2 }, { type: 'injuryRisk', change: 1 }],
  },
  ld_group_decider: {
    win: [{ type: 'reputation', change: 6 }, { type: 'storyMorale', change: 4 }],
    draw: [{ type: 'reputation', change: 2 }, { type: 'storyPressure', change: 2 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -3 }],
  },
  tp_showcase_match: {
    win: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 2 }],
    draw: [{ type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 2 }, { type: 'storyMorale', change: -1 }],
  },
  tp_heritage_playoff: {
    win: [{ type: 'reputation', change: 5 }, { type: 'storyMorale', change: 5 }, { type: 'relationship', npcId: 'tp_heritage_captain_etienne', change: 2 }],
    draw: [{ type: 'reputation', change: 2 }, { type: 'storyPressure', change: 2 }],
    loss: [{ type: 'storyPressure', change: 4 }, { type: 'storyMorale', change: -3 }],
  },
  tp_birth_trial: {
    win: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 1 }, { type: 'relationship', npcId: 'tp_birth_teammate_brooks', change: 1 }],
    draw: [{ type: 'storyPressure', change: 1 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -2 }],
  },
  tp_worldcup_vs_birth: {
    win: [{ type: 'reputation', change: 6 }, { type: 'storyMorale', change: 4 }],
    draw: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 2 }],
    loss: [{ type: 'storyPressure', change: 2 }, { type: 'storyMorale', change: -1 }],
  },
  mc_turin_semi: {
    win: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 2 }, { type: 'relationship', npcId: 'mc_captain_eddie', change: 1 }],
    draw: [{ type: 'storyPressure', change: 1 }, { type: 'storyMorale', change: 1 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -2 }, { type: 'relationship', npcId: 'mc_foreman_doyle', change: -1 }],
  },
  mc_turin_final: {
    win: [{ type: 'reputation', change: 5 }, { type: 'storyMorale', change: 3 }],
    draw: [{ type: 'reputation', change: 2 }, { type: 'storyPressure', change: 2 }],
    loss: [{ type: 'storyPressure', change: 4 }, { type: 'storyMorale', change: -2 }],
  },
  mc_turin_defence: {
    win: [{ type: 'reputation', change: 8 }, { type: 'storyMorale', change: 5 }, { type: 'relationship', npcId: 'mc_wife_mary', change: 2 }],
    draw: [{ type: 'reputation', change: 4 }, { type: 'storyMorale', change: 2 }],
    loss: [{ type: 'storyPressure', change: 3 }, { type: 'storyMorale', change: -2 }],
  },
  fe_hamilton_crescent: {
    win: [{ type: 'reputation', change: 4 }, { type: 'storyMorale', change: 3 }, { type: 'relationship', npcId: 'fe_captain_muir', change: 2 }],
    draw: [{ type: 'reputation', change: 3 }, { type: 'storyMorale', change: 2 }, { type: 'relationship', npcId: 'fe_goalkeeper_fergus', change: 2 }],
    loss: [{ type: 'storyPressure', change: 2 }, { type: 'storyMorale', change: -1 }],
  },
};

function journeyMatchYear(matchId: JourneyMatchId): number {
  if (matchId === 'fe_hamilton_crescent') return 1872;
  if (matchId === 'mc_turin_defence') return 1911;
  if (matchId.startsWith('mc_')) return 1909;
  return 2026;
}

export function isJourneyTrophyMatch(matchId: JourneyMatchId): boolean {
  return matchId === 'rtg_world_cup_final'
    || matchId === 'mc_turin_final'
    || matchId === 'mc_turin_defence';
}

function fictionalClubTeam(id: string, name: string, short: string, stadium: string, primaryColor: string, secondaryColor: string): TeamData {
  return {
    id,
    name,
    short,
    stadium,
    strength: 65,
    colors: {
      home: { shirt: primaryColor, shorts: secondaryColor, socks: primaryColor },
      away: { shirt: secondaryColor, shorts: primaryColor, socks: secondaryColor },
    },
    players: [
      { name: 'John Miller', pos: 'GK', age: 24, pace: 50, pass: 45, shoot: 10, tackle: 10, keeping: 62, shirtNumber: 1 },
      { name: 'Dave Smith', pos: 'DF', age: 28, pace: 60, pass: 55, shoot: 30, tackle: 65, keeping: 8, shirtNumber: 2 },
      { name: 'Carl Jones', pos: 'DF', age: 25, pace: 58, pass: 50, shoot: 25, tackle: 62, keeping: 8, shirtNumber: 5 },
      { name: 'Robert Taylor', pos: 'DF', age: 29, pace: 62, pass: 52, shoot: 20, tackle: 66, keeping: 8, shirtNumber: 6 },
      { name: 'James Brown', pos: 'DF', age: 23, pace: 68, pass: 58, shoot: 35, tackle: 60, keeping: 8, shirtNumber: 3 },
      { name: 'Paul Wilson', pos: 'MF', age: 27, pace: 70, pass: 68, shoot: 55, tackle: 58, keeping: 8, shirtNumber: 4 },
      { name: 'Steve Evans', pos: 'MF', age: 22, pace: 72, pass: 64, shoot: 58, tackle: 50, keeping: 8, shirtNumber: 7 },
      { name: 'Mike Thomas', pos: 'MF', age: 26, pace: 66, pass: 70, shoot: 52, tackle: 55, keeping: 8, shirtNumber: 8 },
      { name: 'Andy Roberts', pos: 'MF', age: 24, pace: 75, pass: 62, shoot: 60, tackle: 48, keeping: 8, shirtNumber: 11 },
      { name: 'Chris Jackson', pos: 'FW', age: 25, pace: 78, pass: 50, shoot: 72, tackle: 30, keeping: 8, shirtNumber: 9 },
      { name: 'Gary Harris', pos: 'FW', age: 27, pace: 76, pass: 52, shoot: 70, tackle: 32, keeping: 8, shirtNumber: 10 },
      // bench
      { name: 'Tom GK', pos: 'GK', age: 21, pace: 48, pass: 40, shoot: 10, tackle: 10, keeping: 58, shirtNumber: 13 },
      { name: 'Mark DF', pos: 'DF', age: 23, pace: 60, pass: 50, shoot: 20, tackle: 58, keeping: 8, shirtNumber: 14 },
      { name: 'Peter MF', pos: 'MF', age: 25, pace: 68, pass: 62, shoot: 50, tackle: 52, keeping: 8, shirtNumber: 15 },
      { name: 'Dan FW', pos: 'FW', age: 24, pace: 72, pass: 48, shoot: 64, tackle: 28, keeping: 8, shirtNumber: 16 },
    ],
  };
}

function historicTeam(
  id: string,
  name: string,
  short: string,
  stadium: string,
  primaryColor: string,
  secondaryColor: string,
  playerNames: string[],
): TeamData {
  const team = fictionalClubTeam(id, name, short, stadium, primaryColor, secondaryColor);
  team.strength = 62;
  team.players = team.players.map((player, index) => ({
    ...player,
    name: playerNames[index] ?? `${playerNames[index % playerNames.length]} Reserve`,
    age: Math.max(20, Math.min(34, player.age + (index % 3) - 1)),
  }));
  return team;
}

export function journeyMatchResult(
  outcome: JourneyMatchOutcome,
  localTeam: 0 | 1,
): MatchHistoryEntry['result'] {
  if (outcome.winner === localTeam) return 'win';
  if (outcome.winner === 0 || outcome.winner === 1) return 'loss';

  const playerGoals = outcome.score[localTeam];
  const opponentGoals = outcome.score[1 - localTeam];
  return playerGoals > opponentGoals ? 'win' : playerGoals < opponentGoals ? 'loss' : 'draw';
}

export function buildJourneyMatchConfig(
  request: JourneyMatchRequest,
  state: JourneyState,
  options: JourneyMatchBuildOptions,
): JourneyResolvedMatch {
  const meta = MATCH_META[request.matchId];
  const { home, away, homeFormation, awayFormation } = buildJourneyTeams(request.matchId, state);
  const [homeKit, awayKit] = pickKits(home.colors, away.colors);
  const teams: [MatchTeamConfig, MatchTeamConfig] = [
    makeMatchTeam(home, meta.localTeam === 0 ? 'human' : 'ai', homeKit, homeFormation),
    makeMatchTeam(away, meta.localTeam === 1 ? 'human' : 'ai', awayKit, awayFormation),
  ];

  const cfg: MatchConfig = {
    teams,
    halfLengthSec: options.halfLengthSec,
    difficulty: options.difficulty,
    cupTie: request.matchId === 'rtg_world_cup_final',
    trophyWin: isJourneyTrophyMatch(request.matchId),

    seed: (options.seed ^ hashString(request.matchId)) >>> 0,
    weather: 'normal',
    timeOfDay: request.matchId === 'rtg_group_stage' || request.matchId.startsWith('mc_') ? 'evening' : 'day',
    // coherent mild temperature for these scripted clear-weather ties (no drinks
    // break — they sit below the hot threshold; day games just run a touch warmer)
    temperature: request.matchId === 'rtg_group_stage' || request.matchId.startsWith('mc_') ? 19 : 24,
    isFriendly: meta.friendly,
    venueProfile: meta.venueProfile,
    crowdDensity: meta.crowdDensity,
    era: eraRulesForYear(journeyMatchYear(request.matchId)),
  };

  // Inject scenario conditions!
  if (request.matchId === 'rtg_league_comeback') {
    cfg.startScore = [0, 1];
    cfg.startTimeSec = 15 / 45 * options.halfLengthSec; // Start at 60th min (assuming halfLengthSec represents 45 mins)
    cfg.startHalf = 2;
  }

  return {
    localTeam: meta.localTeam,
    usePrematch: meta.usePrematch,
    cfg,
  };
}

export function recordJourneyMatchOutcome(
  state: JourneyState,
  request: JourneyMatchRequest,
  outcome: JourneyMatchOutcome,
  localTeam: 0 | 1,
): JourneyState {
  const playerGoals = outcome.score[localTeam];
  const opponentGoals = outcome.score[1 - localTeam];
  const result = journeyMatchResult(outcome, localTeam);
  const rating = clamp(
    6 + (result === 'win' ? 1.1 : result === 'draw' ? 0.3 : -0.4) + (state.reputation - 20) / 80,
    4.5,
    8.5,
  );

  const entry: MatchHistoryEntry = {
    matchId: request.matchId,
    date: '2026',
    opponent: MATCH_META[request.matchId].opponent,
    result,
    score: outcome.score,
    goalMargin: playerGoals - opponentGoals,
    minutesPlayed: request.matchId === 'rtg_league_comeback' ? 30 : 90,
    rating: Number(rating.toFixed(1)),
    goals: 0,
    assists: 0,
    keyPasses: result === 'loss' ? 1 : 2,
    tackles: state.playerPosition === 'DF' ? 4 : state.playerPosition === 'MF' ? 3 : 1,
    saves: state.playerPosition === 'GK' ? Math.max(1, opponentGoals + 2) : undefined,
  };

  const recorded = {
    ...state,
    storyFlags: {
      ...state.storyFlags,
      [`journey_match_${request.matchId}_played`]: true,
      [`journey_match_${request.matchId}_result_win`]: result === 'win',
      [`journey_match_${request.matchId}_result_draw`]: result === 'draw',
      [`journey_match_${request.matchId}_result_loss`]: result === 'loss',
    },
    matchPerformance: [...state.matchPerformance, entry],
  };

  return applyConsequences(recorded, RESULT_CONSEQUENCES[request.matchId][result] ?? []);
}

function buildJourneyTeams(matchId: JourneyMatchId, state: JourneyState): {
  home: TeamData;
  away: TeamData;
  homeFormation: FormationId;
  awayFormation: FormationId;
} {
  const journeyPlayer = journeyPlayerAttrs(state);

  switch (matchId) {
    case 'rtg_trial': {
      const firstTeam = fictionalClubTeam('harbour-first-xi', 'Harbour First XI', 'HFX', TRAINING_STADIUM, '#1E3A8A', '#F59E0B');
      const reserves = fictionalClubTeam('harbour-reserves', 'Harbour Reserves', 'HRV', TRAINING_STADIUM, '#1E3A8A', '#F59E0B');
      reserves.players = [...reserves.players.slice(0, 10), journeyPlayer];
      firstTeam.colors.away = { ...firstTeam.colors.home, shirt: '#EF4444' };
      reserves.colors.home = { shirt: '#10B981', shorts: '#FFFFFF', socks: '#10B981' };
      return { home: firstTeam, away: reserves, homeFormation: '4-4-2', awayFormation: '4-4-2' };
    }
    case 'rtg_league_comeback': {
      const harbour = fictionalClubTeam('harbour-city', 'Harbour City', 'HBC', 'Harbour Stadium', '#1E3A8A', '#F59E0B');
      harbour.players = [...harbour.players.slice(0, 10), journeyPlayer];
      const marsden = fictionalClubTeam('marsden-united', 'Marsden United', 'MAR', 'Marsden Park', '#10B981', '#FFFFFF');
      return { home: harbour, away: marsden, homeFormation: '4-4-2', awayFormation: '4-3-3' };
    }
    case 'rtg_final_chance': {
      const harbour = fictionalClubTeam('harbour-city', 'Harbour City', 'HBC', 'Harbour Stadium', '#1E3A8A', '#F59E0B');
      harbour.players = [...harbour.players.slice(0, 10), journeyPlayer];
      const kingsbridge = fictionalClubTeam('kingsbridge-city', 'Kingsbridge City', 'KBC', 'Kingsbridge Arena', '#8B5CF6', '#F59E0B');
      return { home: harbour, away: kingsbridge, homeFormation: '4-3-3', awayFormation: '4-4-2' };
    }
    case 'rtg_group_stage': {
      const england = cloneTeam(englandJson as TeamData);
      england.players = [...england.players.slice(0, 10), journeyPlayer];
      const germany = cloneTeam(germanyJson as TeamData);
      return { home: england, away: germany, homeFormation: '4-3-3', awayFormation: '4-2-3-1' };
    }
    case 'rtg_world_cup_final': {
      const england = cloneTeam(englandJson as TeamData);
      england.players = [...england.players.slice(0, 10), journeyPlayer];
      const brazil = cloneTeam(brazilJson as TeamData);
      return { home: england, away: brazil, homeFormation: '4-3-3', awayFormation: '4-3-3' };
    }
    case 'ld_return_friendly': {
      const capeVerde = cloneTeam(capeVerdeJson as TeamData);
      capeVerde.players = [...capeVerde.players.slice(0, 10), journeyPlayer];
      const curacao = cloneTeam(curacaoJson as TeamData);
      return { home: capeVerde, away: curacao, homeFormation: '4-4-2', awayFormation: '4-2-3-1' };
    }
    case 'ld_group_decider': {
      const capeVerde = cloneTeam(capeVerdeJson as TeamData);
      capeVerde.players = [...capeVerde.players.slice(0, 10), journeyPlayer];
      const germany = cloneTeam(germanyJson as TeamData);
      return { home: capeVerde, away: germany, homeFormation: '4-4-2', awayFormation: '4-2-3-1' };
    }
    case 'tp_showcase_match': {
      const metro = fictionalClubTeam('metro-fc', 'Metro FC', 'MFC', 'Metro Park', '#FFFFFF', '#111827');
      metro.players = [...metro.players.slice(0, 10), journeyPlayer];
      const atlantic = fictionalClubTeam('atlantic-fc', 'Atlantic FC', 'AFC', 'Atlantic Stadium', '#2563EB', '#F97316');
      return { home: metro, away: atlantic, homeFormation: '4-2-3-1', awayFormation: '4-4-2' };
    }
    case 'tp_heritage_playoff': {
      const haiti = cloneTeam(haitiJson as TeamData);
      haiti.players = [...haiti.players.slice(0, 10), journeyPlayer];
      const canada = cloneTeam(canadaJson as TeamData);
      return { home: haiti, away: canada, homeFormation: '4-2-3-1', awayFormation: '4-3-3' };
    }
    case 'tp_birth_trial': {
      const camp = renameTeam(cloneTeam(usaJson as TeamData), 'usa-camp-xi', 'USA Camp XI', 'USC', TRAINING_STADIUM);
      const trialists = renameTeam(cloneTeam(usaJson as TeamData), 'usa-trialists', 'USA Trialists', 'UST', TRAINING_STADIUM);
      trialists.players = [...trialists.players.slice(0, 10), journeyPlayer];
      camp.colors.away = { ...camp.colors.home, shirt: '#1D4ED8' };
      trialists.colors.home = { shirt: '#FFFFFF', shorts: '#1D4ED8', socks: '#FFFFFF' };
      return { home: camp, away: trialists, homeFormation: '4-3-3', awayFormation: '4-2-3-1' };
    }
    case 'tp_worldcup_vs_birth': {
      const haiti = cloneTeam(haitiJson as TeamData);
      haiti.players = [...haiti.players.slice(0, 10), journeyPlayer];
      const usa = renameTeam(cloneTeam(usaJson as TeamData), 'united-states', 'United States', 'USA', 'National Stadium');
      return { home: haiti, away: usa, homeFormation: '4-2-3-1', awayFormation: '4-3-3' };
    }
    case 'mc_turin_semi': {
      const colliers = historicTeam('auckland-colliers', 'Auckland Colliers', 'AUC', 'County Ground', '#111827', '#F5F5DC', [
        'Billy Harker', 'Jack Fenwick', 'Ned Rowell', 'Arthur Pease', 'Sammy Croft', 'Tommy Wilkes',
        'Harry Lowes', 'George Bain', 'Charlie Moffat', 'Eddie Rowell', 'Fred Rutter',
      ]);
      colliers.players = [...colliers.players.slice(0, 10), journeyPlayer, ...colliers.players.slice(11)];
      const foundry = historicTeam('stuttgart-foundry', 'Stuttgart Foundry', 'STF', 'Turin Field', '#7F1D1D', '#F8FAFC', [
        'Karl Bauer', 'Otto Weiss', 'Emil Vogel', 'Fritz Keller', 'Hugo Brandt', 'Max Adler',
        'Lukas Hart', 'Ernst Falk', 'Rudi Stahl', 'Anton Krug', 'Willi Roth',
      ]);
      return { home: colliers, away: foundry, homeFormation: '2-3-5', awayFormation: '2-3-5' };
    }
    case 'mc_turin_final': {
      const colliers = historicTeam('auckland-colliers', 'Auckland Colliers', 'AUC', 'Turin Field', '#111827', '#F5F5DC', [
        'Billy Harker', 'Jack Fenwick', 'Ned Rowell', 'Arthur Pease', 'Sammy Croft', 'Tommy Wilkes',
        'Harry Lowes', 'George Bain', 'Charlie Moffat', 'Eddie Rowell', 'Fred Rutter',
      ]);
      colliers.players = [...colliers.players.slice(0, 10), journeyPlayer, ...colliers.players.slice(11)];
      const winterthur = historicTeam('winterthur-watchmakers', 'Winterthur Watchmakers', 'WIN', 'Turin Field', '#1D4ED8', '#F8FAFC', [
        'Hans Keller', 'Peter Frei', 'Jakob Meier', 'Luca Baumann', 'Emil Ritter', 'Theo Graf',
        'Otto Stein', 'Felix Hofer', 'Armin Roth', 'Nico Bader', 'Walter Kuhn',
      ]);
      return { home: colliers, away: winterthur, homeFormation: '2-3-5', awayFormation: '2-3-5' };
    }
    case 'mc_turin_defence': {
      const colliers = historicTeam('auckland-colliers', 'Auckland Colliers', 'AUC', 'Turin Field', '#111827', '#F5F5DC', [
        'Billy Harker', 'Jack Fenwick', 'Ned Rowell', 'Arthur Pease', 'Sammy Croft', 'Tommy Wilkes',
        'Harry Lowes', 'George Bain', 'Charlie Moffat', 'Eddie Rowell', 'Fred Rutter',
      ]);
      colliers.players = [...colliers.players.slice(0, 10), journeyPlayer, ...colliers.players.slice(11)];
      const turin = historicTeam('turin-mechanics', 'Turin Mechanics', 'TUR', 'Turin Field', '#111111', '#F8FAFC', [
        'Marco Rinaldi', 'Pietro Costa', 'Luigi Ferri', 'Carlo Greco', 'Enzo Bianchi', 'Vito Serra',
        'Dino Ricci', 'Bruno Conti', 'Aldo Fabbri', 'Nino Leone', 'Gino Moretti',
      ]);
      return { home: colliers, away: turin, homeFormation: '2-3-5', awayFormation: '2-3-5' };
    }
    case 'fe_hamilton_crescent': {
      const caledonia = historicTeam('caledonia-eleven', 'Caledonia Eleven', 'CAL', 'Hamilton Crescent', '#1D3557', '#F8FAFC', [
        'Fergus Bain', 'Andrew Kerr', 'Robert Muir', 'James Gow', 'Hugh Strachan', 'Walter Aitken',
        'David Baird', 'Colin Shaw', 'Peter Drummond', 'Alan Fairlie', 'Matthew Bruce',
      ]);
      caledonia.players = [...caledonia.players.slice(0, 10), journeyPlayer, ...caledonia.players.slice(11)];
      const albion = historicTeam('albion-association', 'Albion Association', 'ALB', 'Hamilton Crescent', '#F8FAFC', '#111827', [
        'Arthur Hart', 'Edward Lyle', 'Charles Bower', 'Henry Wain', 'George Talbot', 'William Ames',
        'Frederick Cole', 'Samuel Pritchard', 'Thomas Vale', 'Alfred Cross', 'John Mercer',
      ]);
      return { home: caledonia, away: albion, homeFormation: '2-3-5', awayFormation: '2-3-5' };
    }
  }
}

function makeMatchTeam(team: TeamData, controller: ControllerKind, kit: KitColors, formation: FormationId): MatchTeamConfig {
  const journeyPlayerIdx = team.players.findIndex((p) => p.name.startsWith('__journey__:'));
  if (journeyPlayerIdx >= 0) {
    team.players[journeyPlayerIdx] = {
      ...team.players[journeyPlayerIdx],
      name: team.players[journeyPlayerIdx].name.replace('__journey__:', ''),
    };
  }
  const starters = journeyPlayerIdx >= 0
    ? forceStarter(team.players, formation, journeyPlayerIdx)
    : autoLineup(team.players, formation);
  return {
    data: team,
    lineup: { formation, starters, tactics: normalizeTactics(undefined, formation) },
    kit,
    controller,
  };
}

function journeyPlayerAttrs(state: JourneyState): PlayerAttrs {
  const pos = state.playerPosition;
  return {
    name: `__journey__:${state.playerName}`,
    pos,
    age: state.campaignId === 'last-dance-story' ? 39 : state.campaignId === 'two-passports-story' ? 27 : 21,
    pace: state.stats.pace,
    pass: state.stats.passing,
    shoot: state.stats.shooting,
    tackle: state.stats.defending,
    keeping: pos === 'GK' ? Math.max(55, Math.round((state.stats.mental + state.stats.physical) / 2)) : 8,
    shirtNumber: 10,
  };
}

function forceStarter(players: PlayerAttrs[], formation: FormationId, playerIndex: number): number[] {
  const starters = autoLineup(players, formation).filter((idx, pos, arr) => arr.indexOf(idx) === pos).slice(0, 11);
  if (starters.includes(playerIndex)) return starters;
  if (players[playerIndex].pos === 'GK') {
    starters[0] = playerIndex;
    return starters;
  }
  const playerPos = players[playerIndex].pos;
  const samePositionSlot = starters.findIndex((idx, slot) => slot > 0 && players[idx].pos === playerPos);
  starters[samePositionSlot >= 0 ? samePositionSlot : starters.length - 1] = playerIndex;
  return starters;
}

function renameTeam(team: TeamData, id: string, name: string, short: string, stadium: string): TeamData {
  return {
    ...team,
    id,
    name,
    short,
    stadium,
    players: team.players.map((p) => ({ ...p })),
    colors: {
      home: { ...team.colors.home, style: team.colors.home.style ? { ...team.colors.home.style } : undefined },
      away: { ...team.colors.away, style: team.colors.away.style ? { ...team.colors.away.style } : undefined },
    },
  };
}

function cloneTeam(team: TeamData): TeamData {
  return renameTeam(team, team.id, team.name, team.short, team.stadium);
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
