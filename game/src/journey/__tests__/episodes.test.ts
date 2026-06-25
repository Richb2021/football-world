import { describe, expect, it } from 'vitest';
import { STORY_CAMPAIGNS, storyCampaignById, storyModeMenuCopy } from '../campaigns';
import { allEpisodes, getEpisodeById } from '../episodes';
import storySource from '../episodes/internationalCupStory.ts?raw';
import lastDanceSource from '../episodes/lastDanceStory.ts?raw';
import twoPassportsSource from '../episodes/twoPassportsStory.ts?raw';
import type { Choice, ChoiceConsequence, JourneyMatchId, JourneyState, Scene, StoryGate } from '../types';
import { applyConsequences, createNewJourney, getAvailableDialogue } from '../state';
import { getAvailableStoryEntries, resolveStoryRoute } from '../storyLogic';

function choicesWithMatches(campaignId?: string): Choice[] {
  const episodes = campaignId
    ? allEpisodes.filter((episode) => episode.campaignId === campaignId)
    : allEpisodes;
  return episodes.flatMap((episode) =>
    episode.scenes.flatMap((scene) => scene.choices ?? []).filter((choice) => choice.match),
  );
}

function choicesInCampaign(campaignId?: string): Choice[] {
  const episodes = campaignId
    ? allEpisodes.filter((episode) => episode.campaignId === campaignId)
    : allEpisodes;
  return episodes.flatMap((episode) => episode.scenes.flatMap((candidate) => candidate.choices ?? []));
}

function choiceGates(choice: Choice): StoryGate[] {
  return [
    ...(choice.gates ?? []),
    ...(choice.routes ?? []).flatMap((route) => route.gates ?? []),
    ...(choice.postMatchRoutes ?? []).flatMap((route) => route.gates ?? []),
  ];
}

function choiceConsequences(choice: Choice): ChoiceConsequence[] {
  return [
    ...choice.consequences,
    ...(choice.routes ?? []).flatMap((route) => route.consequences ?? []),
    ...(choice.postMatchRoutes ?? []).flatMap((route) => route.consequences ?? []),
  ];
}

function seasonCompleteChoices(campaignId: JourneyState['campaignId']): Choice[] {
  return choicesInCampaign(campaignId).filter((choice) =>
    choice.nextSceneId === 'season_complete'
    || choiceConsequences(choice).some((consequence) =>
      consequence.type === 'nextEpisode' && consequence.episodeId === 'season_complete',
    ),
  );
}

function makeState(overrides: Partial<JourneyState> = {}): JourneyState {
  return {
    campaignId: 'international-cup-story',
    episodeId: 'rtg_ep1_release',
    sceneId: 'scene1_hospital',
    storyRole: 'player',
    playerName: 'Jordan Reeves',
    playerPosition: 'FW',
    clubId: 'fictional-united',
    stats: {
      pace: 58,
      shooting: 48,
      passing: 62,
      dribbling: 57,
      defending: 50,
      physical: 55,
      mental: 56,
    },
    relationships: {
      doctor_evans: 0,
      manager_clough: 0,
      agent_coyle: 0,
    },
    reputation: 20,
    storyFlags: {},
    inventory: [],
    trainingFocus: 'balanced',
    matchPerformance: [],
    episodeHistory: [],
    storyPressure: 0,
    storyMorale: 0,
    pressPressure: 1,
    fanPressure: 0,
    injuryRisk: 0,
    isComplete: false,
    ...overrides,
  };
}

function scene(episodeId: string, sceneId: string): Scene {
  const episode = getEpisodeById(episodeId);
  const found = episode?.scenes.find((candidate) => candidate.id === sceneId);
  if (!found) throw new Error(`Missing scene ${episodeId}/${sceneId}`);
  return found;
}

function matchChoice(matchId: JourneyMatchId | string): Choice {
  const found = choicesWithMatches().find((choice) => choice.match?.matchId === matchId);
  if (!found) throw new Error(`Missing match choice for ${matchId}`);
  return found;
}

function countFlagMentions(flag: string): number {
  return storySource.match(new RegExp(escapeRegExp(flag), 'g'))?.length ?? 0;
}

function countFlagSetters(flag: string): number {
  return storySource.match(new RegExp(`flag\\(['"]${escapeRegExp(flag)}['"]`, 'g'))?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function visibleDialogue(episodeId: string, sceneId: string, state: JourneyState): string {
  return getAvailableDialogue(state, scene(episodeId, sceneId).dialogue)
    .map((entry) => entry.text)
    .join('\n');
}

function visibleChoices(episodeId: string, sceneId: string, state: JourneyState): Choice[] {
  return getAvailableStoryEntries(state, scene(episodeId, sceneId).choices ?? []);
}

describe('Journey episode chain', () => {
  it('defines the player-facing international cup story campaign', () => {
    const campaign = storyCampaignById('international-cup-story');

    expect(campaign.title).toBe('Road to Glory');
    expect(campaign.seasonLabel).toBe('2026');
    expect(campaign.description).toContain('pressure');
    expect(campaign.description).not.toMatch(/career-threatening|leading your country|International Cup 2026/i);
  });

  it('defines the new international identity campaigns as separate stories', () => {
    expect(storyCampaignById('last-dance-story').title).toBe('The Last Dance');
    expect(storyCampaignById('last-dance-story').description).toContain('one more summer');
    expect(storyCampaignById('last-dance-story').description).not.toMatch(/retired legend|first World Cup|destroy his body/i);
    expect(storyCampaignById('two-passports-story').title).toBe('Two Passports');
    expect(storyCampaignById('two-passports-story').description).toContain('international call-up');
    expect(storyCampaignById('two-passports-story').description).not.toMatch(/overlooked|country that ignored him|World Cup return/i);
  });

  it('defines the historic drama campaigns with period contact modes', () => {
    expect(storyCampaignById('miners-cup-story').title).toBe('The Miners\' Cup');
    expect(storyCampaignById('miners-cup-story').seasonLabel).toBe('1909');
    expect(storyCampaignById('miners-cup-story').contactMode).toBe('cablegram');
    expect(storyCampaignById('miners-cup-story').description).toContain('coalfield');

    expect(storyCampaignById('first-eleven-story').title).toBe('The First Eleven');
    expect(storyCampaignById('first-eleven-story').seasonLabel).toBe('1872');
    expect(storyCampaignById('first-eleven-story').contactMode).toBe('telegram');
    expect(storyCampaignById('first-eleven-story').description).toContain('first international');
  });

  it('registers every story campaign as a playable story-mode card', () => {
    expect(STORY_CAMPAIGNS.map((campaign) => campaign.id)).toEqual([
      'international-cup-story',
      'last-dance-story',
      'two-passports-story',
      'miners-cup-story',
      'first-eleven-story',
    ]);
  });

  it('advertises the full story count in the story-mode picker', () => {
    expect(storyModeMenuCopy()).toBe('Choose one of 5 playable stories where off-field decisions change the matches.');
    expect(storyModeMenuCopy()).not.toContain('International Cup');
  });

  it('starts new saves in the road to glory campaign with the right opening episode', () => {
    const rtg = createNewJourney('Jordan Reeves', 'FW', 'fictional-united', 'international-cup-story');

    expect(rtg.campaignId).toBe('international-cup-story');
    expect(rtg.episodeId).toBe('rtg_ep1_release');
  });

  it('starts new saves in each new campaign at its bespoke opening scene', () => {
    const lastDance = createNewJourney('Tomas Andrade', 'FW', 'cape-verde', 'last-dance-story');
    const twoPassports = createNewJourney('Malik Carter', 'MF', 'haiti', 'two-passports-story');
    const minersCup = createNewJourney('Tommy Kerr', 'MF', 'auckland-colliers', 'miners-cup-story');
    const firstEleven = createNewJourney('Andrew Kerr', 'DF', 'scotland', 'first-eleven-story');

    expect(lastDance).toMatchObject({
      campaignId: 'last-dance-story',
      episodeId: 'ld_ep1_call',
      sceneId: 'scene1_academy',
      clubId: 'cape-verde',
      injuryRisk: 4,
    });
    expect(twoPassports).toMatchObject({
      campaignId: 'two-passports-story',
      episodeId: 'tp_ep1_snub',
      sceneId: 'scene1_squad_list',
      clubId: 'haiti',
      storyPressure: 1,
    });
    expect(minersCup).toMatchObject({
      campaignId: 'miners-cup-story',
      episodeId: 'mc_ep1_invite',
      sceneId: 'scene1_shift_end',
      clubId: 'auckland-colliers',
      contactMode: 'cablegram',
      storyPressure: 2,
    });
    expect(firstEleven).toMatchObject({
      campaignId: 'first-eleven-story',
      episodeId: 'fe_ep1_challenge',
      sceneId: 'scene1_newspaper',
      clubId: 'scotland',
      contactMode: 'telegram',
      storyMorale: 1,
    });
  });

  it('includes the Road to Glory campaign episodes', () => {
    expect(allEpisodes.filter((episode) => episode.campaignId === 'international-cup-story').map((episode) => episode.id)).toEqual([
      'rtg_ep1_release',
      'rtg_ep2_fightback',
      'rtg_ep3_tension',
      'rtg_ep4_groups',
      'rtg_ep5_final',
    ]);
  });

  it('includes bespoke episode chains for the two new stories', () => {
    expect(allEpisodes.filter((episode) => episode.campaignId === 'last-dance-story').map((episode) => episode.id)).toEqual([
      'ld_ep1_call',
      'ld_ep2_camp',
      'ld_ep3_group',
      'ld_ep4_legacy',
    ]);
    expect(allEpisodes.filter((episode) => episode.campaignId === 'two-passports-story').map((episode) => episode.id)).toEqual([
      'tp_ep1_snub',
      'tp_ep2_two_calls',
      'tp_ep3_cap_tie',
      'tp_ep4_playoff',
      'tp_ep5_between_names',
    ]);
    expect(allEpisodes.filter((episode) => episode.campaignId === 'miners-cup-story').map((episode) => episode.id)).toEqual([
      'mc_ep1_invite',
      'mc_ep2_turin',
      'mc_ep3_first_cup',
      'mc_ep4_defence',
    ]);
    expect(allEpisodes.filter((episode) => episode.campaignId === 'first-eleven-story').map((episode) => episode.id)).toEqual([
      'fe_ep1_challenge',
      'fe_ep2_hamilton',
      'fe_ep3_first_whistle',
    ]);
  });

  it('contains playable fixtures for trial, comeback, and final matches', () => {
    const matchIds = choicesWithMatches('international-cup-story').map((choice) => choice.match!.matchId);
    const required: JourneyMatchId[] = [
      'rtg_trial',
      'rtg_league_comeback',
      'rtg_final_chance',
      'rtg_group_stage',
      'rtg_world_cup_final',
    ];

    expect(matchIds).toEqual(required);
  });

  it('contains playable fixtures for the two new campaigns', () => {
    expect(choicesWithMatches('last-dance-story').map((choice) => choice.match!.matchId)).toEqual([
      'ld_return_friendly',
      'ld_group_decider',
    ]);
    expect(choicesWithMatches('two-passports-story').map((choice) => choice.match!.matchId)).toEqual([
      'tp_showcase_match',
      'tp_heritage_playoff',
      'tp_birth_trial',
      'tp_worldcup_vs_birth',
    ]);
    expect(choicesWithMatches('miners-cup-story').map((choice) => choice.match!.matchId)).toEqual([
      'mc_turin_semi',
      'mc_turin_final',
      'mc_turin_defence',
    ]);
    expect(choicesWithMatches('first-eleven-story').map((choice) => choice.match!.matchId)).toEqual([
      'fe_hamilton_crescent',
    ]);
  });

  it('routes the club-arc playable matches by result', () => {
    expect(matchChoice('rtg_trial').postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene5_trial_verdict_win',
      'scene5_trial_verdict_draw',
      'scene5_trial_verdict_loss',
    ]);
    expect(matchChoice('rtg_league_comeback').postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene5_match_aftermath_win',
      'scene5_match_aftermath_draw',
      'scene5_match_aftermath_loss',
    ]);
    expect(matchChoice('rtg_final_chance').postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene8_scout_call_win',
      'scene8_scout_call_draw',
      'scene8_scout_call_loss_hearing_reputation',
      'scene8_scout_call_loss_hearing_mental',
      'scene8_scout_call_loss_hearing_trust',
      'scene8_scout_call_loss_lifeline',
    ]);
  });

  it('gives every playable story match win draw and loss routes', () => {
    for (const choice of choicesWithMatches()) {
      const results = new Set(
        choice.postMatchRoutes?.flatMap((route) =>
          route.gates?.filter((gate) => gate.type === 'matchResult').map((gate) => gate.result) ?? [],
        ),
      );

      expect(results).toEqual(new Set(['win', 'draw', 'loss']));
    }
  });

  it('pays off major Road to Glory flags later in the story source', () => {
    const majorFlags = [
      'rtg_aggr_rehab',
      'rtg_slow_rehab',
      'rtg_rested_knee',
      'rtg_pushed_knee',
      'rtg_chose_loyalty',
      'rtg_chose_money',
      'rtg_exposed_dane',
      'rtg_fuelled_by_dane',
      'rtg_dane_redeemed',
      'rtg_playing_for_dad',
      'rtg_bottled_crisis',
      'rtg_nearly_left',
      'rtg_kept_shirt',
      'rtg_dropped_grace',
      'rtg_final_honest',
      'rtg_final_injection',
      'rtg_final_hid_injury',
    ];

    for (const flag of majorFlags) {
      const mentions = countFlagMentions(flag);
      const setters = countFlagSetters(flag);
      expect(setters, `${flag} should be set by a story consequence`).toBeGreaterThanOrEqual(1);
      expect(mentions - setters, `${flag} should have at least one non-setter payoff reference`).toBeGreaterThanOrEqual(1);
    }
  });

  it('pays off major Last Dance and Two Passports flags later in their story sources', () => {
    const flagChecks = [
      [lastDanceSource, [
        'ld_returned_as_mentor',
        'ld_returned_to_compete',
        'ld_hid_knee_from_lina',
        'ld_managed_minutes',
        'ld_outshone_elian',
        'ld_built_around_elian',
        'ld_qualified_at_cost',
        'ld_qualified_with_elian',
        'ld_group_heartbreak',
      ]],
      [twoPassportsSource, [
        'tp_silent_after_snub',
        'tp_called_tokenism',
        'tp_gran_anchor',
        'tp_birth_trial',
        'tp_visited_heritage_camp',
        'tp_chose_birth',
        'tp_chose_heritage',
        'tp_spoke_language',
        'tp_heritage_qualified',
        'tp_birth_cap_hollow',
      ]],
    ] as const;

    for (const [source, flags] of flagChecks) {
      for (const flag of flags) {
        const mentions = source.match(new RegExp(escapeRegExp(flag), 'g'))?.length ?? 0;
        const setters = source.match(new RegExp(`flag\\(['"]${escapeRegExp(flag)}['"]`, 'g'))?.length ?? 0;
        expect(setters, `${flag} should be set by a story consequence`).toBeGreaterThanOrEqual(1);
        expect(mentions - setters, `${flag} should have at least one non-setter payoff reference`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('uses player stats as story gates in Road to Glory', () => {
    const routeStatGates = allEpisodes.flatMap((episode) =>
      episode.scenes.flatMap((candidate) =>
        (candidate.choices ?? []).flatMap((choice) =>
          [...(choice.routes ?? []), ...(choice.postMatchRoutes ?? [])]
            .flatMap((route) => route.gates ?? [])
            .filter((gate) => gate.type === 'stat'),
        ),
      ),
    );
    const choiceStatGates = allEpisodes.flatMap((episode) =>
      episode.scenes.flatMap((candidate) =>
        (candidate.choices ?? [])
          .flatMap((choice) => choice.gates ?? [])
          .filter((gate) => gate.type === 'stat'),
      ),
    );

    expect([...routeStatGates, ...choiceStatGates].length).toBeGreaterThan(0);
  });

  it('uses player stats and relationships as consequential gates in the new stories', () => {
    const newStoryGates = allEpisodes
      .filter((episode) => episode.campaignId === 'last-dance-story' || episode.campaignId === 'two-passports-story')
      .flatMap((episode) =>
        episode.scenes.flatMap((candidate) =>
          (candidate.choices ?? []).flatMap((choice) => [
            ...(choice.gates ?? []),
            ...(choice.routes ?? []).flatMap((route) => route.gates ?? []),
            ...(choice.postMatchRoutes ?? []).flatMap((route) => route.gates ?? []),
          ]),
        ),
      );

    expect(newStoryGates.some((gate) => gate.type === 'stat')).toBe(true);
    expect(newStoryGates.some((gate) => gate.type === 'relationship')).toBe(true);
  });

  it('uses press and fan pressure as story gates and consequences for replayable public narratives', () => {
    const gates = choicesInCampaign().flatMap(choiceGates);
    const consequences = choicesInCampaign().flatMap(choiceConsequences);

    expect(gates.some((gate) => gate.type === 'pressPressure')).toBe(true);
    expect(gates.some((gate) => gate.type === 'fanPressure')).toBe(true);
    expect(consequences.some((consequence) => consequence.type === 'pressPressure')).toBe(true);
    expect(consequences.some((consequence) => consequence.type === 'fanPressure')).toBe(true);
  });

  it('gives every story enough complete endings to make replays meaningfully different', () => {
    expect(seasonCompleteChoices('international-cup-story').length).toBeGreaterThanOrEqual(5);
    expect(seasonCompleteChoices('last-dance-story').length).toBeGreaterThanOrEqual(5);
    expect(seasonCompleteChoices('two-passports-story').length).toBeGreaterThanOrEqual(8);
    expect(seasonCompleteChoices('miners-cup-story').length).toBeGreaterThanOrEqual(5);
    expect(seasonCompleteChoices('first-eleven-story').length).toBeGreaterThanOrEqual(4);
  });

  it('adds reversal scenes before decisive story choices so the arcs do not play straight through', () => {
    expect(getEpisodeById('ld_ep3_group')?.scenes.map((candidate) => candidate.id)).toContain('scene2b_knee_lock');
    expect(getEpisodeById('tp_ep3_cap_tie')?.scenes.map((candidate) => candidate.id)).toContain('scene2_leaked_papers');
    expect(getEpisodeById('mc_ep3_first_cup')?.scenes.map((candidate) => candidate.id)).toContain('scene1b_stolen_cable');
    expect(getEpisodeById('mc_ep4_defence')?.scenes.map((candidate) => candidate.id)).toContain('scene1b_walkout_threat');
    expect(getEpisodeById('fe_ep2_hamilton')?.scenes.map((candidate) => candidate.id)).toContain('scene1b_rules_crisis');
    expect(getEpisodeById('fe_ep3_first_whistle')?.scenes.map((candidate) => candidate.id)).toContain('scene1b_report_pressure');
  });

  it('routes decisive story moments through those reversal scenes', () => {
    expect(visibleChoices('ld_ep3_group', 'scene2_tunnel', makeState())[0]?.nextSceneId).toBe('scene2b_knee_lock');
    expect(visibleChoices('tp_ep3_cap_tie', 'scene1_deadline', makeState())[0]?.nextSceneId).toBe('scene2_leaked_papers');
    expect(visibleChoices('mc_ep3_first_cup', 'scene1_hotel', makeState())[0]?.nextSceneId).toBe('scene1b_stolen_cable');
    expect(visibleChoices('mc_ep4_defence', 'scene1_return', makeState())[0]?.nextSceneId).toBe('scene1b_walkout_threat');
    expect(visibleChoices('fe_ep2_hamilton', 'scene1_pavilion', makeState())[0]?.nextSceneId).toBe('scene1b_rules_crisis');
    expect(visibleChoices('fe_ep3_first_whistle', 'scene1_report', makeState())[0]?.nextSceneId).toBe('scene1b_report_pressure');
  });

  it('routes the group match by result', () => {
    expect(matchChoice('rtg_group_stage').postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene5_selection_win',
      'scene5_selection_draw',
      'scene5_selection_loss',
    ]);
  });

  it('resolves club decider routes using reachable player state', () => {
    const choice = matchChoice('rtg_final_chance');
    const withResult = (state: JourneyState, result: 'win' | 'draw' | 'loss') => ({
      ...state,
      matchPerformance: [
        {
          matchId: 'rtg_final_chance',
          date: '2026',
          opponent: 'Kingsbridge City',
          result,
          score: result === 'win' ? [2, 1] as [number, number] : result === 'draw' ? [1, 1] as [number, number] : [0, 1] as [number, number],
          goalMargin: result === 'win' ? 1 : result === 'draw' ? 0 : -1,
          minutesPlayed: 90,
          rating: result === 'win' ? 7.4 : 5.8,
          goals: 0,
          assists: 0,
          keyPasses: 1,
          tackles: 1,
        },
      ],
    });

    expect(resolveStoryRoute(withResult(makeState(), 'win'), choice.postMatchRoutes, choice.nextSceneId).nextSceneId)
      .toBe('scene8_scout_call_win');
    expect(resolveStoryRoute(withResult(makeState(), 'draw'), choice.postMatchRoutes, choice.nextSceneId).nextSceneId)
      .toBe('scene8_scout_call_draw');
    expect(resolveStoryRoute(withResult(makeState({ reputation: 34 }), 'loss'), choice.postMatchRoutes, choice.nextSceneId).nextSceneId)
      .toBe('scene8_scout_call_loss_hearing_reputation');
    expect(resolveStoryRoute(withResult(makeState({ reputation: 20, stats: { ...makeState().stats, mental: 60 } }), 'loss'), choice.postMatchRoutes, choice.nextSceneId).nextSceneId)
      .toBe('scene8_scout_call_loss_hearing_mental');
    expect(resolveStoryRoute(withResult(makeState({ reputation: 20, relationships: { captain_whitlock: 2 } }), 'loss'), choice.postMatchRoutes, choice.nextSceneId).nextSceneId)
      .toBe('scene8_scout_call_loss_hearing_trust');
    expect(resolveStoryRoute(withResult(makeState({ reputation: 20, relationships: { captain_whitlock: 0 } }), 'loss'), choice.postMatchRoutes, choice.nextSceneId).nextSceneId)
      .toBe('scene8_scout_call_loss_lifeline');
  });

  it('contains distinct clean win, costly win, and loss final branches', () => {
    const final = getEpisodeById('rtg_ep5_final');
    const ids = final?.scenes.map((candidate) => candidate.id) ?? [];

    expect(ids).toContain('scene4_final_win_clean');
    expect(ids).toContain('scene4_final_win_cost');
    expect(ids).toContain('scene5_medical_cost');
    expect(ids).toContain('scene4_final_loss_harsh');
    expect(ids).toContain('scene4_final_loss_bittersweet');
    expect(ids).toContain('scene5_loss_aftermath');
  });

  it('prioritises final routes deterministically', () => {
    const playFinal = matchChoice('rtg_world_cup_final');

    expect(playFinal.postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene4_final_win_cost',
      'scene4_final_win_clean',
      'scene4_final_loss_harsh',
      'scene4_final_loss_harsh',
      'scene4_final_loss_harsh',
      'scene4_final_loss_bittersweet',
      'scene4_final_loss_bittersweet',
    ]);
  });

  it('prioritises new story routes so high-cost and trust outcomes beat generic results', () => {
    expect(matchChoice('ld_group_decider').postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene4_decider_win_cost',
      'scene4_decider_win_legacy',
      'scene4_decider_win_legend',
      'scene4_decider_draw',
      'scene4_decider_loss',
    ]);
    expect(matchChoice('tp_birth_trial').postMatchRoutes?.map((route) => route.nextSceneId)).toEqual([
      'scene4_birth_squad_place',
      'scene4_birth_bench',
      'scene4_birth_hollow_cap',
      'scene4_birth_hollow_cap',
    ]);
  });

  it('keeps every reachable Two Passports final-crossroads route renderable', () => {
    const finalStates = [
      makeState({ storyFlags: { tp_heritage_qualified: true } }),
      makeState({ storyFlags: { tp_birth_squad_place: true } }),
      makeState({ storyFlags: { tp_birth_cap_hollow: true } }),
      makeState({ storyFlags: { tp_heritage_nearly: true } }),
      makeState({ storyFlags: { tp_heritage_heartbreak: true } }),
      makeState({ storyFlags: { tp_birth_bench: true } }),
    ];

    for (const candidate of finalStates) {
      expect(visibleDialogue('tp_ep5_between_names', 'scene1_final_crossroads', candidate).length).toBeGreaterThan(0);
      expect(visibleChoices('tp_ep5_between_names', 'scene1_final_crossroads', candidate).length).toBeGreaterThan(0);
    }
  });

  it('can reach the Two Passports bridge-win route from a heritage-qualified path', () => {
    const playVsBirth = matchChoice('tp_worldcup_vs_birth');
    const stateAfterHeritageQualification = applyConsequences(makeState({
      storyFlags: { tp_heritage_qualified: true },
      relationships: { tp_birth_teammate_brooks: 0 },
    }), visibleChoices('tp_ep5_between_names', 'scene1_final_crossroads', makeState({
      storyFlags: { tp_heritage_qualified: true },
      relationships: { tp_birth_teammate_brooks: 0 },
    })).find((choice) => choice.id === 'tp-respect-birth')?.consequences ?? []);

    const stateAfterWorldCupWin: JourneyState = {
      ...stateAfterHeritageQualification,
      matchPerformance: [
        {
          matchId: 'tp_worldcup_vs_birth',
          date: '2026',
          opponent: 'United States',
          result: 'win',
          score: [2, 1] as [number, number],
          goalMargin: 1,
          minutesPlayed: 90,
          rating: 8,
          goals: 1,
          assists: 0,
          keyPasses: 2,
          tackles: 2,
        },
      ],
    };

    expect(stateAfterHeritageQualification.relationships.tp_birth_teammate_brooks).toBeGreaterThanOrEqual(1);
    expect(resolveStoryRoute(stateAfterWorldCupWin, playVsBirth.postMatchRoutes, playVsBirth.nextSceneId).nextSceneId)
      .toBe('scene2_bridge_win');
  });

  it('filters conditional dialogue by state', () => {
    const dialogue = getAvailableDialogue(makeState({ storyFlags: { honest: true } }), [
      { speakerId: 'narrator', text: 'Always shown' },
      { speakerId: 'narrator', text: 'Honest branch', condition: (state) => !!state.storyFlags.honest },
      { speakerId: 'narrator', text: 'Hidden branch', condition: (state) => !!state.storyFlags.hidden },
    ]);

    expect(dialogue.map((entry) => entry.text)).toEqual(['Always shown', 'Honest branch']);
  });
});
