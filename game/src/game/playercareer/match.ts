/**
 * Player Career — build a Be-A-Pro MatchConfig. Reuses the manager match builder,
 * forces the avatar into the starting XI, and pins control + camera to them.
 */
import type { MatchConfig } from '../../sim/types';
import type { PlayerCareerState } from './types';
import { buildManagerMatch } from '../manager/match';
import { resolveLineup } from '../manager/utils';
import { anyTeamById } from '../../data/teams';

export interface BuildPlayerMatchOpts {
  halfLengthSec?: number;
  difficulty?: 0 | 1 | 2 | 3;
}

/** The avatar's current squad index in their club (found by name — robust to reordering). */
export function avatarSquadIdx(pcs: PlayerCareerState): number {
  const squad = pcs.world.squads[pcs.world.userClubId] ?? [];
  const idx = squad.findIndex((p) => p.name === pcs.playerName);
  return idx >= 0 ? idx : 0;
}

export function buildPlayerMatch(pcs: PlayerCareerState, opts: BuildPlayerMatchOpts = {}): MatchConfig | null {
  const world = pcs.world;
  const fx = world.pendingUserFixture;
  if (!fx) return null;
  const userIsHome = fx.homeClubId === world.userClubId;
  const userTeam = anyTeamById(world.userClubId);
  if (!userTeam) return null;
  const squad = world.squads[world.userClubId] ?? [];
  const avatarIdx = avatarSquadIdx(pcs);

  // Start from the team's default XI, then force the avatar into it (Be-A-Pro:
  // you always start). If they're not in the XI, drop the lowest-rated starter.
  const base = resolveLineup(squad, userTeam.defaultLineup);
  let starters = base.starters.slice();
  if (!starters.includes(avatarIdx)) {
    const ovr = (i: number) => {
      const p = squad[i];
      return p ? (p.pos === 'GK' ? p.keeping : (p.pace + p.pass + p.shoot + p.tackle) / 4) : 0;
    };
    let weakest = 0;
    for (let i = 1; i < starters.length; i++) if (ovr(starters[i]) < ovr(starters[weakest])) weakest = i;
    starters[weakest] = avatarIdx;
  }

  const cfg = buildManagerMatch(world, {
    homeClubId: fx.homeClubId,
    awayClubId: fx.awayClubId,
    userIsHome,
    cupTie: fx.cupTie,
    seed: (world.seed ^ (world.matchday * 7919) ^ (world.season * 131)) >>> 0,
    halfLengthSec: opts.halfLengthSec ?? 150,
    difficulty: opts.difficulty ?? 1,
    userFormation: base.formation,
    userStarters: starters,
  });
  const userSide = (userIsHome ? 0 : 1) as 0 | 1;
  cfg.focusPlayer = { team: userSide, squadIdx: avatarIdx };
  return cfg;
}
