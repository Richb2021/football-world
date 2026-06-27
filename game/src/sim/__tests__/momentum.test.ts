import { describe, expect, it } from 'vitest';
import {
  MATCH_MOMENTUM_MIN, MATCH_MOMENTUM_MAX, MATCH_MOMENTUM_ATTR_SCALE,
  clampMomentum, underdogFactor, substitutionMomentumLoss,
  eventMomentumDelta, type MomentumEventCtx,
} from '../momentum';

describe('momentum primitives', () => {
  it('exposes the bounded effect scale', () => {
    expect(MATCH_MOMENTUM_MIN).toBe(-12);
    expect(MATCH_MOMENTUM_MAX).toBe(12);
    expect(MATCH_MOMENTUM_ATTR_SCALE).toBeCloseTo(0.38, 5);
  });

  it('clamps momentum into range', () => {
    expect(clampMomentum(20)).toBe(12);
    expect(clampMomentum(-20)).toBe(-12);
    expect(clampMomentum(3.5)).toBe(3.5);
  });

  it('underdogFactor is positive when the opponent is stronger and clamps to ±1', () => {
    expect(underdogFactor(72, 88)).toBeCloseTo(1, 5);   // 16 gap → +1
    expect(underdogFactor(88, 72)).toBeCloseTo(-1, 5);  // favourite
    expect(underdogFactor(80, 80)).toBe(0);
    expect(underdogFactor(60, 92)).toBe(1);             // clamped
  });
});

const baseCtx = (over: Partial<MomentumEventCtx> = {}): MomentumEventCtx => ({
  minute: 30, scoreDiffAfter: 0, momentumGap: 0, underdog: 0, power: 0, danger: false, ...over,
});

describe('eventMomentumDelta', () => {
  it('a goal swings the scorer up and drags the opponent down', () => {
    const s = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 1, momentumGap: 0 }));
    expect(s.self).toBeCloseTo(3.9, 5);     // base, no against-run, scorePressure 0 (ahead)
    expect(s.opp).toBeCloseTo(-3.9 * 0.68, 5);
  });

  it('a goal against the run of play adds an extra swing', () => {
    const s = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 1, momentumGap: -4 }));
    expect(s.self).toBeCloseTo(3.9 + 1.4, 5);
  });

  it('a red card swings asymmetrically toward the opponent', () => {
    const s = eventMomentumDelta('redCard', baseCtx());
    expect(s.self).toBeCloseTo(-3.2, 5);
    expect(s.opp).toBeCloseTo(4.2, 5);
  });

  it('a save by the underdog is worth more than by the favourite', () => {
    const dog = eventMomentumDelta('save', baseCtx({ underdog: 1 }));
    const fav = eventMomentumDelta('save', baseCtx({ underdog: -1 }));
    expect(dog.self).toBeGreaterThan(fav.self);
    expect(fav.self).toBeCloseTo(0.62, 5); // favourite gets the plain base
  });

  it('a missed/saved penalty swings to the defending team', () => {
    const s = eventMomentumDelta('penMissed', baseCtx());
    expect(s.self).toBeCloseTo(-1.5, 5);
    expect(s.opp).toBeCloseTo(2.2, 5);
  });
});

describe('late comeback goals', () => {
  it('an 80th-minute equaliser surges much harder than a routine goal', () => {
    const routine = eventMomentumDelta('goal', baseCtx({ minute: 30, scoreDiffAfter: 0 }));
    const equaliser = eventMomentumDelta('goal', baseCtx({ minute: 80, scoreDiffAfter: 0 }));
    expect(equaliser.self).toBeGreaterThan(routine.self + 4);
  });

  it('the comeback surge switches on exactly at minute 70', () => {
    const at69 = eventMomentumDelta('goal', baseCtx({ minute: 69, scoreDiffAfter: 0 }));
    const at70 = eventMomentumDelta('goal', baseCtx({ minute: 70, scoreDiffAfter: 0 }));
    expect(at70.self).toBeGreaterThan(at69.self + 4); // +5 surge appears at 70, not before
  });

  it('pulling one back to within a goal late still surges, but less than levelling', () => {
    const within = eventMomentumDelta('goal', baseCtx({ minute: 80, scoreDiffAfter: -1 }));
    const level = eventMomentumDelta('goal', baseCtx({ minute: 80, scoreDiffAfter: 0 }));
    expect(within.self).toBeGreaterThan(4);
    expect(level.self).toBeGreaterThan(within.self);
  });

  it('does not surge for a go-ahead goal or an early goal', () => {
    const goAhead = eventMomentumDelta('goal', baseCtx({ minute: 80, scoreDiffAfter: 1 }));
    const early = eventMomentumDelta('goal', baseCtx({ minute: 20, scoreDiffAfter: 0 }));
    expect(goAhead.self).toBeLessThan(5);
    expect(early.self).toBeLessThan(5);
  });
});

describe('snowball dampening', () => {
  it('damps goals that extend a 2+ lead, but not the first goal or a comeback', () => {
    const first = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 1, minute: 30 }));   // 0-0 -> 1-0
    const extend2 = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 2, minute: 30 })); // 1-0 -> 2-0
    const extend4 = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 4, minute: 30 })); // 3-0 -> 4-0
    expect(extend2.self).toBeLessThan(first.self);
    expect(extend4.self).toBeLessThan(extend2.self);
    // the opponent drag shrinks too (less negative) when the lead is extended
    expect(extend2.opp).toBeGreaterThan(first.opp);
    // a late equaliser is never damped — its surge stands well above a first goal
    const equaliser = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 0, minute: 80 }));
    expect(equaliser.self).toBeGreaterThan(first.self);
  });
});

describe('post event', () => {
  it('hitting the post gives the attacking side a small lift', () => {
    const s = eventMomentumDelta('post', baseCtx());
    expect(s.self).toBeCloseTo(0.5, 5);
    expect(s.opp).toBeLessThan(0);
  });
});

describe('two-quick-goals burst', () => {
  it('a burst goal adds +2.5, and the burst is damped when it pads a 2+ lead', () => {
    const normal = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 0, minute: 30 }));
    const burst = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 0, minute: 30, burstGoal: true }));
    expect(burst.self).toBeCloseTo(normal.self + 2.5, 5);
    // padding a 2+ lead: both base and the +2.5 burst get the snowball damper
    const padNormal = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 3, minute: 30 }));
    const padBurst = eventMomentumDelta('goal', baseCtx({ scoreDiffAfter: 3, minute: 30, burstGoal: true }));
    expect(padBurst.self - padNormal.self).toBeLessThan(2.5); // burst bonus shrunk by the damper
    expect(padBurst.self - padNormal.self).toBeGreaterThan(0); // but still positive
  });
});

describe('substitution momentum loss', () => {
  const squad = [380, 360, 340, 320, 300, 300, 280, 260, 240, 220]; // outfield overalls

  it('taking off the best player costs momentum', () => {
    expect(substitutionMomentumLoss(380, squad, 0, 60)).toBeLessThan(-1);
  });

  it('taking off a squad/below-average player is ~free', () => {
    expect(substitutionMomentumLoss(240, squad, 0, 60)).toBe(0);
  });

  it('is capped and softened when comfortably ahead late', () => {
    const blow = substitutionMomentumLoss(380, squad, 0, 60);
    const managed = substitutionMomentumLoss(380, squad, 2, 80);
    expect(blow).toBeGreaterThanOrEqual(-3);
    expect(managed).toBeGreaterThan(blow); // less negative
  });
});
