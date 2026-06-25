import { describe, it, expect } from 'vitest';
import { Rng } from '../../../sim/rng';
import { createManagerCareer, quickSimUserFixture, advance, leagueTableOf } from '../engine';

function playOneSeason(s: ReturnType<typeof createManagerCareer>, seed: number): void {
  const rng = new Rng(seed);
  let guard = 0;
  while (guard++ < 800) {
    if (s.pendingUserFixture) quickSimUserFixture(s, rng);
    const res = advance(s, rng);
    if (res.seasonEnded) break;
  }
}

describe('in-season cup', () => {
  it('draws a bracket and CPU-sims league games on cup days (no table holes)', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'highbury-reds', managerName: 'Gaffer', seed: 314 });
    expect(s.cup).not.toBeNull();
    expect(s.cup!.rounds[0].length).toBeGreaterThan(0);
    expect(s.cup!.roundMatchdays.length).toBeGreaterThanOrEqual(1);

    const rng = new Rng(2718);
    // play past the first two cup matchdays (5 and 11)
    let guard = 0;
    while (guard++ < 200 && s.matchday < 12) {
      if (s.pendingUserFixture) quickSimUserFixture(s, rng);
      if (advance(s, rng).seasonEnded) break;
    }
    expect(s.matchday).toBeGreaterThanOrEqual(12);
    // every club in the user's league has played one game per matchday so far — the
    // user's league game is CPU-simmed on cup days, so no team comes up short
    const lid = s.clubLeagueId[s.userClubId];
    for (const row of leagueTableOf(s, lid)) expect(row.played).toBe(s.matchday);
  });

  it('completes the cup over a season and redraws a fresh one next season', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'fulham', managerName: 'Gaffer', seed: 99 });
    playOneSeason(s, 55);
    // the cup finished during the season — its winner is recorded in the season review
    expect(s.lastSeasonReview.some((l) => l.includes('National Cup'))).toBe(true);
    // if the manager kept their job, season 2 starts with a fresh, unplayed cup
    if (s.phase !== 'job-offers') {
      expect(s.cup).not.toBeNull();
      expect(s.cup!.winner).toBeNull();
      expect(s.cup!.currentRound).toBe(0);
      expect(s.cup!.userEliminated).toBe(false);
    }
  });
});
