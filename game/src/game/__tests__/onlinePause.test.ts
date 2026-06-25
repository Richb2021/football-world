import { describe, it, expect } from 'vitest';
import { pauseResumeDue, pauseSecondsLeft, ONLINE_PAUSE_MS, type OnlinePauseState } from '../onlinePause';

const at = (now: number, hostReady = false, guestReady = false): OnlinePauseState => ({
  deadline: now + ONLINE_PAUSE_MS,
  hostReady,
  guestReady,
});

describe('online pause rules', () => {
  it('resumes only when BOTH sides are ready', () => {
    const op = at(1000);
    expect(pauseResumeDue(op, 1000)).toBe(false);
    op.hostReady = true;
    expect(pauseResumeDue(op, 1000)).toBe(false); // one side only
    op.guestReady = true;
    expect(pauseResumeDue(op, 1000)).toBe(true);
  });

  it('resumes when the 40s cap elapses even if nobody is ready', () => {
    const op = at(1000);
    expect(pauseResumeDue(op, 1000 + ONLINE_PAUSE_MS - 1)).toBe(false);
    expect(pauseResumeDue(op, 1000 + ONLINE_PAUSE_MS)).toBe(true);
    expect(pauseResumeDue(op, 1000 + ONLINE_PAUSE_MS + 5000)).toBe(true);
  });

  it('counts whole seconds down from 40 to 0', () => {
    const op = at(0);
    expect(pauseSecondsLeft(op, 0)).toBe(40);
    expect(pauseSecondsLeft(op, 100)).toBe(40); // 39.9s → ceil 40
    expect(pauseSecondsLeft(op, 1000)).toBe(39);
    expect(pauseSecondsLeft(op, 39500)).toBe(1);
    expect(pauseSecondsLeft(op, 40000)).toBe(0);
    expect(pauseSecondsLeft(op, 41000)).toBe(0); // never negative
  });
});
