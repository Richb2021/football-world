import { describe, it, expect } from 'vitest';

// Minimal localStorage stub for the node test environment (custom nations persist via localStorage).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  length: 0,
} as Storage;

import { saveCustomTeam, anyTeamById } from '../teams';
import { saveCustomNation, nationById, exportNationJSON, importNationJSON } from '../nations';
import { generateTeam, customTeamId } from '../clubs/generate';
import { createManagerCareer, quickSimUserFixture, advance } from '../../game/manager/engine';
import { Rng } from '../../sim/rng';
import type { NationDef } from '../nations';

describe('customisation → manager integration', () => {
  it('a custom nation built from custom + built-in teams is playable in Manager Mode', () => {
    // 1. create two custom teams
    const a = generateTeam({ id: customTeamId('Riverside'), name: 'Riverside', short: 'RIV', stadium: 'Riverside Park', strength: 70, primary: '#cc0000', secondary: '#ffffff', pattern: 'stripes' });
    const b = generateTeam({ id: customTeamId('Hilltown'), name: 'Hilltown', short: 'HIL', stadium: 'Hill Park', strength: 66, primary: '#0000cc', secondary: '#ffffff', pattern: 'hoops' });
    saveCustomTeam(a);
    saveCustomTeam(b);
    expect(anyTeamById(a.id)?.name).toBe('Riverside');
    expect(anyTeamById(b.id)?.name).toBe('Hilltown');

    // 2. build a custom pyramid nation with one tier mixing custom + built-in clubs
    const nation: NationDef = {
      id: 'custom-test-valley',
      name: 'Valley League',
      type: 'pyramid',
      tiers: [{ tier: 1, leagueId: 'valley-top', name: 'Valley Premier', teamIds: [a.id, b.id, 'barnet', 'bromley'] }],
      promotion: 1, relegation: 1, playoffs: false,
      cups: [{ id: 'valley-cup', name: 'Valley Cup', format: 'knockout', entries: 'whole-nation' }],
      custom: true,
    };
    saveCustomNation(nation);
    expect(nationById('custom-test-valley')).toBeTruthy();

    // 3. start a manager career over the custom nation with a custom club
    const mgr = createManagerCareer({ nationId: 'custom-test-valley', clubId: a.id, managerName: 'Gaffer', seed: 42 });
    expect(Object.keys(mgr.squads).length).toBe(4);
    expect(mgr.squads[a.id].length).toBeGreaterThanOrEqual(14);
    expect(mgr.pendingUserFixture).not.toBeNull();

    // 4. simulate a matchday (CPU-CPU + the user's) and advance — no crash, table populates
    const rng = new Rng(7);
    quickSimUserFixture(mgr, rng);
    advance(mgr, rng);
    expect(mgr.matchday).toBe(1);
  });

  it('round-trips a nation through export → import', () => {
    const json = exportNationJSON('custom-test-valley');
    expect(json).toContain('Valley League');
    // a fresh import (simulating another device) lands it as a custom nation
    const imported = importNationJSON(json);
    expect(imported.name).toBe('Valley League');
    expect(imported.custom).toBe(true);
    expect(nationById(imported.id)).toBeTruthy();
  });
});
