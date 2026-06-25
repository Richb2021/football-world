// Pure logic for the online synchronized pause. The match runner owns the
// wiring (messages, menu, sim freeze); this module holds the testable rules.

/** A synchronized online pause runs for at most this long before auto-resuming. */
export const ONLINE_PAUSE_MS = 40000;

export interface OnlinePauseState {
  /** epoch ms (local clock) at which the pause auto-resumes */
  deadline: number;
  hostReady: boolean;
  guestReady: boolean;
}

/** The host ends a synchronized pause when BOTH players are ready to resume, or
 *  the 40-second cap elapses — whichever comes first. */
export function pauseResumeDue(op: OnlinePauseState, now: number): boolean {
  return (op.hostReady && op.guestReady) || now >= op.deadline;
}

/** Whole seconds remaining on the countdown, floored at 0. */
export function pauseSecondsLeft(op: OnlinePauseState, now: number): number {
  return Math.max(0, Math.ceil((op.deadline - now) / 1000));
}
