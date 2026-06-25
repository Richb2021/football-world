import { describe, expect, it } from 'vitest';
import { newStars } from '../store';
import {
  applyWeeklyRivalsResult,
  currentRivalsDivision,
  ensureOwnerModeState,
  ownerPressureLabel,
} from '../ownerMode';

describe('All Star owner mode state', () => {
  it('initialises neutral owner pressure and weekly rivals state', () => {
    const state = ensureOwnerModeState(newStars(), Date.UTC(2026, 5, 21));

    expect(state.owner.boardMood).toBe(55);
    expect(state.owner.fanMood).toBe(55);
    expect(state.owner.pressPressure).toBe(35);
    expect(state.owner.form).toEqual([]);
    expect(state.rivals.weekKey).toBe('2026-W25');
    expect(state.rivals.points).toBe(0);
    expect(state.rivals.rewardsClaimed).toEqual([]);
    expect(state.worldTour.weekKey).toBe('2026-W25');
    expect(state.worldTour.currentMatch).toBe(0);
    expect(state.worldTour.completed).toBe(false);
  });

  it('labels pressure and derives a simple rivals division', () => {
    const state = ensureOwnerModeState(newStars(), Date.UTC(2026, 5, 21));
    state.owner.pressPressure = 72;
    state.rivals.points = 1250;

    expect(ownerPressureLabel(state.owner)).toBe('HIGH');
    expect(currentRivalsDivision(state.rivals)).toBeGreaterThanOrEqual(1);
  });

  it('updates Weekly Rivals points, form, and owner mood after a win', () => {
    const state = ensureOwnerModeState(newStars(), Date.UTC(2026, 5, 21));

    const summary = applyWeeklyRivalsResult(state, { score: [3, 1], winner: 0 }, Date.UTC(2026, 5, 21));

    expect(state.rivals.points).toBeGreaterThan(0);
    expect(state.rivals.wins).toBe(1);
    expect(state.owner.form[0]).toBe('W');
    expect(state.owner.fanMood).toBeGreaterThan(55);
    expect(state.owner.pressPressure).toBeLessThan(35);
    expect(summary.lines.join(' ')).toContain('Weekly Rivals');
  });

  it('raises pressure after a heavy online defeat', () => {
    const state = ensureOwnerModeState(newStars(), Date.UTC(2026, 5, 21));

    applyWeeklyRivalsResult(state, { score: [0, 4], winner: 1 }, Date.UTC(2026, 5, 21));

    expect(state.rivals.losses).toBe(1);
    expect(state.owner.form[0]).toBe('L');
    expect(state.owner.pressPressure).toBeGreaterThan(35);
    expect(state.owner.headline).toMatch(/pressure|questions|owner/i);
  });
});
