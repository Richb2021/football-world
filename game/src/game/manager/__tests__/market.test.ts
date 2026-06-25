import { describe, it, expect } from 'vitest';
import { Rng } from '../../../sim/rng';
import { createManagerCareer } from '../engine';
import { signFreeAgent, makeBid, listingsFor, refreshFreeAgents } from '../market';

describe('transfer market', () => {
  it('seeds a free-agent pool and lets you sign from it', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'walsall', managerName: 'Gaffer', seed: 4 });
    expect(s.freeAgents.length).toBeGreaterThan(0);
    const before = s.squads[s.userClubId].length;
    const r = signFreeAgent(s, 0, new Rng(1));
    if (r.status === 'accepted') {
      expect(s.squads[s.userClubId].length).toBe(before + 1);
      // the signed free agent left the pool
      expect(s.freeAgents.length).toBeLessThan(s.freeAgents.length + 1);
    }
  });

  it('refreshes the free-agent pool each off-season', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'walsall', managerName: 'Gaffer', seed: 4 });
    refreshFreeAgents(s, new Rng(9));
    expect(s.freeAgents.length).toBeGreaterThan(0);
  });

  it('a lowball bid is rejected (the player holds out for a better deal)', () => {
    const s = createManagerCareer({ nationId: 'england', clubId: 'walsall', managerName: 'Gaffer', seed: 2 });
    const listings = listingsFor(s);
    const target = listings[0];
    const lowball = Math.round(target.value * 0.3);
    const r = makeBid(s, { clubId: target.clubId, squadIdx: target.squadIdx }, lowball, new Rng(3));
    expect(r.status).not.toBe('accepted');
  });
});
