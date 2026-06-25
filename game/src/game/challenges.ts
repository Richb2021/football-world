/**
 * Challenge-mode result evaluation. Pure and dependency-free so it can be unit
 * tested in isolation.
 */

export type ChallengeObjective =
  | { kind: 'win' }
  | { kind: 'drawOrWin' }
  | { kind: 'cleanSheetWin' }
  | { kind: 'winByMargin'; margin: number }
  | { kind: 'protectLead'; startPlayerGoals: number };

export interface ChallengeVerdict {
  success: boolean;
  message: string;
}

export function evaluateChallengeObjective(
  objective: ChallengeObjective,
  playerGoals: number,
  opponentGoals: number,
): ChallengeVerdict {
  const won = playerGoals > opponentGoals;
  const drew = playerGoals === opponentGoals;
  const margin = playerGoals - opponentGoals;

  switch (objective.kind) {
    case 'win':
      return won
        ? { success: true, message: `you won ${playerGoals}-${opponentGoals}.` }
        : { success: false, message: drew ? `a draw is not enough here.` : `you needed to win the match.` };
    case 'drawOrWin':
      return won
        ? { success: true, message: `you won ${playerGoals}-${opponentGoals}.` }
        : drew
          ? { success: true, message: `the draw is enough to complete the objective.` }
          : { success: false, message: `you lost - a draw or win was needed.` };
    case 'cleanSheetWin':
      if (won && opponentGoals === 0) return { success: true, message: `you won and kept the clean sheet.` };
      if (won) return { success: false, message: `you won, but conceded ${opponentGoals}; the objective required a clean sheet.` };
      return { success: false, message: drew ? `you needed to win without conceding.` : `you needed a clean-sheet win.` };
    case 'winByMargin':
      return margin >= objective.margin
        ? { success: true, message: `you won by ${margin}, meeting the ${objective.margin}-goal margin.` }
        : { success: false, message: `you needed to win by ${objective.margin}; the margin was ${margin}.` };
    case 'protectLead':
      return won && playerGoals >= objective.startPlayerGoals
        ? { success: true, message: `you protected the lead and saw it out.` }
        : { success: false, message: `the lead slipped away - you had to finish ahead.` };
  }
}

/** Compatibility wrapper for old callers while Challenge Mode migrates to the
 * data-driven objective engine. */
export function evaluateChallenge(
  id: string,
  playerGoals: number,
  opponentGoals: number,
): ChallengeVerdict {
  switch (id) {
    case 'group-stage-survival':
      return evaluateChallengeObjective({ kind: 'drawOrWin' }, playerGoals, opponentGoals);
    case 'euro-giant-killing':
      return evaluateChallengeObjective({ kind: 'cleanSheetWin' }, playerGoals, opponentGoals);
    default:
      return evaluateChallengeObjective({ kind: 'win' }, playerGoals, opponentGoals);
  }
}
