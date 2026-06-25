import { Rng } from './rng';

/** Quick statistical result for AI-vs-AI fixtures. Strengths 30-95. */
export function simulateFixture(
  homeStrength: number,
  awayStrength: number,
  rng: Rng,
): [number, number] {
  const diff = homeStrength + 4.5 - awayStrength; // home advantage
  const homeXg = 1.35 + diff * 0.035;
  const awayXg = 1.05 - diff * 0.028;
  return [poisson(Math.max(0.15, homeXg), rng), poisson(Math.max(0.12, awayXg), rng)];
}

/** Knockout tie: returns winner index (0=home) after notional ET/pens if level. */
export function simulateKnockout(
  homeStrength: number,
  awayStrength: number,
  rng: Rng,
): { score: [number, number]; etPens: boolean; winner: 0 | 1 } {
  const score = simulateFixture(homeStrength, awayStrength, rng);
  if (score[0] !== score[1]) return { score, etPens: false, winner: score[0] > score[1] ? 0 : 1 };
  // extra time goals occasionally
  if (rng.next() < 0.42) {
    const edge = (homeStrength - awayStrength) / 200 + 0.5;
    const w = rng.next() < edge ? 0 : 1;
    score[w]++;
    return { score: [score[0], score[1]], etPens: true, winner: w as 0 | 1 };
  }
  // penalties: slight edge to stronger side
  const edge = (homeStrength - awayStrength) / 300 + 0.5;
  return { score, etPens: true, winner: rng.next() < edge ? 0 : 1 };
}

function poisson(lambda: number, rng: Rng): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L && k < 9);
  return k - 1;
}
