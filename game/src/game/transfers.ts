import type { PlayerAttrs } from '../sim/types';
import { overallRating } from '../sim/formations';
import { Rng } from '../sim/rng';

/** Transfer value in £k, 1992 money. Stars ~£3.5M, squad players ~£200k. */
export function playerValue(p: PlayerAttrs): number {
  const r = overallRating(p);
  const base = Math.pow(Math.max(0, r - 40) / 55, 2.6) * 3600 + 60;
  // age curve peaks ~25
  const ageF = p.age <= 21 ? 1.15 : p.age <= 26 ? 1.0 : p.age <= 29 ? 0.85 : p.age <= 32 ? 0.6 : 0.35;
  return Math.round(base * ageF / 10) * 10;
}

export function clubBudget(strength: number): number {
  return Math.round((Math.max(0, strength - 52) * 95 + 800) / 50) * 50; // £k
}

export interface TransferListing {
  teamId: string;
  squadIdx: number;
  player: PlayerAttrs;
  value: number;
}

export interface TransferNews {
  text: string;
}

export type TransferNegotiationStatus = 'accepted' | 'counter' | 'rejected' | 'blocked';

export interface TransferNegotiationResult {
  status: TransferNegotiationStatus;
  message: string;
  newBudget?: number;
  counterOffer?: number;
  round: number;
}

/** AI clubs occasionally trade among themselves for flavour. Mutates squads. */
export function aiTransferChurn(
  squads: Record<string, PlayerAttrs[]>,
  userTeamId: string,
  rng: Rng,
  count = 4,
): TransferNews[] {
  const news: TransferNews[] = [];
  const ids = Object.keys(squads).filter((id) => id !== userTeamId);
  for (let i = 0; i < count; i++) {
    const fromId = ids[rng.int(ids.length)];
    const toId = ids[rng.int(ids.length)];
    if (fromId === toId) continue;
    const from = squads[fromId];
    const to = squads[toId];
    if (from.length <= 15 || to.length >= MAX_SQUAD) continue;
    // sell a mid-rated player
    const ranked = from.map((p, idx) => ({ p, idx, r: overallRating(p) })).sort((a, b) => b.r - a.r);
    const pickFrom = ranked.slice(Math.min(8, ranked.length - 1));
    if (!pickFrom.length) continue;
    const chosen = pickFrom[rng.int(pickFrom.length)];
    from.splice(chosen.idx, 1);
    to.push(chosen.p);
    news.push({ text: `${chosen.p.name} joins for £${(playerValue(chosen.p) / 1000).toFixed(2)}M` });
  }
  return news;
}

export function marketListings(
  squads: Record<string, PlayerAttrs[]>,
  userTeamId: string,
): TransferListing[] {
  const out: TransferListing[] = [];
  for (const [teamId, squad] of Object.entries(squads)) {
    if (teamId === userTeamId) continue;
    squad.forEach((player, squadIdx) => {
      out.push({ teamId, squadIdx, player, value: playerValue(player) });
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

export const MIN_SQUAD = 14;
export const MAX_SQUAD = 27;

export function askingPrice(sellerSquad: PlayerAttrs[], player: PlayerAttrs): number {
  const value = playerValue(player);
  const ranked = sellerSquad
    .map((p) => ({ name: p.name, rating: overallRating(p) }))
    .sort((a, b) => b.rating - a.rating);
  const rank = ranked.findIndex((p) => p.name === player.name);
  const importance = rank >= 0 && rank < 6 ? 1.28 : rank >= 0 && rank < 11 ? 1.14 : 1;
  const thinSquad = sellerSquad.length <= MIN_SQUAD + 2 ? 1.18 : 1;
  const agePremium = player.age <= 23 ? 1.1 : player.age >= 31 ? 0.9 : 1;
  return roundMoney(value * importance * thinSquad * agePremium);
}

export function negotiateBuyPlayer(
  squads: Record<string, PlayerAttrs[]>,
  userTeamId: string,
  listing: { teamId: string; player: PlayerAttrs },
  budget: number,
  offer: number,
  rng: Rng,
  round = 0,
): TransferNegotiationResult {
  const seller = squads[listing.teamId];
  const buyer = squads[userTeamId];
  if (!seller || !buyer) return { status: 'blocked', message: 'Club not found', round };
  const idx = seller.findIndex((p) => p.name === listing.player.name);
  if (idx < 0) return { status: 'blocked', message: 'Player already moved on', round };
  if (buyer.length >= MAX_SQUAD) return { status: 'blocked', message: 'Your squad is full', round };
  if (seller.length <= MIN_SQUAD) return { status: 'blocked', message: 'Selling club refuses to weaken its squad', round };

  const player = seller[idx];
  const ask = askingPrice(seller, player);
  const bid = roundMoney(offer);
  if (budget < bid) return { status: 'blocked', message: 'Not enough budget for that bid', round };

  const patience = Math.max(0.78, 0.94 - round * 0.05);
  const minAccept = roundMoney(ask * patience);
  const relationshipNudge = round === 0 ? 0.96 + rng.next() * 0.08 : 1;
  if (bid >= minAccept * relationshipNudge) {
    const [signed] = seller.splice(idx, 1);
    buyer.push(signed);
    return {
      status: 'accepted',
      message: `${signed.name} signs for £${(bid / 1000).toFixed(2)}M`,
      newBudget: budget - bid,
      round: round + 1,
    };
  }

  if (round >= 2 || bid < ask * 0.62) {
    return {
      status: 'rejected',
      message: `${player.name}'s club rejects the offer`,
      counterOffer: roundMoney(ask * 1.02),
      round: round + 1,
    };
  }

  const gap = ask - bid;
  return {
    status: 'counter',
    message: `${player.name}'s club wants £${((bid + gap * 0.72) / 1000).toFixed(2)}M`,
    counterOffer: roundMoney(bid + gap * 0.72),
    round: round + 1,
  };
}

export function negotiateSellPlayer(
  squads: Record<string, PlayerAttrs[]>,
  userTeamId: string,
  squadIdx: number,
  budget: number,
  asking: number,
  rng: Rng,
): TransferNegotiationResult {
  const squad = squads[userTeamId];
  if (!squad || !squad[squadIdx]) return { status: 'blocked', message: 'Player not found', round: 0 };
  if (squad.length <= MIN_SQUAD) return { status: 'blocked', message: 'Squad too small to sell', round: 0 };
  const player = squad[squadIdx];
  const value = playerValue(player);
  const bid = roundMoney(Math.min(asking, value * 1.08));
  const minAccept = roundMoney(value * (0.82 + rng.next() * 0.12));
  if (bid < minAccept) {
    return {
      status: 'counter',
      message: `Best offer for ${player.name} is £${(minAccept / 1000).toFixed(2)}M`,
      counterOffer: minAccept,
      round: 1,
    };
  }
  const [sold] = squad.splice(squadIdx, 1);
  const ids = Object.keys(squads).filter((id) => id !== userTeamId && squads[id].length < MAX_SQUAD);
  if (ids.length) squads[ids[rng.int(ids.length)]].push(sold);
  return {
    status: 'accepted',
    message: `${sold.name} leaves for £${(bid / 1000).toFixed(2)}M`,
    newBudget: budget + bid,
    round: 1,
  };
}

/** Buy: returns new budget or null if not allowed. Mutates squads. */
export function buyPlayer(
  squads: Record<string, PlayerAttrs[]>,
  userTeamId: string,
  listing: { teamId: string; player: PlayerAttrs },
  budget: number,
): number | null {
  const seller = squads[listing.teamId];
  const buyer = squads[userTeamId];
  const idx = seller.findIndex((p) => p.name === listing.player.name);
  if (idx < 0) return null;
  const value = playerValue(seller[idx]);
  if (budget < value) return null;
  if (buyer.length >= MAX_SQUAD) return null;
  if (seller.length <= MIN_SQUAD) return null;
  const [p] = seller.splice(idx, 1);
  buyer.push(p);
  return budget - value;
}

/** Sell from the user squad at 90% of value. Returns new budget or null. */
export function sellPlayer(
  squads: Record<string, PlayerAttrs[]>,
  userTeamId: string,
  squadIdx: number,
  budget: number,
  rng: Rng,
): number | null {
  const squad = squads[userTeamId];
  if (squad.length <= MIN_SQUAD) return null;
  const [p] = squad.splice(squadIdx, 1);
  // player moves to a random AI club with space
  const ids = Object.keys(squads).filter((id) => id !== userTeamId && squads[id].length < MAX_SQUAD);
  if (ids.length) squads[ids[rng.int(ids.length)]].push(p);
  return budget + Math.round(playerValue(p) * 0.9);
}

function roundMoney(value: number): number {
  return Math.max(10, Math.round(value / 10) * 10);
}
