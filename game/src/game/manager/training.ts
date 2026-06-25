/**
 * Football World — MANAGER MODE training: between-match training ticks and the
 * off-season ageing & development pass. Pure data + logic — no DOM, no engine.
 *
 * applyTrainingTick runs once per matchday on the user's squad (fitness/form
 * recovery plus a subtle focus-driven attribute nudge). ageAndDevelopOffseason
 * runs once at season rollover across EVERY club's squad so the whole world ages.
 */
import { Rng } from '../../sim/rng';
import { overallRating } from '../../sim/formations';
import type { ManagerPlayer, ManagerState, TrainingFocus } from './types';
import { clamp } from './types';

/** Squad floor: never release a player (age or contract) below this size. */
const MIN_SQUAD = 16;
/** Squad cap: release the lowest-rated surplus above this after development. */
const MAX_SQUAD = 30;
/** Veterans are removed once they reach this age. */
const RETIRE_AGE = 38;

/** The trainable outfield attributes (keeping is handled positionally). */
type AttrKey = 'pace' | 'pass' | 'shoot' | 'tackle' | 'keeping';

const ATTR_KEYS: AttrKey[] = ['pace', 'pass', 'shoot', 'tackle', 'keeping'];

/** Set the user club's current training focus (stored on state, read each tick). */
export function setTrainingFocus(state: ManagerState, focus: TrainingFocus): void {
  state.trainingFocus = focus;
}

/**
 * Between-match training tick for the USER club: fitness recovery, form settling
 * toward neutral, and a small chance to nudge one relevant attribute of one
 * eligible player upward (never above potential). Effects are deliberately subtle.
 */
export function applyTrainingTick(state: ManagerState, rng: Rng): void {
  const squad = state.squads[state.userClubId];
  if (!squad || !squad.length) return;

  for (const p of squad) {
    // fitness bounces back between matches
    p.fitness = clamp(p.fitness + rng.range(3, 8));
    // form drifts toward 50 by roughly one point
    p.form = clamp(p.form + (p.form < 50 ? 1 : p.form > 50 ? -1 : 0));
  }

  switch (state.trainingFocus) {
    case 'fitness':
      // conditioning: no attribute nudge, just extra fitness across the group
      for (const p of squad) p.fitness = clamp(p.fitness + rng.range(2, 5));
      break;

    case 'balanced': {
      // a random starter's weakest attribute ticks up
      const starter = pickStarter(squad, rng);
      if (starter) nudgeWeakest(starter, rng, 1);
      break;
    }

    case 'attacking': {
      // a forward or midfielder sharpens shooting or pace
      const eligible = squad.filter((p) => p.pos === 'FW' || p.pos === 'MF');
      const p = pickEligible(eligible, rng);
      if (p) nudgeAttr(p, rng.next() < 0.5 ? 'shoot' : 'pace', 1);
      break;
    }

    case 'defensive': {
      // a defender or keeper tightens up at the back
      const eligible = squad.filter((p) => p.pos === 'DF' || p.pos === 'GK');
      const p = pickEligible(eligible, rng);
      if (p) nudgeAttr(p, p.pos === 'GK' ? 'keeping' : 'tackle', 1);
      break;
    }

    case 'technical': {
      // a midfielder hones their passing
      const eligible = squad.filter((p) => p.pos === 'MF');
      const p = pickEligible(eligible, rng);
      if (p) nudgeAttr(p, 'pass', 1);
      break;
    }

    case 'youth': {
      // a youngster's weakest attribute creeps toward their potential
      const eligible = squad.filter((p) => p.age < 23);
      const p = pickEligible(eligible, rng);
      if (p) nudgeWeakest(p, rng, 1);
      break;
    }
  }
}

/**
 * Off-season ageing & development, applied to EVERY club's squad so the world
 * ages in step: another year on the clock, contracts run down, veterans retire,
 * the old decline, the young grow, and oversized squads are trimmed. Mutates
 * state.squads in place.
 */
export function ageAndDevelopOffseason(state: ManagerState, rng: Rng): void {
  for (const clubId of Object.keys(state.squads)) {
    let squad = state.squads[clubId];
    if (!squad) continue;

    // 1. age everyone, retire veterans, then age/develop the survivors
    const living: ManagerPlayer[] = [];
    for (const p of squad) {
      p.age += 1;
      p.contractYears = Math.max(0, (p.contractYears ?? 0) - 1);
      if (p.age >= RETIRE_AGE) continue; // retired

      // ageing decline: pace erodes past 30, defensive/keeping sharpness past 33
      if (p.age > 30 && rng.next() < 0.5) p.pace = clamp(p.pace - 1, 20, 99);
      if (p.age > 33) {
        if (p.pos === 'GK') {
          if (rng.next() < 0.5) p.keeping = clamp(p.keeping - 1, 20, 99);
        } else if (rng.next() < 0.5) {
          p.tackle = clamp(p.tackle - 1, 20, 99);
        }
      }

      // youth growth: the young improve toward (and just past) their potential
      if (p.age < 24) {
        nudgeWeakest(p, rng, 1 + rng.int(3)); // rng.int(3) -> 0..2, so +1..+3
        if (p.age < 21) p.potential = clamp(p.potential + (rng.next() < 0.3 ? 1 : 0), 1, 99);
      }

      living.push(p);
    }

    // 2. expired contracts leave — but never drop the squad below the floor
    const kept: ManagerPlayer[] = [];
    const slotsAboveFloor = Math.max(0, living.length - MIN_SQUAD);
    let dropped = 0;
    for (const p of living) {
      if (p.contractYears <= 0 && dropped < slotsAboveFloor) {
        dropped++;
        continue; // released on a free
      }
      kept.push(p);
    }
    squad = kept;

    // 3. cap squad size: release the lowest-rated surplus
    if (squad.length > MAX_SQUAD) {
      const order = squad
        .map((p, idx) => ({ idx, r: overallRating(p) }))
        .sort((a, b) => a.r - b.r);
      const dropCount = squad.length - MAX_SQUAD;
      const dropIdx = new Set(order.slice(0, dropCount).map((o) => o.idx));
      squad = squad.filter((_, idx) => !dropIdx.has(idx));
    }

    state.squads[clubId] = squad;
  }
}

// -------------------------------------------------------------- internals

/** 50/50 gate: return a random eligible player, or undefined if the roll fails / pool empty. */
function pickEligible(eligible: ManagerPlayer[], rng: Rng): ManagerPlayer | undefined {
  if (!eligible.length) return undefined;
  if (rng.next() >= 0.5) return undefined;
  return rng.pick(eligible);
}

/** A starter for the 'balanced' focus: best-rated XI, pick one at random. */
function pickStarter(squad: ManagerPlayer[], rng: Rng): ManagerPlayer | undefined {
  if (!squad.length) return undefined;
  if (rng.next() >= 0.5) return undefined;
  const starters = squad
    .slice()
    .sort((a, b) => overallRating(b) - overallRating(a))
    .slice(0, Math.min(11, squad.length));
  return rng.pick(starters);
}

/** Bump a single named attribute by `amount`, clamped under the player's potential. */
function nudgeAttr(p: ManagerPlayer, key: AttrKey, amount: number): void {
  const ceiling = Math.max(p.potential, overallRating(p) + amount);
  p[key] = clamp(Math.min(p[key] + amount, ceiling), 1, 99);
}

/** Grow the player's lowest attribute by `amount` (rng-driven), never above potential. */
function nudgeWeakest(p: ManagerPlayer, rng: Rng, maxAmount: number): void {
  const amount = maxAmount <= 1 ? maxAmount : 1 + rng.int(maxAmount); // 1..maxAmount
  // goalkeepers grow their keeping; outfielders grow their weakest outfield attr
  const keys: AttrKey[] = p.pos === 'GK' ? ['keeping'] : ATTR_KEYS.filter((k) => k !== 'keeping');
  let weakest: AttrKey = keys[0];
  for (const k of keys) if (p[k] < p[weakest]) weakest = k;
  nudgeAttr(p, weakest, amount);
}
