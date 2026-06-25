/**
 * Manager Mode — build a match engine MatchConfig from two clubs in a career.
 * The user side is controller:'human'; the other is 'ai'. Matches are launched
 * via App.playMatchWithPrematch(cfg, userSide, onEnd).
 */
import type { MatchConfig, MatchTeamConfig, FormationId, Lineup } from '../../sim/types';
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
