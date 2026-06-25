import { describe, it, expect } from 'vitest';
import { Rng } from '../../../sim/rng';
import {
  createManagerCareer, leagueTableOf, quickSimUserFixture, advance, takeJob,
  standingsForUserLeague, simPlayoff,
} from '../engine';

/** Run a career forward one full season (quick-simming the user's fixtures). */
function playOneSeason(s: ReturnType<typeof createManagerCareer>, seed = 99): void {
  const rng = new Rng(seed);
  let guard = 0;
  while (guard++ < 400) {
    if (s.pendingUserFixture) quickSimUserFixture(s, rng);
    const res = advance(s, rng);
    if (res.seasonEnded) break;
  }
}

describe('manager engine', () => {
  it('creates an England career with 92 clubs across 4 tiers', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'highbury-reds', managerName: 'Gaffer', seed: 12345 });
    expect(Object.keys(s.squads).length).toBe(92);
    expect(s.squads['highbury-reds'].length).toBeGreaterThanOrEqual(14);
    expect(s.totalRounds).toBeGreaterThan(20);
    expect(s.pendingUserFixture).not.toBeNull();
    // every squad is within sane bounds
    for (const id of Object.keys(s.squads)) {
      expect(s.squads[id].length).toBeGreaterThanOrEqual(11);
      expect(s.squads[id].length).toBeLessThanOrEqual(27);
    }
  });

  it('sims a full season without crashing and produces a standings table', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'brentford', managerName: 'Gaffer', seed: 7 });
    playOneSeason(s);
    const table = standingsForUserLeague(s);
    expect(table.length).toBeGreaterThan(0);
    const totalPlayed = table.reduce((sum, r) => sum + r.played, 0);
    expect(totalPlayed).toBeGreaterThan(0);
    // a season was completed and reviewed — either kept the job (season 2) or got sacked
    expect(s.lastSeasonReview.length).toBeGreaterThan(0);
    expect(s.season === 2 || s.phase === 'job-offers').toBe(true);
  });

  it('promotion/relegation keeps every club in a valid tier across seasons', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'walsall', managerName: 'Gaffer', seed: 3 });
    playOneSeason(s, 42);
    playOneSeason(s, 43);
    for (const id of Object.keys(s.clubTier)) {
      expect(s.clubTier[id]).toBeGreaterThanOrEqual(1);
      expect(s.clubTier[id]).toBeLessThanOrEqual(4);
    }
    // tier membership counts stay correct (20/24/24/24)
    const counts: Record<number, number> = {};
    for (const t of Object.values(s.clubTier)) counts[t] = (counts[t] ?? 0) + 1;
    expect(counts[1]).toBe(20);
    expect(counts[2]).toBe(24);
    expect(counts[3]).toBe(24);
    expect(counts[4]).toBe(24);
  });

  it('simPlayoff resolves to one of the entrants (and a solo entrant walks over)', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'fulham', managerName: 'Gaffer', seed: 1 });
    const ids = ['chelsea', 'fulham', 'brighton', 'brentford'];
    const winner = simPlayoff(s, ids, new Rng(7));
    expect(ids).toContain(winner);
    expect(simPlayoff(s, ['chelsea'], new Rng(1))).toBe('chelsea');
  });

  it('takeJob moves the manager to a new club and resets the board', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'fulham', managerName: 'Gaffer', seed: 5 });
    s.phase = 'job-offers';
    takeJob(s, 'chelsea');
    expect(s.userClubId).toBe('chelsea');
    expect(s.board.confidence).toBe(60);
    expect(s.jobHistory.some((j) => j.clubId === 'fulham' && j.outcome === 'sacked')).toBe(true);
    expect(s.jobHistory.some((j) => j.clubId === 'chelsea' && j.outcome === 'current')).toBe(true);
  });

  it('the CPU transfer market keeps squads within [14,27] over a season', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'leeds-whites', managerName: 'Gaffer', seed: 11 });
    playOneSeason(s, 77);
    for (const id of Object.keys(s.squads)) {
      expect(s.squads[id].length).toBeGreaterThanOrEqual(14);
      expect(s.squads[id].length).toBeLessThanOrEqual(27);
    }
  });
});
