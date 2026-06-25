import { describe, it, expect } from 'vitest';
import { Rng } from '../../../sim/rng';
import { createPlayerCareer, quickSimPlayerFixture, advancePlayer, avatarOf, playerMoveClub } from '../engine';
import type { PlayerCareerState } from '../types';

function playSeasons(pcs: PlayerCareerState, n: number): void {
  const rng = new Rng(123);
  for (let s = 0; s < n; s++) {
    let guard = 0;
    while (guard++ < 500) {
      if (pcs.world.pendingUserFixture) quickSimPlayerFixture(pcs, rng);
      const res = advancePlayer(pcs, rng);
      if (res.seasonEnded) break;
    }
    if (pcs.phase === 'season-end') pcs.phase = 'in-season'; // clear review to continue
  }
}

describe('player career engine', () => {
  it('creates a 16-year-old avatar in the chosen club and position', () => {
    const pcs = createPlayerCareer({ nationId: 'england', clubId: 'walsall', playerName: 'Test Striker', pos: 'FW', seed: 5 });
    const av = avatarOf(pcs);
    expect(av).toBeTruthy();
    expect(av!.age).toBe(16);
    expect(av!.pos).toBe('FW');
    expect(pcs.world.squads[pcs.world.userClubId].some((p) => p.name === 'Test Striker')).toBe(true);
  });

  it('accrues appearances and ages over seasons, keeping the avatar in the squad', () => {
    const pcs = createPlayerCareer({ nationId: 'england', clubId: 'stevenage', playerName: 'Young Gun', pos: 'MF', seed: 9 });
    playSeasons(pcs, 3);
    expect(pcs.careerApps).toBeGreaterThan(0);
    const av = avatarOf(pcs);
    expect(av).toBeTruthy();
    expect(av!.age).toBeGreaterThanOrEqual(19);
    expect(pcs.world.squads[pcs.world.userClubId].some((p) => p.name === 'Young Gun')).toBe(true);
  });

  it('moves the avatar to a new club on transfer and keeps them playable', () => {
    const pcs = createPlayerCareer({ nationId: 'england', clubId: 'barnet', playerName: 'Winger', pos: 'FW', seed: 2 });
    const old = pcs.world.userClubId;
    const other = Object.keys(pcs.world.squads).find((id) => id !== old)!;
    playerMoveClub(pcs, other);
    expect(pcs.world.userClubId).toBe(other);
    expect(avatarOf(pcs)).toBeTruthy();
    expect(pcs.world.squads[other].some((p) => p.name === 'Winger')).toBe(true);
    // old club no longer has the avatar
    expect(pcs.world.squads[old].some((p) => p.name === 'Winger')).toBe(false);
  });
});
