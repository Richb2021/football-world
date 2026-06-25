/**
 * Manager Mode — build a match engine MatchConfig from two clubs in a career.
 * The user side is controller:'human'; the other is 'ai'. Matches are launched
 * via App.playMatchWithPrematch(cfg, userSide, onEnd).
 */
import type { MatchConfig, MatchTeamConfig, FormationId, Lineup, TeamData } from '../../sim/types';
import type { ManagerState, ManagerPlayer } from './types';
import { teamDataOf, resolveLineup, formMap, pickManagerKits } from './utils';

export interface BuildManagerMatchOpts {
  homeClubId: string;
  awayClubId: string;
  userIsHome: boolean;
  cupTie?: boolean;
  seed: number;
  halfLengthSec?: number;
  difficulty?: 0 | 1 | 2 | 3;
  /** optional user XI override */
  userFormation?: FormationId;
  userStarters?: number[];
}

export function buildManagerMatch(state: ManagerState, opts: BuildManagerMatchOpts): MatchConfig {
  const homeTeam = teamDataOf(opts.homeClubId);
  const awayTeam = teamDataOf(opts.awayClubId);
  const homeSquad: ManagerPlayer[] = state.squads[opts.homeClubId] ?? (homeTeam.players as ManagerPlayer[]);
  const awaySquad: ManagerPlayer[] = state.squads[opts.awayClubId] ?? (awayTeam.players as ManagerPlayer[]);

  const mk = (
    team: typeof homeTeam,
    squad: ManagerPlayer[],
    controller: 'human' | 'ai',
    kit: MatchTeamConfig['kit'],
    pref?: { formation?: FormationId; starters?: number[] },
  ): MatchTeamConfig => {
    const lineup: Lineup = resolveLineup(squad, team.defaultLineup, pref);
    const playerForm = controller === 'human' ? formMap(squad, lineup.starters) : undefined;
    return { data: { ...team, players: squad }, lineup, kit, controller, playerForm };
  };

  const [homeKit, awayKit] = pickManagerKits(homeTeam.colors, awayTeam.colors);
  const userPref = { formation: opts.userFormation, starters: opts.userStarters };
  const home = mk(homeTeam, homeSquad, opts.userIsHome ? 'human' : 'ai', homeKit, opts.userIsHome ? userPref : undefined);
  const away = mk(awayTeam, awaySquad, opts.userIsHome ? 'ai' : 'human', awayKit, opts.userIsHome ? undefined : userPref);

  return {
    teams: [home, away],
    halfLengthSec: opts.halfLengthSec ?? 150,
    difficulty: opts.difficulty ?? 1,
    cupTie: opts.cupTie ?? false,
    seed: opts.seed,
    isFriendly: false,
    leagueId: state.clubLeagueId[opts.homeClubId],
    stadiumName: homeTeam.stadium,
  };
}

/** Exhibition / friendly: build a MatchConfig from two arbitrary teams (any league,
 *  clubs or nations). Used so Exhibition can stage club vs club, or cross-league ties. */
export function buildExhibitionMatch(
  home: TeamData,
  away: TeamData,
  userSide: 0 | 1,
  userLineup: Lineup,
  opts: { halfLengthSec?: number; difficulty?: 0 | 1 | 2 | 3; seed?: number },
): MatchConfig {
  const [homeKit, awayKit] = pickManagerKits(home.colors, away.colors);
  const userPref = { formation: userLineup.formation, starters: userLineup.starters };
  const mk = (team: TeamData, controller: 'human' | 'ai', kit: MatchTeamConfig['kit'], isUser: boolean): MatchTeamConfig => ({
    data: team,
    lineup: resolveLineup(team.players, team.defaultLineup, isUser ? userPref : undefined),
    kit,
    controller,
  });
  const h = mk(home, userSide === 0 ? 'human' : 'ai', homeKit, userSide === 0);
  const a = mk(away, userSide === 1 ? 'human' : 'ai', awayKit, userSide === 1);
  return {
    teams: [h, a],
    halfLengthSec: opts.halfLengthSec ?? 150,
    difficulty: opts.difficulty ?? 1,
    cupTie: false,
    seed: opts.seed ?? (Date.now() & 0xffffff),
    isFriendly: true,
    stadiumName: home.stadium,
  };
}
