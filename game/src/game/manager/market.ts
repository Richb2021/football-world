/**
 * Football World — MANAGER MODE transfer market, scouting, youth intake, free agents.
 *
 * Keeps the league ALIVE between CPU clubs, surfaces transfer listings to the
 * user, and runs the youth-academy / free-agent pipelines. Pure data + logic —
 * no DOM. The engine calls cpuTransferMarket / tickScouting / youthIntake on
 * advance and startNextSeason; the UI calls the bid / scout / sign helpers.
 */
import { Rng } from '../../sim/rng';
import { overallRating } from '../../sim/formations';
import type { Pos, PlayerAttrs } from '../../sim/types';
import {
  playerValue,
  askingPrice,
  negotiateBuyPlayer,
  negotiateSellPlayer,
  MIN_SQUAD,
  MAX_SQUAD,
} from '../transfers';
import type { ManagerPlayer, ManagerState } from './types';
import { playerKey, moneyM, clamp } from './types';
import { clubStrength, clubNameOf, roundMoney } from './utils';

export { MIN_SQUAD, MAX_SQUAD };

/** A CPU-club player the user can browse and bid on. */
export interface ManagerTransferListing {
  clubId: string;
  squadIdx: number;
  player: ManagerPlayer;
  value: number;
  asking: number;
  /** true once the user has scouted this club (reveals hidden potential). */
  revealed: boolean;
}

/** Outcome of a buy/sell negotiation mapped for the manager UI. */
export interface BidResult {
  status: 'accepted' | 'counter' | 'rejected' | 'blocked';
  message: string;
  newBudget?: number;
  counterOffer?: number;
}

// ---- small inline name pools for generated free agents / youth ----

const FIRST_NAMES = [
  'Jack', 'Tom', 'Sam', 'Ben', 'Dan', 'Alex', 'Ryan', 'Lee', 'Joe', 'Kai',
  'Connor', 'Mason', 'Lewis', 'Harry', 'Callum', 'Reece', 'Jake', 'Nathan',
  'Andre', 'Marcus', 'Tyrese', 'Bobby', 'Ollie', 'Reggie', 'Sid', 'Perry',
];
const LAST_NAMES = [
  'Hardy', 'Reeves', 'Brooks', 'Fletcher', 'Paxton', 'Hartley', 'Vance', 'Cole',
  'Marsh', 'Sloan', 'Beckett', 'Knox', 'Dalton', 'Whitfield', 'Sutton', 'Penn',
  'Rourke', 'Ellis', 'Boyd', 'Carrick', 'Naylor', 'Frost', 'Stack', 'Wren',
];

function makeName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

/**
 * Build a ManagerPlayer from a bare attribute block plus live career state.
 * Local mirror of utils.toManagerPlayer for generated players (no team data).
 */
function mintPlayer(attrs: PlayerAttrs, rng: Rng, ratingHint: number): ManagerPlayer {
  const r = ratingHint || overallRating(attrs);
  return {
    ...attrs,
    form: 50,
    morale: 60,
    fitness: 92,
    contractYears: 1 + rng.int(4),
    wage: Math.max(1, Math.round((r * r) / 60)),
    potential: clamp(r + rng.int(12) - 3, r, 99),
  };
}

/** Scatter raw 0-99 attribute values around a target overall rating for a position. */
function attrsFor(pos: Pos, rating: number, rng: Rng): PlayerAttrs {
  const r = clamp(rating, 20, 99);
  const jitter = (spread: number) => Math.round(r + rng.range(-spread, spread));
  switch (pos) {
    case 'GK':
      return { name: '', pos, age: 20, pace: jitter(8), pass: jitter(12), shoot: jitter(14), tackle: jitter(14), keeping: Math.round(r) };
    case 'DF':
      return { name: '', pos, age: 20, pace: jitter(8), pass: jitter(10), shoot: jitter(12), tackle: Math.round(r), keeping: jitter(18) };
    case 'MF':
      return { name: '', pos, age: 20, pace: jitter(10), pass: Math.round(r), shoot: jitter(10), tackle: jitter(10), keeping: jitter(18) };
    default: // FW
      return { name: '', pos, age: 20, pace: jitter(8), pass: jitter(10), shoot: Math.round(r), tackle: jitter(12), keeping: jitter(18) };
  }
}

/** Count how many squad members occupy each outfield position (GK excluded from thinness picks). */
function positionCounts(squad: ManagerPlayer[]): Record<Pos, number> {
  const counts: Record<Pos, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of squad) counts[p.pos]++;
  return counts;
}

/** The position a squad is thinnest in (defaults to MF). */
function thinnestPosition(squad: ManagerPlayer[]): Pos {
  const counts = positionCounts(squad);
  let best: Pos = 'MF';
  let bestN = Infinity;
  (['DF', 'MF', 'FW'] as Pos[]).forEach((pos) => {
    if (counts[pos] < bestN) { bestN = counts[pos]; best = pos; }
  });
  return best;
}

/** All club ids except the user's. */
function aiClubIds(state: ManagerState): string[] {
  return Object.keys(state.squads).filter((id) => id !== state.userClubId);
}

// -------------------------------------------------------------- CPU market churn

/**
 * Keep the market alive between CPU clubs: 3-8 random trades a tick plus the
 * occasional free-agent signing by a thin AI squad. Mutates state.squads.
 * Returns human-readable news strings for the inbox.
 */
export function cpuTransferMarket(state: ManagerState, rng: Rng): string[] {
  const news: string[] = [];
  const ids = aiClubIds(state);
  if (ids.length < 2) return news;

  const iterations = rng.int(6) + 3;
  for (let i = 0; i < iterations; i++) {
    const sellerId = rng.pick(ids);
    const buyerId = rng.pick(ids);
    if (sellerId === buyerId) continue;

    const seller = state.squads[sellerId] ?? [];
    const buyer = state.squads[buyerId] ?? [];
    if (seller.length <= MIN_SQUAD + 2) continue;
    if (buyer.length >= MAX_SQUAD) continue;

    // pick from the lower 2/3 by overall, occasionally a star
    const ranked = seller
      .map((p, idx) => ({ p, idx, r: overallRating(p) }))
      .sort((a, b) => b.r - a.r);
    const starMove = rng.next() < 0.12;
    let pool: typeof ranked;
    if (starMove) {
      pool = ranked.slice(0, Math.max(1, Math.floor(ranked.length * 0.2)));
    } else {
      const cut = Math.floor(ranked.length / 3);
      pool = ranked.slice(cut);
    }
    if (!pool.length) continue;

    const chosen = rng.pick(pool);
    const fee = playerValue(chosen.p);
    seller.splice(chosen.idx, 1);
    // arriving player settles at the new club
    const arrived = chosen.p;
    arrived.form = 50;
    arrived.morale = 60;
    buyer.push(arrived);

    // trim the buyer back under the cap if it tipped over
    if (buyer.length > MAX_SQUAD) trimWeakest(buyer);

    news.push(`${chosen.p.name} joins ${clubNameOf(state, buyerId)} for ${moneyM(fee)}`);
  }

  // a thin AI squad occasionally tops up from a free agent
  for (const id of ids) {
    const squad = state.squads[id] ?? [];
    if (squad.length >= MIN_SQUAD + 1) continue;
    if (rng.next() < 0.5) continue;
    const str = clubStrength(squad);
    const pos = thinnestPosition(squad);
    const rating = clamp(str - 6 + rng.range(-4, 5), 34, 80);
    const attrs = attrsFor(pos, rating, rng);
    attrs.name = makeName(rng);
    attrs.age = 19 + rng.int(8);
    squad.push(mintPlayer(attrs, rng, rating));
    news.push(`Free agent ${attrs.name} signs for ${clubNameOf(state, id)}`);
  }

  return news;
}

/** Drop the lowest-rated squad member until the squad fits the cap. */
function trimWeakest(squad: ManagerPlayer[]): void {
  while (squad.length > MAX_SQUAD) {
    let worst = 0;
    for (let i = 1; i < squad.length; i++) {
      if (overallRating(squad[i]) < overallRating(squad[worst])) worst = i;
    }
    squad.splice(worst, 1);
  }
}

// -------------------------------------------------------------- listings

/**
 * Every CPU-club player as a browsable listing, sorted by value descending.
 * `revealed` is true once the user has scouted that player's club.
 */
export function listingsFor(state: ManagerState): ManagerTransferListing[] {
  const out: ManagerTransferListing[] = [];
  for (const clubId of Object.keys(state.squads)) {
    if (clubId === state.userClubId) continue;
    const squad = state.squads[clubId];
    for (let squadIdx = 0; squadIdx < squad.length; squadIdx++) {
      const player = squad[squadIdx];
      out.push({
        clubId,
        squadIdx,
        player,
        value: playerValue(player),
        asking: askingPrice(squad, player),
        revealed: !!state.scoutedPlayers[playerKey(clubId, player.name)],
      });
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

// -------------------------------------------------------------- bids

/**
 * Bid for a listed player. Thin wrapper over negotiateBuyPlayer; on acceptance
 * the arriving player's form/morale resets and is marked scouted. Guards against
 * a stale squad index by name match.
 */
export function makeBid(
  state: ManagerState,
  listing: { clubId: string; squadIdx: number },
  offer: number,
  rng: Rng,
): BidResult {
  const seller = state.squads[listing.clubId];
  const target = seller?.[listing.squadIdx];
  if (!target) return { status: 'blocked', message: 'Player no longer available' };

  // guard: index must still point at the same player by name
  const res = negotiateBuyPlayer(
    state.squads,
    state.userClubId,
    { teamId: listing.clubId, player: target },
    state.transferBudget,
    offer,
    rng,
    0,
  );

  if (res.status === 'accepted') {
    state.transferBudget = res.newBudget ?? state.transferBudget;
    // the arriving player is now in the user squad; settle form/morale + reveal
    const userSquad = state.squads[state.userClubId] ?? [];
    const arrived = userSquad.find((p) => p.name === target.name);
    if (arrived) {
      arrived.form = 50;
      arrived.morale = 65;
      arrived.scouted = true;
      state.scoutedPlayers[playerKey(state.userClubId, arrived.name)] = true;
    }
  }

  return {
    status: res.status,
    message: res.message,
    newBudget: res.newBudget,
    counterOffer: res.counterOffer,
  };
}

/**
 * Offer one of the user's players for transfer at an asking price. Wraps
 * negotiateSellPlayer; on acceptance the budget is credited.
 */
export function offerPlayer(
  state: ManagerState,
  squadIdx: number,
  asking: number,
  rng: Rng,
): BidResult {
  const res = negotiateSellPlayer(
    state.squads,
    state.userClubId,
    squadIdx,
    state.transferBudget,
    asking,
    rng,
  );
  if (res.status === 'accepted') {
    state.transferBudget = res.newBudget ?? state.transferBudget;
  }
  return {
    status: res.status,
    message: res.message,
    newBudget: res.newBudget,
    counterOffer: res.counterOffer,
  };
}

// -------------------------------------------------------------- free agents

/**
 * Sign a free agent into the user's squad at the thinnest position. Cost is half
 * the player's value; if the budget can't cover it nothing happens. The player is
 * aged 19-26 and rated roughly clubStrength - 6 (with spread).
 */
export function signFreeAgent(
  state: ManagerState,
  rng: Rng,
): { player: ManagerPlayer | null; cost: number } {
  const squad = state.squads[state.userClubId] ?? [];
  if (squad.length >= MAX_SQUAD) return { player: null, cost: 0 };

  const str = clubStrength(squad);
  const pos = thinnestPosition(squad);
  const rating = clamp(str - 6 + rng.range(-4, 5), 34, 82);
  const attrs = attrsFor(pos, rating, rng);
  attrs.name = makeName(rng);
  attrs.age = 19 + rng.int(8);

  const player = mintPlayer(attrs, rng, rating);
  const cost = roundMoney(playerValue(player) * 0.5);

  if (cost > state.transferBudget) return { player: null, cost: 0 };

  state.transferBudget -= cost;
  squad.push(player);
  return { player, cost };
}

/**
 * Release a player from the user squad with no compensation. No-op if the squad
 * is already at the minimum size.
 */
export function releasePlayer(state: ManagerState, squadIdx: number): void {
  const squad = state.squads[state.userClubId] ?? [];
  if (squad.length <= MIN_SQUAD) return;
  if (squadIdx < 0 || squadIdx >= squad.length) return;
  squad.splice(squadIdx, 1);
}

// -------------------------------------------------------------- youth intake

/**
 * Generate 2-4 academy players (age 16-18) for the USER club — low current
 * rating but high potential, biased toward missing positions. These are
 * RETURNED for the engine to push into the squad. Also seeds 1-2 youth into a
 * few random AI clubs so the whole league regenerates.
 */
export function youthIntake(state: ManagerState, rng: Rng): ManagerPlayer[] {
  const userSquad = state.squads[state.userClubId] ?? [];
  const str = clubStrength(userSquad);
  const out: ManagerPlayer[] = [];

  const count = 2 + rng.int(3); // 2-4
  const counts = positionCounts(userSquad);

  for (let i = 0; i < count; i++) {
    // pick a position: prefer thin ones, but let any of DF/MF/FW come through
    const positions: Pos[] = (['DF', 'MF', 'FW'] as Pos[]).sort((a, b) => counts[a] - counts[b]);
    const pos = rng.next() < 0.6 ? positions[0] : rng.pick(positions);

    const current = 44 + rng.int(15); // 44-58
    const attrs = attrsFor(pos, current, rng);
    attrs.name = makeName(rng);
    attrs.age = 16 + rng.int(3); // 16-18

    const youth: ManagerPlayer = {
      ...attrs,
      form: 50,
      morale: 65,
      fitness: 90,
      contractYears: 1 + rng.int(3),
      wage: Math.max(1, Math.round((current * current) / 90)),
      potential: clamp(str - 5 + rng.int(14), 55, 88),
    };
    out.push(youth);
    counts[pos]++;
  }

  // sprinkle 1-2 youth into a few random AI clubs to keep the league alive
  const aiIds = aiClubIds(state);
  const clubs = Math.min(aiIds.length, 2 + rng.int(3)); // a few clubs
  for (let c = 0; c < clubs; c++) {
    const id = rng.pick(aiIds);
    const squad = state.squads[id] ?? [];
    if (squad.length >= MAX_SQUAD) continue;
    const aiStr = clubStrength(squad);
    const n = 1 + rng.int(2); // 1-2
    for (let i = 0; i < n; i++) {
      const pos = rng.pick<Pos>(['DF', 'MF', 'FW']);
      const current = 44 + rng.int(15);
      const attrs = attrsFor(pos, current, rng);
      attrs.name = makeName(rng);
      attrs.age = 16 + rng.int(3);
      squad.push({
        ...attrs,
        form: 50,
        morale: 60,
        fitness: 90,
        contractYears: 1 + rng.int(3),
        wage: Math.max(1, Math.round((current * current) / 90)),
        potential: clamp(aiStr - 5 + rng.int(14), 55, 88),
      });
    }
  }

  return out;
}

// -------------------------------------------------------------- scouting

/**
 * Assign a scout to a target club (max 3 concurrent, no duplicate targets).
 * Each assignment takes 2 weeks to complete.
 */
export function assignScout(state: ManagerState, targetClubId: string): void {
  if (state.scoutAssignments.length >= 3) return;
  if (state.scoutAssignments.some((a) => a.targetClubId === targetClubId)) return;
  state.scoutAssignments.push({
    id: `scout_${state.scoutAssignments.length + 1}_${targetClubId}`,
    targetClubId,
    weeksLeft: 2,
  });
}

/**
 * Tick every active scouting assignment one week forward. Completed assignments
 * reveal all of the target club's players and emit a report string. Returns the
 * report strings for the inbox.
 */
export function tickScouting(state: ManagerState, rng: Rng): string[] {
  void rng; // deterministic; no rng needed for reveals
  const reports: string[] = [];
  const remaining = [];
  for (const assignment of state.scoutAssignments) {
    assignment.weeksLeft -= 1;
    if (assignment.weeksLeft > 0) {
      remaining.push(assignment);
      continue;
    }
    const squad = state.squads[assignment.targetClubId] ?? [];
    for (const p of squad) {
      state.scoutedPlayers[playerKey(assignment.targetClubId, p.name)] = true;
      p.scouted = true;
    }
    reports.push(
      `Scout report in: ${clubNameOf(state, assignment.targetClubId)} — ${squad.length} players assessed.`,
    );
  }
  state.scoutAssignments = remaining;
  return reports;
}
