import { describe, expect, it } from 'vitest';
import { createNewJourney } from '../state';
import {
  applyStoryNarrativeAfterMatch,
  applyStoryNarrativeOnSceneEnter,
  enrichSceneWithStoryNarrative,
  storyNarrativePulses,
} from '../storyNarrative';
import type { JourneyState, Scene } from '../types';

function state(campaignId: JourneyState['campaignId'], overrides: Partial<JourneyState> = {}): JourneyState {
  return {
    ...createNewJourney('Jordan Reeves', 'FW', 'fictional-united', campaignId),
    ...overrides,
  };
}

function blankScene(id = 'scene_test'): Scene {
  return {
    id,
    background: { type: 'lockerRoom', variant: 'before' },
    characters: [],
    dialogue: [{ speakerId: 'narrator', text: 'The room waits.' }],
    choices: [],
  };
}

describe('story narrative pulses', () => {
  it('selects campaign-specific jeopardy from pressure, morale, injury, and identity context', () => {
    const rtg = storyNarrativePulses(state('international-cup-story', { storyPressure: 6 }), 'scene1_hospital');
    const lastDance = storyNarrativePulses(state('last-dance-story', { injuryRisk: 8 }), 'scene1_camp');
    const passports = storyNarrativePulses(state('two-passports-story', { storyPressure: 6 }), 'scene1_final_crossroads');
    const miners = storyNarrativePulses(state('miners-cup-story', { storyMorale: -5 }), 'scene1_hotel');
    const firstEleven = storyNarrativePulses(state('first-eleven-story', { storyPressure: 5 }), 'scene1_report');

    expect(rtg.map((pulse) => pulse.id)).toContain('rtg_last_chance_noise');
    expect(lastDance.map((pulse) => pulse.id)).toContain('ld_body_cost');
    expect(passports.map((pulse) => pulse.id)).toContain('tp_identity_storm');
    expect(miners.map((pulse) => pulse.id)).toContain('mc_room_split');
    expect(firstEleven.map((pulse) => pulse.id)).toContain('fe_rules_under_fire');
  });

  it('surfaces press and fan pressure as campaign-specific public drama', () => {
    expect(storyNarrativePulses(state('international-cup-story', { pressPressure: 7 }), 'scene1_hospital').map((pulse) => pulse.id))
      .toContain('rtg_tabloid_heat');
    expect(storyNarrativePulses(state('last-dance-story', { fanPressure: 8 }), 'scene1_camp').map((pulse) => pulse.id))
      .toContain('ld_nation_expectation');
    expect(storyNarrativePulses(state('two-passports-story', { pressPressure: 7, fanPressure: 6 }), 'scene1_final_crossroads').map((pulse) => pulse.id))
      .toContain('tp_split_fanbases');
    expect(storyNarrativePulses(state('miners-cup-story', { fanPressure: 7 }), 'scene1_hotel').map((pulse) => pulse.id))
      .toContain('mc_coalfield_judgement');
    expect(storyNarrativePulses(state('first-eleven-story', { pressPressure: 7 }), 'scene1_report').map((pulse) => pulse.id))
      .toContain('fe_public_argument');
  });

  it('adds pulse messages once per scene without duplicating on reload', () => {
    const base = state('last-dance-story', { injuryRisk: 8 });
    const first = applyStoryNarrativeOnSceneEnter(base, 'scene1_camp');
    const second = applyStoryNarrativeOnSceneEnter(first, 'scene1_camp');

    expect(first.inbox?.messages.some((message) => message.id === 'story_pulse_scene1_camp_ld_body_cost')).toBe(true);
    expect(second.inbox?.messages.filter((message) => message.id === 'story_pulse_scene1_camp_ld_body_cost')).toHaveLength(1);
    expect(second.storyFlags.story_pulse_scene1_camp_ld_body_cost).toBe(true);
  });

  it('enriches scene dialogue with active pulse writing while preserving original dialogue', () => {
    const scene = blankScene();
    const enriched = enrichSceneWithStoryNarrative(scene, state('miners-cup-story', { storyMorale: -5 }));

    expect(enriched.dialogue[0].text).toBe('The room waits.');
    expect(enriched.dialogue.map((entry) => entry.text).join(' ').toLowerCase()).toMatch(/wages|rent|room|coalfield/);
    expect(enriched.dialogue.length).toBeGreaterThan(scene.dialogue.length);
  });

  it('records match-aftermath drama from the latest result', () => {
    const base = state('international-cup-story', {
      matchPerformance: [{
        matchId: 'rtg_final_chance',
        date: '2026',
        opponent: 'Kingsbridge City',
        result: 'loss',
        score: [0, 2],
        goalMargin: -2,
        minutesPlayed: 90,
        rating: 5.4,
        goals: 0,
        assists: 0,
        keyPasses: 1,
        tackles: 1,
      }],
    });

    const updated = applyStoryNarrativeAfterMatch(base, 'rtg_final_chance');

    expect(updated.storyFlags.story_match_pulse_rtg_final_chance_loss_reckoning).toBe(true);
    expect(updated.inbox?.messages.some((message) => message.id === 'story_match_pulse_rtg_final_chance_loss_reckoning')).toBe(true);
    expect(updated.pressPressure).toBeGreaterThan(base.pressPressure);
    expect(updated.fanPressure).toBeGreaterThan(base.fanPressure);
  });
});
