/** Pure momentum math for the in-match momentum system. Stateless — `matchSim`
 * owns the state and feeds context in. See docs/superpowers/specs/2026-06-26-contextual-momentum-design.md */

export const MATCH_MOMENTUM_MIN = -12;
export const MATCH_MOMENTUM_MAX = 12;
/** momentum × this is added to every effective attribute. ~±4.5 at full momentum. */
export const MATCH_MOMENTUM_ATTR_SCALE = 0.38;
/** two-quick-goals burst: window (match-minutes) and the momentum bonus added to a burst goal */
export const BURST_WINDOW_MIN = 5;
export const BURST_BONUS = 2.5;

export function clampMomentum(v: number): number {
  return Math.max(MATCH_MOMENTUM_MIN, Math.min(MATCH_MOMENTUM_MAX, v));
}

/** Positive ⇒ `myStrength` is the underdog (opponent stronger). 65–92 strength scale,
 * normalised by 16 (a full division) and clamped to ±1. */
export function underdogFactor(myStrength: number, oppStrength: number): number {
  return Math.max(-1, Math.min(1, (oppStrength - myStrength) / 16));
}

export interface MomentumEventCtx {
  /** current match minute (1..120) */
  minute: number;
  /** score[team] − score[opp] AFTER the goal increment (goal events only; else 0) */
  scoreDiffAfter: number;
  /** momentum[team] − momentum[opp] BEFORE this event is applied */
  momentumGap: number;
  /** underdogFactor for the event's team; positive = underdog */
  underdog: number;
  /** event power for shots, 0..~1 */
  power: number;
  /** dangerous tackle flag */
  danger: boolean;
  /** this goal landed within the burst window of the team's previous goal */
  burstGoal?: boolean;
}

/** Momentum change for the event's team (`self`) and its opponent (`opp`). */
export interface MomentumSwing { self: number; opp: number }

/** Momentum hit (≤ 0) for withdrawing a player of `offOverall` (sum of pace+pass+
 * shoot+tackle) given his team's on-pitch outfield overalls. Zero unless he is clearly
 * above average; scales toward the team's best; capped at −3; softened for a
 * game-management sub (comfortably ahead, late). */
export function substitutionMomentumLoss(
  offOverall: number,
  outfieldOveralls: number[],
  scoreDiff: number,
  minute: number,
): number {
  if (outfieldOveralls.length === 0) return 0;
  const avg = outfieldOveralls.reduce((a, b) => a + b, 0) / outfieldOveralls.length;
  const max = Math.max(...outfieldOveralls);
  const aboveAvg = offOverall - avg;
  if (aboveAvg <= 0) return 0;
  const topFrac = max > avg ? aboveAvg / (max - avg) : 0; // 0..1, 1 = the team's best
  let loss = Math.min(3, aboveAvg * 0.06) * topFrac;
  if (scoreDiff > 0 && minute >= 70) loss *= 0.4; // game management, not a blow
  return -loss;
}

export function eventMomentumDelta(type: string, ctx: MomentumEventCtx): MomentumSwing {
  const drag = (self: number, frac: number): MomentumSwing => ({ self, opp: -self * frac });
  const underBoost = 1 + 0.6 * Math.max(0, ctx.underdog);
  switch (type) {
    case 'goal': {
      const againstRun = ctx.momentumGap < -1.5 ? 1.4 : 0;
      const scorePressure = ctx.scoreDiffAfter <= 0 ? 0.35 : 0;
      let self = 3.9 + againstRun + scorePressure;
      // Late comeback: scoring side was 1–2 down (now level or within one) in the last 20'.
      if (ctx.minute >= 70 && (ctx.scoreDiffAfter === 0 || ctx.scoreDiffAfter === -1)) {
        self += ctx.scoreDiffAfter === 0 ? 5 : 3.5; // levelling surges hardest
      }
      // Sucker-punch timing: right before the break or very late stings a little more.
      if ((ctx.minute >= 43 && ctx.minute <= 45) || ctx.minute >= 88) self += 0.8;
      // Two quick goals: a flurry surges momentum. Added before the snowball damper, so a
      // burst that equalises/takes the lead surges fully, but one padding a 2+ lead is damped.
      if (ctx.burstGoal) self += BURST_BONUS;
      // Don't let a side that's already comfortably ahead snowball: extending a 2+ goal
      // lead gives progressively less momentum (a 3-0 barely registers), while a first
      // goal, equaliser, or comeback keeps full force (those have scoreDiffAfter <= 1).
      // This also shrinks the opponent drag (derived from self), so a blown-out underdog
      // isn't buried further.
      if (ctx.scoreDiffAfter >= 2) {
        self *= Math.max(0.15, 1 - (ctx.scoreDiffAfter - 1) * 0.4);
      }
      return drag(self, 0.68);
    }
    case 'shot':
    case 'header':
      return drag(0.24 + ctx.power * 0.16, 0.18);
    case 'save':
      return drag(0.62 * underBoost, 0.22);
    case 'tackle':
      return drag((ctx.danger ? 0.68 : 0.16) * (ctx.danger ? underBoost : 1), ctx.danger ? 0.24 : 0.1);
    case 'redCard':
      return { self: -3.2, opp: 4.2 };
    case 'penMissed':
      return { self: -1.5, opp: 2.2 };
    case 'penalty':
      return drag(0.8, 0.1);
    case 'post':
      return drag(0.5, 0.1);
    default:
      return { self: 0, opp: 0 };
  }
}
