import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('All Star Club app flow wiring', () => {
  it('wires Owner HQ to Online Rivals, World Tour, and Play Friend', () => {
    const app = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
    const play = readFileSync(new URL('../../ui/stars/playScreen.ts', import.meta.url), 'utf8');

    expect(app).toContain('openStarsRivals');
    expect(app).toContain('openStarsWorldTour');
    expect(app).toContain('onPlayFriend: () => this.onlineLobby(() => this.starsFlow())');
    expect(app).toContain('recordWorldTourResult');
    expect(play).toContain('applyWeeklyRivalsResult');
  });
});
