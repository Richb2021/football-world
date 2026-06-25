import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHALLENGE_CHRONICLE,
  applyChallengeResult,
  buildChallengeTeamData,
  challengeScoreBreakdown,
  challengeLeaderboardPoints,
  challengeResultCopy,
  defaultChallengeProgress,
  isChallengeCelebrationMatch,
  isChallengeTrophyMatch,
  sortChallengeLeaderboardRows,
} from '../challengeChronicle';
import { evaluateChallengeObjective } from '../challenges';

describe('Challenge Chronicle data', () => {
  it('works chronologically from the first World Cup through a Spain v Cape Verde capstone', () => {
    expect(CHALLENGE_CHRONICLE[0]?.year).toBe(1930);
    expect(CHALLENGE_CHRONICLE[0]?.sourceTeams).toEqual(['Uruguay', 'Argentina']);
    expect(CHALLENGE_CHRONICLE[0]?.home.formation).toBe('2-3-5');
    expect(CHALLENGE_CHRONICLE[0]?.away.formation).toBe('2-3-5');

    const handOfGod = CHALLENGE_CHRONICLE.find((chapter) => chapter.year === 1986);
    expect(handOfGod?.sourceMatch).toMatch(/Argentina v England/i);
    expect(handOfGod?.storySetup).toMatch(/handball|hand/i);
    expect(handOfGod?.home.fictionalName).not.toMatch(/Argentina|England/i);
    expect(handOfGod?.away.fictionalName).not.toMatch(/Argentina|England/i);
    expect(handOfGod?.sourceTeams).toEqual(['Argentina', 'England']);

    const finalChapter = CHALLENGE_CHRONICLE.at(-1);
    expect(finalChapter?.id).toBe('capstone-spain-cape-verde');
    expect(finalChapter?.sourceTeams).toEqual(['Spain', 'Cape Verde']);
    expect(finalChapter?.away.baseTeamId).toBe('cape-verde');
    expect(finalChapter?.away.fictionalName).not.toMatch(/Cape Verde|Spain/i);
    expect(finalChapter?.home.formation).toBe('4-2-3-1');
    expect(finalChapter?.away.formation).toBe('4-3-3');
    expect(finalChapter?.objective.kind).toBe('drawOrWin');
  });

  it('uses era-appropriate formations across the chronicle', () => {
    const byYear = (year: number) => CHALLENGE_CHRONICLE.find((chapter) => chapter.year === year)!;

    expect(byYear(1934).home.formation).toBe('w-m');
    expect(byYear(1958).home.formation).toBe('4-2-4');
    expect(byYear(1982).home.formation).toBe('4-2-2-2');
    expect(byYear(2006).home.formation).toBe('4-3-2-1');
  });

  it('does not expose a free-pick list at the start of the ladder', () => {
    const progress = defaultChallengeProgress();
    expect(progress.currentIndex).toBe(0);
    expect(progress.completedIds).toEqual([]);
    expect(CHALLENGE_CHRONICLE.filter((chapter, index) => index <= progress.currentIndex)).toHaveLength(1);
  });
});

describe('evaluateChallengeObjective', () => {
  it('passes win-only and draw-or-win objectives correctly', () => {
    expect(evaluateChallengeObjective({ kind: 'win' }, 2, 1).success).toBe(true);
    expect(evaluateChallengeObjective({ kind: 'win' }, 1, 1).success).toBe(false);
    expect(evaluateChallengeObjective({ kind: 'drawOrWin' }, 1, 1).success).toBe(true);
    expect(evaluateChallengeObjective({ kind: 'drawOrWin' }, 0, 1).success).toBe(false);
  });

  it('supports clean sheets, margin targets and lead protection', () => {
    expect(evaluateChallengeObjective({ kind: 'cleanSheetWin' }, 1, 0).success).toBe(true);
    expect(evaluateChallengeObjective({ kind: 'cleanSheetWin' }, 4, 2).success).toBe(false);
    expect(evaluateChallengeObjective({ kind: 'winByMargin', margin: 2 }, 3, 1).success).toBe(true);
    expect(evaluateChallengeObjective({ kind: 'winByMargin', margin: 2 }, 2, 1).success).toBe(false);
    expect(evaluateChallengeObjective({ kind: 'protectLead', startPlayerGoals: 1 }, 1, 0).success).toBe(true);
    expect(evaluateChallengeObjective({ kind: 'protectLead', startPlayerGoals: 1 }, 1, 1).success).toBe(false);
  });
});

describe('Challenge Chronicle progression and leaderboard scoring', () => {
  it('unlocks only the next chapter after a successful result', () => {
    const progress = defaultChallengeProgress();
    const first = CHALLENGE_CHRONICLE[0];

    const failed = applyChallengeResult(progress, first.id, [2, 2]);
    expect(failed.verdict.success).toBe(false);
    expect(failed.progress.currentIndex).toBe(0);
    expect(failed.progress.completedIds).toEqual([]);

    const passed = applyChallengeResult(progress, first.id, [4, 2]);
    expect(passed.verdict.success).toBe(true);
    expect(passed.progress.currentIndex).toBe(1);
    expect(passed.progress.completedIds).toEqual([first.id]);
  });

  it('keeps one paid arcade run alive across cleared years and ends it on a failed retry', () => {
    const first = CHALLENGE_CHRONICLE[0];
    const second = CHALLENGE_CHRONICLE[1];
    const progress = { ...defaultChallengeProgress(), runActive: true };

    const passed = applyChallengeResult(progress, first.id, [4, 2]);
    expect(passed.verdict.success).toBe(true);
    expect(passed.progress.currentIndex).toBe(1);
    expect(passed.progress.runActive).toBe(true);

    const failed = applyChallengeResult(passed.progress, second.id, second.startScore);
    expect(failed.verdict.success).toBe(false);
    expect(failed.progress.currentIndex).toBe(1);
    expect(failed.progress.runActive).toBe(false);
  });

  it('scores the shared leaderboard by furthest chapter, then final Cape Verde margin, then alphabetically', () => {
    const chapterFive = challengeLeaderboardPoints(5, CHALLENGE_CHRONICLE.length, null);
    const chapterSix = challengeLeaderboardPoints(6, CHALLENGE_CHRONICLE.length, null);
    expect(chapterSix).toBeGreaterThan(chapterFive);

    const finalDraw = challengeLeaderboardPoints(CHALLENGE_CHRONICLE.length, CHALLENGE_CHRONICLE.length, 0);
    const finalWinByThree = challengeLeaderboardPoints(CHALLENGE_CHRONICLE.length, CHALLENGE_CHRONICLE.length, 3);
    expect(finalWinByThree).toBeGreaterThan(finalDraw);

    const rows = sortChallengeLeaderboardRows([
      { playerLabel: 'Bex', points: finalDraw },
      { playerLabel: 'Ada', points: finalDraw },
      { playerLabel: 'Cam', points: finalWinByThree },
    ]);
    expect(rows.map((row) => row.playerLabel)).toEqual(['Cam', 'Ada', 'Bex']);
  });

  it('scores arcade clears from challenge goals, defending, and first-time passes', () => {
    const first = CHALLENGE_CHRONICLE[0];
    const breakdown = challengeScoreBreakdown(first, [4, 2], true);

    expect(breakdown.items).toEqual([
      { label: 'CLEAR', points: 1000 },
      { label: 'GOALS', points: 300 },
      { label: 'DEFENCE', points: 500 },
      { label: 'FIRST CLEAR', points: 750 },
    ]);
    expect(breakdown.total).toBe(2550);

    const passed = applyChallengeResult(defaultChallengeProgress(), first.id, [4, 2]);
    expect(passed.scoreBreakdown.total).toBe(2550);
    expect(passed.scoreImproved).toBe(true);
    expect(passed.progress.chapterScores[first.id]?.bestPoints).toBe(2550);
    expect(passed.leaderboardPoints).toBe(2550);

    const replay = applyChallengeResult(passed.progress, first.id, [3, 2]);
    expect(replay.scoreBreakdown.items).not.toContainEqual({ label: 'FIRST CLEAR', points: 750 });
    expect(replay.scoreImproved).toBe(false);
    expect(replay.leaderboardPoints).toBe(2550);
  });

  it('lets a completed capstone replay improve the final-margin tie-break', () => {
    const final = CHALLENGE_CHRONICLE.at(-1)!;
    const completedProgress = {
      currentIndex: CHALLENGE_CHRONICLE.length - 1,
      completedIds: CHALLENGE_CHRONICLE.map((chapter) => chapter.id),
      finalMargin: 0,
      chapterScores: {},
      runActive: true,
    };

    const result = applyChallengeResult(completedProgress, final.id, [1, 4]);

    expect(result.verdict.success).toBe(true);
    expect(result.progress.completedIds).toHaveLength(CHALLENGE_CHRONICLE.length);
    expect(result.progress.finalMargin).toBe(3);
    expect(result.progress.runActive).toBe(false);
  });

  it('rechecks challenge progress inside the play handler before spending a token', () => {
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
    const handlerStart = appSource.indexOf('onPlayChapter: (chapterId) => {');
    const handlerEnd = appSource.indexOf('onLeaderboard:', handlerStart);
    const handler = appSource.slice(handlerStart, handlerEnd);

    expect(handler).toContain('const latestProgress = this.loadChallengeProgress()');
    expect(handler.indexOf('const latestProgress')).toBeLessThan(handler.indexOf('spendArcadeToken'));
    expect(handler).toContain('latestProgress.runActive');
    expect(handler).toContain('challengeLaunchLocked');
  });

  it('routes Challenge Chronicle token top-ups through the Stars Store top-up tab', () => {
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');

    expect(appSource).toContain('onTopUp: () => this.challengeTopUpFlow()');
    expect(appSource).toContain('private challengeTopUpFlow()');
    expect(appSource).toContain("}, 'topup')");
    expect(appSource).toContain('onBack: () => this.challengeFlow()');
  });

  it('marks Challenge finals for trophies and special deciders for trophy-free celebrations', () => {
    const firstFinal = CHALLENGE_CHRONICLE.find((chapter) => chapter.id === 'wc-1930-riverplate-final')!;
    const finalGroupDecider = CHALLENGE_CHRONICLE.find((chapter) => chapter.id === 'wc-1950-maracana-silence')!;
    const semiFinal = CHALLENGE_CHRONICLE.find((chapter) => chapter.id === 'wc-1970-azteca-semi')!;
    const capstone = CHALLENGE_CHRONICLE.find((chapter) => chapter.id === 'capstone-spain-cape-verde')!;
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');

    expect(isChallengeTrophyMatch(firstFinal)).toBe(true);
    expect(isChallengeTrophyMatch(finalGroupDecider)).toBe(false);
    expect(isChallengeTrophyMatch(capstone)).toBe(false);
    expect(isChallengeTrophyMatch(semiFinal)).toBe(false);
    expect(isChallengeCelebrationMatch(firstFinal)).toBe(false);
    expect(isChallengeCelebrationMatch(finalGroupDecider)).toBe(true);
    expect(isChallengeCelebrationMatch(capstone)).toBe(true);
    expect(isChallengeCelebrationMatch(semiFinal)).toBe(false);
    expect(appSource).toContain('trophyWin: isChallengeTrophyMatch(chapter)');
    expect(appSource).toContain('celebrationWin: isChallengeCelebrationMatch(chapter)');
    expect(appSource).toContain('celebrationTeam: chapter.playerTeam');
  });
});

describe('Challenge Chronicle result copy', () => {
  it('makes wins feel like progression and losses invite one more try', () => {
    expect(challengeResultCopy(true, false)).toEqual({
      headline: 'YEAR CLEARED',
      continueLabel: 'NEXT YEAR',
    });
    expect(challengeResultCopy(true, true)).toEqual({
      headline: 'RUN COMPLETE',
      continueLabel: 'CHASE HIGH SCORE',
    });
    expect(challengeResultCopy(false, false)).toEqual({
      headline: 'TRY AGAIN?',
      continueLabel: 'ONE MORE MATCH',
    });
  });
});

describe('buildChallengeTeamData', () => {
  it('keeps the real country visible while replacing player names', () => {
    const base = {
      id: 'england',
      name: 'England',
      short: 'ENG',
      stadium: 'Wembley',
      strength: 85,
      colors: {
        home: { shirt: '#ffffff', shorts: '#ffffff', socks: '#ffffff' },
        away: { shirt: '#cc0000', shorts: '#cc0000', socks: '#cc0000' },
      },
      players: [
        { name: 'Real Keeper', pos: 'GK' as const, age: 30, pace: 40, pass: 50, shoot: 20, tackle: 40, keeping: 80 },
        { name: 'Real Forward', pos: 'FW' as const, age: 24, pace: 80, pass: 70, shoot: 85, tackle: 35, keeping: 10 },
      ],
    };

    const team = buildChallengeTeamData(base, {
      baseTeamId: 'england',
      fictionalName: 'Albion Whites',
      short: 'ALW',
      formation: '4-4-2',
      namePool: ['Stone', 'Mason'],
    });

    expect(team.id).toBe('england-challenge-alw');
    expect(team.name).toBe('England');
    expect(team.short).toBe('ENG');
    expect(team.strength).toBe(85);
    expect(team.players.map((player) => player.name)).toEqual(['Stone 1', 'Mason 2']);
  });
});
