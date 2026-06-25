import type { FormationId, MatchEra } from '../sim/types';

export function substitutionsForYear(year: number): number {
  if (year < 1970) return 0;
  if (year < 2000) return 2;
  if (year < 2020) return 3;
  return 5;
}

export function fireworksForYear(year: number): boolean {
  return year >= 2026;
}

export function formationPairForYear(year: number): [FormationId, FormationId] {
  if (year < 1925) return ['2-3-5', '2-3-5'];
  if (year < 1958) return ['w-m', 'w-m'];
  if (year < 1962) return ['4-2-4', 'w-m'];
  if (year < 1974) return ['4-3-3', '4-4-2'];
  if (year < 1982) return ['4-3-3', '4-3-3'];
  if (year < 1986) return ['4-2-2-2', '4-3-3'];
  if (year < 1994) return ['3-5-2', '4-4-2'];
  if (year < 1998) return ['4-4-2', '4-4-2'];
  if (year < 2002) return ['4-3-2-1', '4-2-2-2'];
  if (year < 2006) return ['3-4-1-2', '3-5-2'];
  if (year < 2010) return ['4-3-2-1', '4-2-3-1'];
  return ['4-2-3-1', '4-3-3'];
}

export function eraRulesForYear(year: number): MatchEra {
  return {
    year,
    substitutionLimit: substitutionsForYear(year),
    fireworks: fireworksForYear(year),
  };
}
