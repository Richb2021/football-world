import { describe, expect, it } from 'vitest';
import {
  eraRulesForYear,
  formationPairForYear,
  substitutionsForYear,
} from '../eraRules';

describe('era rules', () => {
  it('maps substitution limits to the match era', () => {
    expect(substitutionsForYear(1930)).toBe(0);
    expect(substitutionsForYear(1966)).toBe(0);
    expect(substitutionsForYear(1994)).toBe(2);
    expect(substitutionsForYear(2006)).toBe(3);
    expect(substitutionsForYear(2026)).toBe(5);
  });

  it('disables modern fireworks for historic eras', () => {
    expect(eraRulesForYear(1909).fireworks).toBe(false);
    expect(eraRulesForYear(1930).fireworks).toBe(false);
    expect(eraRulesForYear(1966).fireworks).toBe(false);
    expect(eraRulesForYear(1998).fireworks).toBe(false);
    expect(eraRulesForYear(2022).fireworks).toBe(false);
    expect(eraRulesForYear(2026).fireworks).toBe(true);
  });

  it('selects historically appropriate default formation pairs', () => {
    expect(formationPairForYear(1872)).toEqual(['2-3-5', '2-3-5']);
    expect(formationPairForYear(1934)).toEqual(['w-m', 'w-m']);
    expect(formationPairForYear(1958)).toEqual(['4-2-4', 'w-m']);
    expect(formationPairForYear(1982)).toEqual(['4-2-2-2', '4-3-3']);
    expect(formationPairForYear(2026)).toEqual(['4-2-3-1', '4-3-3']);
  });
});
