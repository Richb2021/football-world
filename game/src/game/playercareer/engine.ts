/**
 * Football Career — PLAYER CAREER engine. Reuses an embedded ManagerState (`world`)
 * for the league simulation (fixtures, CPU matchdays, tables, promotion/relegation)
 * and layers a single avatar on top: personal stats, reputation, training growth,
 * transfers between clubs and international call-ups.
 *
 * The avatar's live attributes live inside the world squad (so the match engine and
 * Be-A-Pro control pin read them); the avatar is found by name each access.
 */
import { Rng } from '../../sim/rng';
import { overallRating } from '../../sim/formations';
import { anyTeamById } from '../../data/teams';
import { nationById, teamsOf } from '../../data/nations';
import {
  createManagerCareer, recordUserResult, quickSimUserFixture, advance as advanceWorld,
  startNextSeason,
} from '../manager/engine';
import type { ManagerPlayer } from '../manager/types';
import { clamp } from '../manager/types';
import type { PlayerCareerState, PlayerTrainingFocus, PlayerMatchLog } from './types';
import { ensurePlayerSystems } from './saves';
import { clubStrength } from '../manager/utils';
import type { PlayerAppearance, Pos } from '../../sim/types';

// -------------------------------------------------------------- creation

function startingAttrs(pos: Pos): { pace: number; pass: number; shoot: number; tackle: number; keeping: number } {
  const r = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo));
  if (pos === 'GK') return { pace: r(40, 50), pass: r(40, 52), shoot: 30, tackle: 30, keeping: r(52, 62) };
  if (pos === 'DF') return { pace: r(48, 58), pass: r(46, 56), shoot: r(34, 44), tackle: r(52, 62), keeping: 8 };
  if (pos === 'MF') return { pace: r(50, 60), pass: r(54, 64), shoot: r(46, 56), tackle: r(48, 58), keeping: 7 };
  return { pace: r(54, 66), pass: r(48, 58), shoot: r(54, 64), tackle: r(36, 46), keeping: 8 }; // FW
}

function freeShirt(squad: ManagerPlayer[], preferred: number): number {
  const taken = new Set(squad.map((p) => p.shirtNumber ?? 0));
  let n = preferred;
  while (taken.has(n)) n++;
  return n;
}

export function createPlayerCareer(opts: {
  nationId: string; clubId: string; playerName: string; pos: Pos;
  appearance?: PlayerAppearance; seed: number;
}): PlayerCareerState {
  const world = createManagerCareer({ nationId: opts.nationId, clubId: opts.clubId, managerName: opts.playerName, seed: opts.seed });
  const squad = world.squads[opts.clubId];
  const prefShirt = opts.pos === 'GK' ? 1 : opts.pos === 'FW' ? 9 : opts.pos === 'MF' ? 8 : 5;
  const avatar: ManagerPlayer = {
    name: opts.playerName, pos: opts.pos, age: 16, ...startingAttrs(opts.pos),
    shirtNumber: freeShirt(squad, prefShirt), appearance: opts.appearance,
    form: 50, morale: 68, fitness: 96, contractYears: 3, wage: 1, potential: 82 + Math.floor(Math.random() * 8),
  };
  // take a same-position squad slot (or the weakest overall) so the avatar is in the side
  let slot = squad.findIndex((p) => p.pos === opts.pos);
  if (slot < 0) slot = squad.reduce((bi, p, i, arr) => (overallRating(p) < overallRating(arr[bi]) ? i : bi), 0);
  squad[slot] = avatar;

  const pcs: PlayerCareerState = {
    version: 1,
    world,
    playerName: opts.playerName,
    pos: opts.pos,
    appearance: opts.appearance,
    reputation: 35,
    trainingXp: 0,
    trainingFocus: 'balanced',
    apps: 0, goals: 0, assists: 0, avgRating: 0,
    careerApps: 0, careerGoals: 0, careerAssists: 0,
    internationalCaps: 0, internationalGoals: 0, internationalEligible: true,
    history: [],
    inbox: { messages: [] },
    headlines: [],
    phase: 'in-season',
    lastReview: [],
    seed: opts.seed,
  };
  return ensurePlayerSystems(pcs);
}

export function avatarOf(pcs: PlayerCareerState): ManagerPlayer | undefined {
  return (pcs.world.squads[pcs.world.userClubId] ?? []).find((p) => p.name === pcs.playerName);
}

// -------------------------------------------------------------- match performance

interface PlayerLine { goals: number; assists: number; rating: number; result: 'win' | 'draw' | 'loss'; }
type ScorerEntry = { team: 0 | 1; player: string; minute: number; ownGoal?: boolean; assist?: string };

function derivePlayerLine(pcs: PlayerCareerState, score: [number, number], userIsHome: boolean, rng: Rng, scorers?: ScorerEntry[]): PlayerLine {
  const av = avatarOf(pcs);
  const teamGoals = userIsHome ? score[0] : score[1];
  const oppGoals = userIsHome ? score[1] : score[0];
  const result: PlayerLine['result'] = teamGoals > oppGoals ? 'win' : teamGoals < oppGoals ? 'loss' : 'draw';
  // Real goals come from the match's goal log when available (a played Be-A-Pro
  // match); otherwise they're estimated from the scoreline and the avatar's shooting.
  let goals: number;
  if (scorers) {
    const userSide: 0 | 1 = userIsHome ? 0 : 1;
    goals = Math.min(teamGoals, scorers.filter((s) => s.team === userSide && s.player === pcs.playerName && !s.ownGoal).length);
  } else {
    const shoot = av?.shoot ?? 50;
    const goalChance = pcs.pos === 'FW' ? 0.30 + shoot / 380 : pcs.pos === 'MF' ? 0.14 + shoot / 620 : pcs.pos === 'DF' ? 0.05 : 0;
    goals = 0;
    for (let g = 0; g < teamGoals; g++) if (rng.next() < goalChance) goals++;
  }
  // Real assists come from the goal log's `assist` field when available; otherwise
  // they're estimated from the remaining team goals.
  let assists: number;
  if (scorers) {
    const userSide: 0 | 1 = userIsHome ? 0 : 1;
    assists = scorers.filter((s) => s.team === userSide && !s.ownGoal && s.assist === pcs.playerName).length;
  } else {
    const astChance = pcs.pos === 'FW' || pcs.pos === 'MF' ? 0.18 : pcs.pos === 'DF' ? 0.08 : 0;
    assists = 0;
    for (let g = 0; g < teamGoals - goals; g++) if (rng.next() < astChance) assists++;
  }
  let rating = 6.4 + (result === 'win' ? 0.6 : result === 'loss' ? -0.6 : 0) + goals * 1.0 + assists * 0.5 + (rng.next() - 0.5) * 0.8;
  rating = clamp(rating, 3, 10);
  return { goals, assists, rating, result };
}

function applyLine(pcs: PlayerCareerState, line: PlayerLine, opponentClubId: string, rng: Rng): void {
  pcs.apps++; pcs.careerApps++;
  pcs.goals += line.goals; pcs.careerGoals += line.goals;
  pcs.assists += line.assists; pcs.careerAssists += line.assists;
  pcs.avgRating = pcs.avgRating === 0 ? line.rating : pcs.avgRating * 0.85 + line.rating * 0.15;
  pcs.trainingXp += 1 + (line.rating >= 7.5 ? 1 : 0);
  pcs.reputation = clamp(pcs.reputation + (line.rating - 6.4) * 1.6 + line.goals * 1.5);
  const log: PlayerMatchLog = {
    season: pcs.world.season, matchday: pcs.world.matchday,
    opponent: anyTeamById(opponentClubId)?.name ?? opponentClubId,
    club: anyTeamById(pcs.world.userClubId)?.name ?? pcs.world.userClubId,
    score: [0, 0], result: line.result, rating: Math.round(line.rating * 10) / 10,
    goals: line.goals, assists: line.assists, minutes: 90,
  };
  pcs.history.push(log);
  if (pcs.history.length > 80) pcs.history.shift();
  if (line.goals >= 2 && rng.next() < 0.6) {
    pushHeadline(pcs, `${pcs.playerName} ${line.goals === 3 ? 'hat-trick' : 'brace'} fires ${log.club} to ${line.result === 'win' ? 'victory' : 'a draw'}!`, 'positive');
  }
}

function pushHeadline(pcs: PlayerCareerState, title: string, tone: 'positive' | 'negative' | 'neutral' | 'sensational'): void {
  pcs.headlines.push({ id: `h${pcs.headlines.length}_${pcs.world.season}`, title, source: 'Back Page', tone, season: pcs.world.season });
  if (pcs.headlines.length > 50) pcs.headlines.shift();
}

/** Record a PLAYED match (Be-A-Pro): apply the world result then derive the avatar's
 *  line — using the real goal log (`scorers`) when the match was actually played. */
export function recordPlayerMatch(pcs: PlayerCareerState, score: [number, number], rng: Rng, scorers?: ScorerEntry[], winnerSide: -1 | 0 | 1 = -1): void {
  const fx = pcs.world.pendingUserFixture;
  if (!fx) return;
  const userIsHome = fx.homeClubId === pcs.world.userClubId;
  const opp = userIsHome ? fx.awayClubId : fx.homeClubId;
  recordUserResult(pcs.world, score, rng, winnerSide);
  applyLine(pcs, derivePlayerLine(pcs, score, userIsHome, rng, scorers), opp, rng);
}

/** Quick-sim the avatar's fixture (skipping the 3D match) and derive their line. */
export function quickSimPlayerFixture(pcs: PlayerCareerState, rng: Rng): void {
  const fx = pcs.world.pendingUserFixture;
  if (!fx) return;
  const userIsHome = fx.homeClubId === pcs.world.userClubId;
  const opp = userIsHome ? fx.awayClubId : fx.homeClubId;
  const score = quickSimUserFixture(pcs.world, rng); // resolves + applies world effects
  applyLine(pcs, derivePlayerLine(pcs, score, userIsHome, rng), opp, rng);
}

// -------------------------------------------------------------- advance / season

export function advancePlayer(pcs: PlayerCareerState, rng: Rng): { seasonEnded: boolean } {
  // snapshot the avatar before the world rolls over (the off-season may release them)
  const before = avatarOf(pcs);
  const res = advanceWorld(pcs.world, rng);
  if (res.seasonEnded) {
    // restore the avatar with their developed attributes if the off-season released them
    const squadAfter = pcs.world.squads[pcs.world.userClubId] ?? [];
    if (before && !squadAfter.some((p) => p.name === pcs.playerName)) {
      squadAfter.push({ ...before, contractYears: 3, morale: 65 });
    }
    // The club may have "sacked its manager" — but the PLAYER is not the manager,
    // so the season always rolls on (ageing, transfers, call-ups included).
    if (pcs.world.phase === 'job-offers') startNextSeason(pcs.world, rng);
    playerSeasonRollover(pcs, rng);
  }
  return res;
}

function playerSeasonRollover(pcs: PlayerCareerState, rng: Rng): void {
  const av = avatarOf(pcs);
  if (av) {
    av.contractYears = Math.max(av.contractYears ?? 1, 2); // auto-renew so the avatar is never released
    applyTrainingGrowth(pcs, av, rng);
    if (av.age >= 38) {
      pcs.phase = 'retired';
      pcs.lastReview = [
        `<b>${pcs.playerName} retires</b> at ${av.age}.`,
        `Career: <b>${pcs.careerApps} apps · ${pcs.careerGoals} goals · ${pcs.careerAssists} assists</b>.`,
        `Reputation <b>${Math.round(pcs.reputation)}</b> · International caps <b>${pcs.internationalCaps}</b>.`,
        'A career to look back on. Thanks for the memories.',
      ];
      return;
    }
  }
  internationalTick(pcs, rng);
  computeTransferOffer(pcs);

  const seasonApps = pcs.apps;
  pcs.lastReview = [
    `Season ${pcs.world.season - 1} complete: <b>${seasonApps} apps · ${pcs.goals} goals · ${pcs.assists} assists</b> · rating <b>${pcs.avgRating.toFixed(1)}</b>.`,
    `Reputation <b>${Math.round(pcs.reputation)}</b> · Overall <b>${av ? Math.round(overallRating(av)) : '—'}</b> · Age <b>${av?.age ?? '—'}</b>.`,
    pcs.transferOffer ? `A bigger club is interested: <b>${pcs.transferOffer.clubName}</b>.` : 'No transfer interest this summer.',
    pcs.internationalCaps ? `International caps: <b>${pcs.internationalCaps}</b> (${pcs.internationalGoals} goals).` : '',
  ].filter(Boolean);
  pcs.apps = 0; pcs.goals = 0; pcs.assists = 0; pcs.avgRating = 0;
  pcs.phase = 'season-end';
}

// -------------------------------------------------------------- training

export function setPlayerTrainingFocus(pcs: PlayerCareerState, focus: PlayerTrainingFocus): void {
  pcs.trainingFocus = focus;
}

export function applyTrainingGrowth(pcs: PlayerCareerState, av: ManagerPlayer, rng: Rng): void {
  const growthPoints = Math.floor(pcs.trainingXp / 3);
  pcs.trainingXp = 0;
  if (growthPoints <= 0) return;
  const cap = (v: number) => Math.min(av.potential, v);
  const bump = (key: 'pace' | 'pass' | 'shoot' | 'tackle') => { av[key] = cap(av[key] + 1); };
  for (let i = 0; i < growthPoints; i++) {
    switch (pcs.trainingFocus) {
      case 'pace': bump('pace'); break;
      case 'passing': bump('pass'); break;
      case 'shooting': bump('shoot'); break;
      case 'tackling': bump('tackle'); break;
      case 'physical': if (rng.next() < 0.5) bump('pace'); else bump('tackle'); break;
      default: bump(rng.pick(['pace', 'pass', 'shoot', 'tackle'] as const)); break;
    }
  }
}

// -------------------------------------------------------------- international + transfers

function internationalTick(pcs: PlayerCareerState, rng: Rng): void {
  if (pcs.reputation < 68) return;
  const caps = 2 + rng.int(6);
  pcs.internationalCaps += caps;
  const goalRate = pcs.pos === 'FW' ? 0.34 : pcs.pos === 'MF' ? 0.14 : 0.04;
  let ig = 0;
  for (let i = 0; i < caps; i++) if (rng.next() < goalRate) ig++;
  pcs.internationalGoals += ig;
  pushHeadline(pcs, `${pcs.playerName} earns ${caps} international caps${ig ? `, scores ${ig}` : ''}.`, 'positive');
}

function computeTransferOffer(pcs: PlayerCareerState): void {
  pcs.transferOffer = null;
  const nation = nationById(pcs.world.nationId);
  if (!nation) return;
  const myClub = pcs.world.userClubId;
  const myStr = clubStrength(pcs.world.squads[myClub] ?? []);
  // a bigger club comes in when the player has outgrown their current level
  if (pcs.reputation < 58) return;
  const candidates = teamsOf(nation)
    .filter((t) => t.id !== myClub)
    .map((t) => ({ id: t.id, name: t.name, str: clubStrength(pcs.world.squads[t.id] ?? []), tier: pcs.world.clubTier[t.id] ?? 9 }))
    .filter((c) => c.str > myStr + 3 && c.str < myStr + 22)
    .sort((a, b) => b.str - a.str);
  if (!candidates.length) return;
  const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
  pcs.transferOffer = { clubId: pick.id, clubName: pick.name, tier: pick.tier };
}

/** Move the avatar to a new club (accepting a transfer offer). */
export function playerMoveClub(pcs: PlayerCareerState, newClubId: string): void {
  if (newClubId === pcs.world.userClubId) { pcs.transferOffer = null; return; }
  const oldSquad = pcs.world.squads[pcs.world.userClubId] ?? [];
  const idx = oldSquad.findIndex((p) => p.name === pcs.playerName);
  if (idx >= 0) oldSquad.splice(idx, 1);
  const avatar = avatarOf(pcs) ?? { name: pcs.playerName, pos: pcs.pos, age: 20, pace: 55, pass: 55, shoot: 55, tackle: 55, keeping: 8, form: 50, morale: 70, fitness: 95, contractYears: 4, wage: 5, potential: 85 } as ManagerPlayer;
  avatar.contractYears = 4; avatar.morale = 75;
  const newSquad = pcs.world.squads[newClubId] ?? (pcs.world.squads[newClubId] = []);
  newSquad.push(avatar);
  pcs.world.userClubId = newClubId;
  pcs.transferOffer = null;
  pushHeadline(pcs, `${pcs.playerName} signs for ${anyTeamById(newClubId)?.name ?? newClubId}!`, 'sensational');
}

/** Decline a pending transfer offer and stay. */
export function declineTransfer(pcs: PlayerCareerState): void {
  pcs.transferOffer = null;
}
