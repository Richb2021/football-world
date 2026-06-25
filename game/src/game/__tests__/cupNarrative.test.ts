import { describe, expect, it } from 'vitest';
import { newCareer, ensureCareerSystems } from '../career';
import {
  addCupHeadline,
  activeArcHeat,
  assessMatchPerformance,
  cappedOffFieldMomentumDelta,
  expectationTierForStrength,
  heatCupArc,
  teamNarrativeProfile,
  unresolvedRequiredMessages,
} from '../cupNarrative';
import { pushMessage } from '../../meta/phone';
import { TEAMS } from '../../data/teams';

function cupCareer() {
  const career = newCareer('cup', 0, 12345, 'international-cup');
  ensureCareerSystems(career);
  return career;
}

describe('cup narrative', () => {
  it('initializes narrative state for International Cup careers', () => {
    const career = cupCareer();
    expect(career.cupNarrative).toMatchObject({
      arcs: [],
      headlines: [],
      requiredMessageIds: [],
      pendingTeamEvents: [],
    });
  });

  it('revives old saves without narrative state', () => {
    const career = cupCareer();
    delete (career as any).cupNarrative;
    ensureCareerSystems(career);
    expect(career.cupNarrative?.lastGeneratedStep).toBe(career.step);
  });

  it('heats and reads active arcs by type', () => {
    const career = cupCareer();
    heatCupArc(career, 'press-feud', 18, { relatedOpponent: 'Brazil' });
    heatCupArc(career, 'press-feud', 7);
    expect(activeArcHeat(career, 'press-feud')).toBe(25);
    expect(career.cupNarrative!.arcs[0].relatedOpponent).toBe('Brazil');
  });

  it('adds newest structured headlines first and mirrors legacy news', () => {
    const career = cupCareer();
    addCupHeadline(career, {
      title: 'Stone answers critics before Brazil tie',
      source: 'Back Page',
      tone: 'sensational',
      body: 'The manager was in no mood to apologise.',
    });
    expect(career.cupNarrative!.headlines[0].title).toContain('Stone');
    expect(career.news[career.news.length - 1]).toContain('Stone');
  });

  it('finds unresolved required phone messages', () => {
    const career = cupCareer();
    const msg = pushMessage(career.inbox!, {
      from: 'Captain',
      senderType: 'captain',
      text: 'Need a word before kickoff.',
      time: 'Group Stage',
      order: 1,
      requiresResponse: true,
      replies: [{ id: 'back', text: 'Back the lads', effect: { squad: 3 } }],
    });
    expect(unresolvedRequiredMessages(career.inbox!).map((m) => m.id)).toEqual([msg.id]);
    msg.replied = 'back';
    expect(unresolvedRequiredMessages(career.inbox!)).toHaveLength(0);
  });

  it('caps off-field momentum so narrative cannot decide matches alone', () => {
    expect(cappedOffFieldMomentumDelta(50, false)).toBe(4);
    expect(cappedOffFieldMomentumDelta(-50, false)).toBe(-4);
    expect(cappedOffFieldMomentumDelta(50, true)).toBe(6);
  });

  it('classifies team expectations from squad strength', () => {
    expect(expectationTierForStrength(90)).toBe('favourite');
    expect(expectationTierForStrength(84)).toBe('contender');
    expect(expectationTierForStrength(78)).toBe('dark-horse');
    expect(expectationTierForStrength(73)).toBe('outsider');
    expect(expectationTierForStrength(70)).toBe('minnow');

    const brazil = TEAMS.find((team) => team.id === 'brazil')!;
    expect(teamNarrativeProfile(brazil)).toMatchObject({
      teamName: 'Brazil',
      expectationTier: 'favourite',
    });
  });

  it('judges the same scoreline differently by expectation and opponent strength', () => {
    const brazil = TEAMS.find((team) => team.id === 'brazil')!;
    const capeVerde = TEAMS.find((team) => team.id === 'cape-verde')!;

    expect(assessMatchPerformance(brazil, capeVerde, [1, 1], 0).mood).toBe('collapse');
    expect(assessMatchPerformance(capeVerde, brazil, [1, 1], 0).mood).toBe('heroic');
  });
});
