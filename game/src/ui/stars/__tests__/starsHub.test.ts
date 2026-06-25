import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Stars Owner HQ hub', () => {
  it('renders online rivals, world tour, pressure, and owner headline affordances', () => {
    const hub = readFileSync(new URL('../starsHub.ts', import.meta.url), 'utf8');

    expect(hub).toContain('OWNER HQ');
    expect(hub).toContain('ONLINE RIVALS');
    expect(hub).toContain('WORLD TOUR');
    expect(hub).toContain('PRESSURE');
    expect(hub).toContain('state.owner.headline');
    expect(hub).toContain('id="hs-rivals"');
    expect(hub).toContain('id="hs-world-tour"');
    expect(hub).toContain('id="hs-friend"');
  });
});
