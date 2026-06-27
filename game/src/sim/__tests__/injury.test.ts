import { describe, expect, it } from 'vitest';
import { rollInjury, injuryMatchesOut } from '../injury';

// deterministic rng stub: returns the queued values in order
const seq = (...vals: number[]) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

describe('rollInjury', () => {
  it('no injury when the chance roll misses', () => {
    // first rng() is the "does it happen" roll; 0.99 > any chance → none
    expect(rollInjury({ contactSeverity: 1, fromBehind: true, nonContact: false, rng: seq(0.99) })).toBe('none');
  });
  it('a reckless from-behind foul injures more readily than a soft one', () => {
    // chance(reckless) ~0.02+0.07+0.04=0.13; chance(soft, sev 0.2)=0.02+0.014=0.034
    const reckless = rollInjury({ contactSeverity: 1, fromBehind: true, nonContact: false, rng: seq(0.10, 0.0) });
    const soft = rollInjury({ contactSeverity: 0.2, fromBehind: false, nonContact: false, rng: seq(0.10, 0.0) });
    expect(reckless).not.toBe('none'); // 0.10 < 0.13 → injures
    expect(soft).toBe('none');         // 0.10 > 0.034 → no injury
  });
  it('tier split: low→knock, mid→forcedOff, high→serious', () => {
    expect(rollInjury({ contactSeverity: 1, fromBehind: true, nonContact: false, rng: seq(0.0, 0.5) })).toBe('knock');
    expect(rollInjury({ contactSeverity: 1, fromBehind: true, nonContact: false, rng: seq(0.0, 0.80) })).toBe('forcedOff');
    expect(rollInjury({ contactSeverity: 1, fromBehind: true, nonContact: false, rng: seq(0.0, 0.99) })).toBe('serious');
  });
  it('non-contact is very rare', () => {
    expect(rollInjury({ contactSeverity: 0, fromBehind: false, nonContact: true, rng: seq(0.01) })).toBe('none'); // 0.01 > ~0.0015
    expect(rollInjury({ contactSeverity: 0, fromBehind: false, nonContact: true, rng: seq(0.0, 0.5) })).toBe('knock');
  });
});

describe('injuryMatchesOut', () => {
  it('forcedOff = 1 match, serious = 2-3, others 0', () => {
    expect(injuryMatchesOut('forcedOff', () => 0.5)).toBe(1);
    expect(injuryMatchesOut('serious', () => 0.0)).toBe(2);
    expect(injuryMatchesOut('serious', () => 0.99)).toBe(3);
    expect(injuryMatchesOut('knock', () => 0.5)).toBe(0);
    expect(injuryMatchesOut('none', () => 0.5)).toBe(0);
  });
});
