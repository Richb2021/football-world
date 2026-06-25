import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEAMS } from '../../data/teams';
import { autoLineup } from '../../sim/formations';
import type { MatchConfig } from '../../sim/types';
import {
  MAIN_MENU_JOURNEY_LABEL,
  buildPrematchLineupGroups,
  buildTacticalPitchPlayers,
  substitutionUsageLabel,
} from '../screens';

function makeCfg(): MatchConfig {
  const home = TEAMS[0];
  const away = TEAMS[1];
  return {
    teams: [
      { data: home, lineup: { formation: '4-4-2', starters: autoLineup(home.players, '4-4-2') }, kit: home.colors.home, controller: 'human' },
      { data: away, lineup: { formation: '4-3-3', starters: autoLineup(away.players, '4-3-3') }, kit: away.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 60,
    difficulty: 1,
    cupTie: false,
    seed: 42,
  };
}

describe('prematch lineup screen data', () => {
  it('builds two complete lineup columns from the match config', () => {
    const groups = buildPrematchLineupGroups(makeCfg());

    expect(groups).toHaveLength(2);
    expect(groups[0].teamName).toBe(TEAMS[0].name);
    expect(groups[0].formation).toBe('4-4-2');
    expect(groups[0].players).toHaveLength(11);
    expect(groups[0].players[0].pos).toBe('GK');
    expect(groups[1].teamName).toBe(TEAMS[1].name);
    expect(groups[1].formation).toBe('4-3-3');
    expect(groups[1].players).toHaveLength(11);
  });
});

describe('main menu labels', () => {
  it('labels story mode broadly now that multiple campaigns are playable', () => {
    expect(MAIN_MENU_JOURNEY_LABEL).toBe('STORY MODE');
    expect(MAIN_MENU_JOURNEY_LABEL).not.toContain('INTERNATIONAL CUP');
  });
});

describe('All Star Club navigation', () => {
  it('promotes All Star Club to the main menu', () => {
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(screens).toContain('onStars: () => void');
    expect(screens).toContain('id="m-stars"');
    expect(screens).toContain('ALL STAR CLUB');
  });

  it('keeps Online focused on network play only', () => {
    const online = readFileSync(new URL('../onlineScreens.ts', import.meta.url), 'utf8');

    expect(online).not.toContain('onStars');
    expect(online).not.toContain('ol-stars');
    expect(online).not.toContain('INTERNATIONAL CUP STARS');
    expect(online).toContain('SEASONS');
    expect(online).toContain('QUICK MATCH');
    expect(online).toContain('PLAY A FRIEND');
  });
});

describe('manager and team identity screens', () => {
  it('collects the International Cup manager name before creating the career slot', () => {
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../game/app.ts', import.meta.url), 'utf8');

    expect(screens).toContain('managerName(opts:');
    expect(screens).toContain('id="manager-name"');
    expect(screens).toContain('YOUR <span class="accent">MANAGER NAME</span>');
    expect(app).toContain('this.ui.managerName({');
    expect(app).toContain('draft.managerName = cleanedManagerName');
    expect(app).toContain('careerSlots.create(this.career)');
  });

  it('presents the All Star Club rename as the team identity', () => {
    const clubScreen = readFileSync(new URL('../stars/clubScreen.ts', import.meta.url), 'utf8');

    expect(clubScreen).toContain('ALL STAR TEAM NAME');
    expect(clubScreen).toContain('maxlength="24"');
    expect(clubScreen).toContain('dugout, match ticker and front page');
  });
});

describe('career availability wiring', () => {
  it('keeps unavailable players out of International Cup lineup selection and match configs', () => {
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../game/app.ts', import.meta.url), 'utf8');
    const events = readFileSync(new URL('../../meta/randomEvents.ts', import.meta.url), 'utf8');

    expect(events).toContain("availability: [{ name: '{star}', unavailableMatches: 1");
    expect(screens).toContain('unavailableSquadIndexes?: number[]');
    expect(screens).toContain('OUT NEXT MATCH');
    expect(app).toContain('unavailableSquadIndexes');
    expect(app).toContain('careerStarterIndexes(career');
  });
});

describe('press start input guard', () => {
  it('uses tap to play wording on the title prompt', () => {
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(screens).toContain('<div class="press-start">TAP TO PLAY</div>');
    expect(screens).not.toContain('<div class="press-start">PRESS START</div>');
  });

  it('blocks the trailing mobile click from activating the newly rendered menu', () => {
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(screens).toContain('START_MENU_INPUT_GUARD_MS');
    expect(screens).toContain('shouldSuppressMenuActivation');
    expect(screens).toContain('lockMenuActivationAfterTitleStart');
    expect(screens).toContain('e.stopImmediatePropagation()');
    expect(screens).toContain('{ capture: true }');
    expect(screens).toContain("s.addEventListener('pointerdown', startFromPointer, { once: true })");
  });

  it('lets the loading splash reveal the title screen as soon as the app and assets are ready', () => {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('var appReady = false;');
    expect(html).toContain('function maybeAutoDismiss()');
    expect(html).toContain('if (!appReady || !isReadyToPlay) return;');
    expect(html).toContain('window.__splashAppReady = function () { appReady = true; maybeAutoDismiss(); };');
  });
});

describe('substitution menu labels', () => {
  it('shows the era-specific substitution cap supplied by the match runner', () => {
    expect(substitutionUsageLabel(1, 2)).toBe('1 / 2 USED');
    expect(substitutionUsageLabel(3, 5)).toBe('3 / 5 USED');
  });
});

describe('tactical pitch screen data', () => {
  it('lays the same XI into different pitch positions when formation changes', () => {
    const players = buildPrematchLineupGroups(makeCfg())[0].players.map((p, idx) => ({
      ...p,
      playerIdx: idx,
      energy: idx === 5 ? 0.42 : 1,
    }));

    const fourFourTwo = buildTacticalPitchPlayers(players, '4-4-2');
    const fourThreeThree = buildTacticalPitchPlayers(players, '4-3-3');

    expect(fourFourTwo).toHaveLength(11);
    expect(fourFourTwo[5].energy).toBe(0.42);
    expect(fourFourTwo[10].left).not.toBeCloseTo(fourThreeThree[10].left, 1);
    expect(fourThreeThree[10].slotIdx).toBe(10);
    expect(fourThreeThree[10].overall).toBe(players[10].overall);
  });
});

describe('mobile tactics layout', () => {
  it('uses a pitch-first two-column surface with a mobile scroll cue and larger touch targets', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(css).toMatch(/\.tactics-shell\s*\{[^}]*width: min\(1320px, 96vw\);[^}]*height: min\(84vh, calc\(100vh - 112px\)\);[^}]*max-height: none;/);
    expect(css).toMatch(/\.tactics-layout\s*\{[^}]*grid-template-columns: minmax\(520px, 1\.42fr\) minmax\(340px, 0\.58fr\);/);
    expect(css).toMatch(/\.tactic-pitch\s*\{[^}]*max-width: min\(760px, 58vw\);/);
    expect(css).toMatch(/\.tactic-player\s*\{[^}]*width: 92px;[^}]*min-height: 74px;/);
    expect(css).toMatch(/\.squad-card\s*\{[^}]*min-height: 72px;[^}]*grid-template-columns: 52px minmax\(0, 1fr\) 54px auto;/);
    expect(css).toContain('.tactics-scroll-cue');
    expect(css).toContain('@keyframes tactics-scroll-pulse');
    expect(screens).toContain('class="tactics-scroll-cue"');
  });
});

describe('mobile menu sizing', () => {
  it('overrides narrow inline menu widths and keeps touch buttons full-page sized', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.screen \.menu-col\s*\{[^}]*width: min\(760px, 94vw\) !important;[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.screen \.btn\s*\{[^}]*min-height: 54px;[^}]*font-size: 20px;[^}]*\}/);
  });

  it('makes team selection a large single-handed touch surface on phones', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.team-select-shell\s*\{[^}]*width: min\(820px, 96vw\);[^}]*max-height: calc\(100dvh - 104px\);[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.team-grid--select\s*\{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 260px\), 1fr\)\);[^}]*gap: 12px;[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.team-card--select\s*\{[^}]*min-height: 148px;[^}]*padding: 16px;[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.team-grid--select\s*\{[^}]*padding: 4px 4px calc\(4px \+ var\(--team-select-action-clearance\)\);[^}]*scroll-padding-bottom: var\(--team-select-action-clearance\);[^}]*\}/);
  });

  it('has a compact landscape-phone override that keeps the picker wide and touchable', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.screen \.h-screen\s*\{[^}]*font-size: 28px;[^}]*margin: 8px 0 8px;[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.team-select-shell\s*\{[^}]*max-height: calc\(100dvh - 96px\);[^}]*--team-select-action-clearance: 64px;[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.team-card--select\s*\{[^}]*min-height: 132px;[^}]*padding: 14px;[^}]*\}/);
    expect(screens).toContain('team-select-actions');
  });

  it('does not scale the menu overlay down on landscape phones', () => {
    const index = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

    expect(index).not.toContain("ui.style.transform = 'translate(-50%, -50%) scale('");
    expect(index).not.toContain("ui.style.width = (100 / scale) + '%'");
    expect(index).not.toContain("ui.style.height = (100 / scale) + '%'");
  });
});

describe('selection tabs', () => {
  it('separates team selection from formation setup on lineup screens', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(screens).toContain('class="selection-tabs"');
    expect(screens).toContain('data-selection-tab="team"');
    expect(screens).toContain('data-selection-tab="formation"');
    expect(screens).toContain('data-selection-tab="tactics"');
    expect(screens).toContain('class="selection-tab-panel lineup-team-panel"');
    expect(screens).toContain('class="selection-tab-panel lineup-formation-panel"');
    expect(screens).toContain('class="selection-tab-panel lineup-tactics-panel"');
    expect(screens).toContain('class="tactics-control-grid"');
    expect(screens).toContain("slider('width'");
    expect(screens).toContain("slider('defensiveDepth'");
    expect(screens).toContain('class="selection-actions"');
    expect(screens).toContain('compact?: boolean');
    expect(screens).toContain('tactic-pitch--compact');
    expect(screens).toContain('String(p.slotIdx + 1)');
    expect(css).toContain('.selection-tab-panel[hidden]');
    expect(css).toContain('.lineup-roster-layout');
    expect(css).toContain('.tactics-control-grid');
    expect(css).toContain('.tactics-slider');
    expect(css).toContain('.tactic-pitch--compact .tactic-player');
    expect(css).toContain('.tactic-pitch--compact .tactic-name');
    expect(css).toContain('.tactic-pitch--compact .tactic-energy');
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.selection-shell\s*\{[^}]*--selection-list-action-clearance: 56px;[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.selection-shell \.squad-panel--roster\s*\{[^}]*min-height: 0;[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.selection-shell \.squad-list\s*\{[^}]*padding: 0 3px var\(--selection-list-action-clearance\) 0;[^}]*scroll-padding-bottom: var\(--selection-list-action-clearance\);[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.tactics-seg\s*\{[^}]*display: flex;[^}]*overflow-x: auto;[^}]*scroll-snap-type: x mandatory;[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 950px\), \(pointer: coarse\)\s*\{[\s\S]*\.tactics-seg button\.on\s*\{[^}]*order: -1;[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.selection-shell\s*\{[^}]*height: calc\(100dvh - 102px\);[^}]*--selection-list-action-clearance: 64px;[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.formation-tab-layout\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(260px, 0\.8fr\) minmax\(320px, 1fr\);[^}]*\}/);
    expect(css).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\), \(pointer: coarse\) and \(orientation: landscape\)\s*\{[\s\S]*\.formation-preview-board \.tactic-field\s*\{[^}]*height: 100%;[^}]*width: auto;[^}]*min-width: 0;[^}]*\}/);
  });

  it('uses the same team and formation tab split in the pause substitution screen', () => {
    const screens = readFileSync(new URL('../screens.ts', import.meta.url), 'utf8');

    expect(screens).toContain('class="selection-tab-panel pause-team-panel"');
    expect(screens).toContain('class="selection-tab-panel pause-formation-panel"');
    expect(screens).toContain('class="selection-tab-panel pause-tactics-panel"');
    expect(screens).toContain('onTacticsChange?: (tactics: TeamTactics) => void');
    expect(screens).toContain("activeTab = opts.initialTab ?? 'team'");
  });
});

describe('International Cup narrative hub', () => {
  it('exposes phone, press, team, and headlines actions', () => {
    const careerScreens = readFileSync(new URL('../careerScreens.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

    expect(careerScreens).toContain('cup-meta-tabs');
    expect(careerScreens).toContain('id="c-phone"');
    expect(careerScreens).toContain('id="c-press"');
    expect(careerScreens).toContain('id="c-team"');
    expect(careerScreens).toContain('id="c-headlines"');
    expect(careerScreens).toContain('function headlinesScreen');
    expect(careerScreens).toContain('function teamScreen');
    expect(css).toContain('.headline-feed');
    expect(css).toContain('.team-room-feed');
  });
});
