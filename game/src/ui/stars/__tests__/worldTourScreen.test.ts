import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('World Tour screen', () => {
  it('shows the weekly stage ladder, handicap, current stage action, and reset lock copy', () => {
    const screen = readFileSync(new URL('../worldTourScreen.ts', import.meta.url), 'utf8');

    expect(screen).toContain('WORLD TOUR');
    expect(screen).toContain('PLAY CURRENT STAGE');
    expect(screen).toContain('handicapLabel');
    expect(screen).toContain('id="wt-play"');
    expect(screen).toContain('id="wt-back"');
    expect(screen).toContain('LOCKED UNTIL WEEKLY RESET');
  });
});
