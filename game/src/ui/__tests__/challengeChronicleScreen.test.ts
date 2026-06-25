import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHALLENGE_CHRONICLE } from '../../game/challengeChronicle';
import { challengeChronicleHtml } from '../screens';

describe('challengeChronicleHtml', () => {
  it('renders a year ladder with previous replay, current dossier, and next locked preview', () => {
    const previous = CHALLENGE_CHRONICLE[0];
    const current = CHALLENGE_CHRONICLE[1];
    const next = CHALLENGE_CHRONICLE[2];
    const html = challengeChronicleHtml({
      chapters: CHALLENGE_CHRONICLE,
      currentIndex: 1,
      completedIds: [previous.id],
      completedCount: 1,
      leaderboardPoints: 2550,
      arcadeTokens: 3,
    });

    expect(html).toContain('class="challenge-arcade-shell challenge-screen-lock"');
    expect(html).toContain('class="challenge-year-ladder"');
    expect(html).toContain('challenge-timeline-scroll');
    expect(html).toContain(`data-challenge-state="completed"`);
    expect(html).toContain(`data-challenge-play="${previous.id}"`);
    expect(html).toContain(previous.title);

    expect(html).toContain(`data-challenge-state="current"`);
    expect(html).toContain('TOKENS');
    expect(html).toContain('<strong>3</strong>');
    expect(html).toContain(current.title);
    expect(html).toContain(current.storySetup);
    expect(html).toContain(current.objectiveText);
    expect(html).toContain(current.sourceTeams.join(' vs '));
    expect(html).toContain('id="challenge-play"');
    expect(html).toContain('TOKEN READY');
    expect(html).not.toContain('loaded');

    expect(html).toContain(`data-challenge-state="locked"`);
    expect(html).toContain(next.title);
    expect(html).toContain('NEXT YEAR LOCKED');
    expect(html).not.toContain(`data-challenge-play="${next.id}"`);
    expect(html).toContain('id="challenge-leaderboard"');
    expect(html).not.toContain(current.home.fictionalName);
    expect(html).not.toContain(current.away.fictionalName);
  });

  it('keeps the top arcade stats compact and readable', () => {
    const html = challengeChronicleHtml({
      chapters: CHALLENGE_CHRONICLE,
      currentIndex: 0,
      completedIds: [],
      completedCount: 0,
      leaderboardPoints: 0,
      arcadeTokens: 3,
    });

    expect(html).toContain('YEAR RUN');
    expect(html).toContain('CLEARED');
    expect(html).toContain('TOKENS');
    expect(html).toContain('SCORE');
    expect(html).toContain('id="challenge-topup"');
    expect(html).toContain('TOP UP TOKENS');
    expect(html).toContain('CLEAR THIS YEAR');
    expect(html).not.toContain('BONUSES');
    expect(html).not.toContain('+1K +150 +500 +750');
    expect(html).not.toContain('CLEAR +1,000');
    expect(html).not.toContain('GOAL +150');
    expect(html).not.toContain('FIRST CLEAR +750');
  });

  it('shows the timeline but disables challenge entry when no arcade tokens remain', () => {
    const current = CHALLENGE_CHRONICLE[0];
    const html = challengeChronicleHtml({
      chapters: CHALLENGE_CHRONICLE,
      currentIndex: 0,
      completedIds: [],
      completedCount: 0,
      leaderboardPoints: 0,
      arcadeTokens: 0,
    });

    expect(html).toContain(current.title);
    expect(html).toContain('NEED TOKEN');
    expect(html).toContain('INSERT TOKEN');
    expect(html).toContain('id="challenge-topup"');
    expect(html).not.toContain(`data-challenge-play="${current.id}"`);
  });

  it('lets an active paid run continue without charging another token', () => {
    const current = CHALLENGE_CHRONICLE[1];
    const html = challengeChronicleHtml({
      chapters: CHALLENGE_CHRONICLE,
      currentIndex: 1,
      completedIds: [CHALLENGE_CHRONICLE[0].id],
      completedCount: 1,
      leaderboardPoints: 2550,
      arcadeTokens: 0,
      runActive: true,
    });

    expect(html).toContain(current.title);
    expect(html).toContain('RUN ACTIVE');
    expect(html).toContain(`data-challenge-play="${current.id}"`);
    expect(html).not.toContain('NEED TOKEN');
  });

  it('lets cleared years replay without requiring another token', () => {
    const previous = CHALLENGE_CHRONICLE[0];
    const current = CHALLENGE_CHRONICLE[1];
    const html = challengeChronicleHtml({
      chapters: CHALLENGE_CHRONICLE,
      currentIndex: 1,
      completedIds: [previous.id],
      completedCount: 1,
      leaderboardPoints: 2550,
      arcadeTokens: 0,
      runActive: false,
    });

    expect(html).toContain(`data-challenge-play="${previous.id}"`);
    expect(html).toContain(current.title);
  });

  it('keeps landscape challenge actions reachable by letting the page scroll vertically', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.screen\.challenge-screen\s*\{[^}]*overflow-y: auto;[^}]*overflow-x: hidden;[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.screen\.challenge-screen\s*\{[^}]*overflow-y: auto;[^}]*padding-bottom: max\(12px, env\(safe-area-inset-bottom\)\);[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.challenge-arcade-shell\s*\{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible;[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.challenge-ladder-card\s*\{[^}]*height: auto;[^}]*overflow: visible;[^}]*\}/);
    expect(css).not.toContain('flex: 0 0 calc(100dvh - 104px);');
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.challenge-timeline-scroll\s*\{[^}]*overflow-x: auto;[^}]*overflow-y: hidden;[^}]*\}/);
  });
});
