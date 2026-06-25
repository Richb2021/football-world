import { describe, expect, it } from 'vitest';
import type { JourneyState } from '../types';
import { buildJourneyMatchConfig, isJourneyTrophyMatch, recordJourneyMatchOutcome } from '../matches';

function makeState(overrides: Partial<JourneyState> = {}): JourneyState {
  return {
    campaignId: 'international-cup-story',
    episodeId: 'rtg_ep1_release',
    sceneId: 'scene4_trial_match',
    storyRole: 'player',
    playerName: 'Jordan Reeves',
    playerPosition: 'FW',
    clubId: 'fictional-united',
    stats: {
      pace: 62,
      shooting: 58,
      passing: 71,
      dribbling: 67,
      defending: 55,
      physical: 60,
      mental: 64,
    },
    relationships: {},
    reputation: 25,
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

describe('Journey match fixtures', () => {
  it('builds a playable training-ground match with the Journey player in the reserves XI', () => {
    const resolved = buildJourneyMatchConfig(
      { matchId: 'rtg_trial' },
      makeState(),
      { halfLengthSec: 90, difficulty: 1, seed: 123 },
    );

    expect(resolved.localTeam).toBe(1);
    expect(resolved.usePrematch).toBe(false);
    expect(resolved.cfg.venueProfile).toBe('training');
    expect(resolved.cfg.crowdDensity).toBe('empty');
    expect(resolved.cfg.teams[1].data.players.some((p) => p.name === 'Jordan Reeves')).toBe(true);
    const journeyPlayerIdx = resolved.cfg.teams[1].data.players.findIndex((p) => p.name === 'Jordan Reeves');
    expect(resolved.cfg.teams[1].lineup.starters).toContain(journeyPlayerIdx);
  });

  it('sets up comeback scenario starting conditions for rtg_league_comeback', () => {
    const resolved = buildJourneyMatchConfig(
      { matchId: 'rtg_league_comeback' },
      makeState(),
      { halfLengthSec: 90, difficulty: 1, seed: 321 },
    );

    expect(resolved.localTeam).toBe(0);
    expect(resolved.usePrematch).toBe(true);
    expect(resolved.cfg.isFriendly).toBe(false);
    expect(resolved.cfg.startScore).toEqual([0, 1]);
    expect(resolved.cfg.startHalf).toBe(2);
    expect(resolved.cfg.teams[0].data.players.some((p) => p.name === 'Jordan Reeves')).toBe(true);
  });

  it('builds England versus Germany for group stage', () => {
    const resolved = buildJourneyMatchConfig(
      { matchId: 'rtg_group_stage' },
      makeState({ playerName: 'Jordan Reeves', playerPosition: 'FW' }),
      { halfLengthSec: 90, difficulty: 2, seed: 456 },
    );

    expect(resolved.localTeam).toBe(0);
    expect(resolved.cfg.teams[0].data.name).toBe('England');
    expect(resolved.cfg.teams[1].data.name).toBe('Germany');
    expect(resolved.cfg.teams[0].data.players.some((p) => p.name === 'Jordan Reeves')).toBe(true);
  });

  it('builds Last Dance fixtures with an older Cape Verde Journey player', () => {
    const friendly = buildJourneyMatchConfig(
      { matchId: 'ld_return_friendly' },
      makeState({ campaignId: 'last-dance-story', playerName: 'Tomas Andrade', stats: { ...makeState().stats, pace: 48, shooting: 74 } }),
      { halfLengthSec: 90, difficulty: 2, seed: 111 },
    );
    const decider = buildJourneyMatchConfig(
      { matchId: 'ld_group_decider' },
      makeState({ campaignId: 'last-dance-story', playerName: 'Tomas Andrade' }),
      { halfLengthSec: 90, difficulty: 2, seed: 112 },
    );

    expect(friendly.localTeam).toBe(0);
    expect(friendly.cfg.teams[0].data.name).toBe('Cape Verde');
    expect(friendly.cfg.teams[1].data.name).toBe('Curacao');
    expect(friendly.cfg.teams[0].data.players.find((p) => p.name === 'Tomas Andrade')).toMatchObject({
      age: 39,
      pace: 48,
      shoot: 74,
    });
    expect(decider.cfg.teams[1].data.name).toBe('Germany');
  });

  it('builds Two Passports showcase, trial, playoff, and birth-country payoff fixtures', () => {
    const state = makeState({ campaignId: 'two-passports-story', playerName: 'Malik Carter', playerPosition: 'MF' });
    const showcase = buildJourneyMatchConfig(
      { matchId: 'tp_showcase_match' },
      state,
      { halfLengthSec: 90, difficulty: 1, seed: 211 },
    );
    const trial = buildJourneyMatchConfig(
      { matchId: 'tp_birth_trial' },
      state,
      { halfLengthSec: 90, difficulty: 1, seed: 212 },
    );
    const playoff = buildJourneyMatchConfig(
      { matchId: 'tp_heritage_playoff' },
      state,
      { halfLengthSec: 90, difficulty: 2, seed: 213 },
    );
    const birth = buildJourneyMatchConfig(
      { matchId: 'tp_worldcup_vs_birth' },
      state,
      { halfLengthSec: 90, difficulty: 2, seed: 214 },
    );

    expect(showcase.cfg.teams[0].data.name).toBe('Metro FC');
    expect(showcase.cfg.teams[0].data.players.some((p) => p.name === 'Malik Carter')).toBe(true);
    expect(trial.localTeam).toBe(1);
    expect(trial.usePrematch).toBe(false);
    expect(trial.cfg.venueProfile).toBe('training');
    expect(trial.cfg.teams[1].data.name).toBe('USA Trialists');
    expect(trial.cfg.teams[1].data.players.some((p) => p.name === 'Malik Carter')).toBe(true);
    expect(playoff.cfg.teams[0].data.name).toBe('Haiti');
    expect(playoff.cfg.teams[1].data.name).toBe('Canada');
    expect(birth.cfg.teams[0].data.name).toBe('Haiti');
    expect(birth.cfg.teams[1].data.name).toBe('United States');
  });

  it('builds Miners Cup historic fixtures with fictional teams and the Journey player', () => {
    const state = makeState({
      campaignId: 'miners-cup-story',
      playerName: 'Tommy Kerr',
      playerPosition: 'MF',
      clubId: 'auckland-colliers',
    });
    const semi = buildJourneyMatchConfig(
      { matchId: 'mc_turin_semi' },
      state,
      { halfLengthSec: 90, difficulty: 2, seed: 311 },
    );
    const final = buildJourneyMatchConfig(
      { matchId: 'mc_turin_defence' },
      state,
      { halfLengthSec: 90, difficulty: 3, seed: 312 },
    );

    expect(semi.localTeam).toBe(0);
    expect(semi.cfg.teams[0].data.name).toBe('Auckland Colliers');
    expect(semi.cfg.teams[1].data.name).toBe('Stuttgart Foundry');
    expect(semi.cfg.teams[0].data.players.some((p) => p.name === 'Tommy Kerr')).toBe(true);
    expect(semi.cfg.teams[0].lineup.formation).toBe('2-3-5');
    expect(semi.cfg.era).toMatchObject({ year: 1909, substitutionLimit: 0, fireworks: false });
    expect(final.cfg.teams[1].data.name).toBe('Turin Mechanics');
    expect(final.cfg.era).toMatchObject({ year: 1911, substitutionLimit: 0, fireworks: false });
  });

  it('builds the First Eleven fixture as a fictionalised Scotland v England international', () => {
    const fixture = buildJourneyMatchConfig(
      { matchId: 'fe_hamilton_crescent' },
      makeState({
        campaignId: 'first-eleven-story',
        playerName: 'Andrew Kerr',
        playerPosition: 'DF',
        clubId: 'scotland',
      }),
      { halfLengthSec: 90, difficulty: 2, seed: 411 },
    );

    expect(fixture.localTeam).toBe(0);
    expect(fixture.cfg.teams[0].data.name).toBe('Caledonia Eleven');
    expect(fixture.cfg.teams[1].data.name).toBe('Albion Association');
    expect(fixture.cfg.teams[0].data.players.some((p) => p.name === 'Andrew Kerr')).toBe(true);
    expect(fixture.cfg.crowdDensity).toBe('sparse');
    expect(fixture.cfg.teams[0].lineup.formation).toBe('2-3-5');
    expect(fixture.cfg.teams[1].lineup.formation).toBe('2-3-5');
    expect(fixture.cfg.era).toMatchObject({ year: 1872, substitutionLimit: 0, fireworks: false });
  });

  it('marks only Journey trophy finals for the full-time trophy presentation', () => {
    const worldCupFinal = buildJourneyMatchConfig(
      { matchId: 'rtg_world_cup_final' },
      makeState(),
      { halfLengthSec: 90, difficulty: 2, seed: 501 },
    );
    const groupDecider = buildJourneyMatchConfig(
      { matchId: 'ld_group_decider' },
      makeState({ campaignId: 'last-dance-story', playerName: 'Tomas Andrade' }),
      { halfLengthSec: 90, difficulty: 2, seed: 502 },
    );

    expect(isJourneyTrophyMatch('rtg_world_cup_final')).toBe(true);
    expect(isJourneyTrophyMatch('mc_turin_final')).toBe(true);
    expect(isJourneyTrophyMatch('mc_turin_defence')).toBe(true);
    expect(isJourneyTrophyMatch('rtg_final_chance')).toBe(false);
    expect(isJourneyTrophyMatch('ld_group_decider')).toBe(false);
    expect(worldCupFinal.cfg.trophyWin).toBe(true);
    expect(groupDecider.cfg.trophyWin).toBe(false);
  });

  it('records match outcomes and marks the Journey fixture as played', () => {
    const state = makeState();
    const next = recordJourneyMatchOutcome(
      state,
      { matchId: 'rtg_final_chance' },
      { score: [2, 1], winner: 0 },
      0,
    );

    expect(next.storyFlags.journey_match_rtg_final_chance_played).toBe(true);
    expect(next.matchPerformance).toHaveLength(1);
    expect(next.matchPerformance[0]).toMatchObject({
      matchId: 'rtg_final_chance',
      opponent: 'Kingsbridge City',
      result: 'win',
      score: [2, 1],
    });
  });

  it('classifies cup outcomes by winner when the score is level', () => {
    const next = recordJourneyMatchOutcome(
      makeState(),
      { matchId: 'rtg_world_cup_final' },
      { score: [1, 1], winner: 0 },
      0,
    );

    expect(next.matchPerformance.at(-1)?.result).toBe('win');
    expect(next.storyFlags.journey_match_rtg_world_cup_final_result_win).toBe(true);
    expect(next.storyFlags.journey_match_rtg_world_cup_final_result_draw).toBe(false);
    expect(next.storyFlags.journey_match_rtg_world_cup_final_result_loss).toBe(false);
  });

  it('writes explicit win, draw, and loss flags for the actual result only', () => {
    const win = recordJourneyMatchOutcome(
      makeState(),
      { matchId: 'rtg_trial' },
      { score: [0, 1], winner: 1 },
      1,
    );
    const draw = recordJourneyMatchOutcome(
      makeState(),
      { matchId: 'rtg_trial' },
      { score: [1, 1], winner: -1 },
      1,
    );
    const loss = recordJourneyMatchOutcome(
      makeState(),
      { matchId: 'rtg_trial' },
      { score: [2, 0], winner: 0 },
      1,
    );

    expectResultFlags(win.storyFlags, 'rtg_trial', 'win');
    expectResultFlags(draw.storyFlags, 'rtg_trial', 'draw');
    expectResultFlags(loss.storyFlags, 'rtg_trial', 'loss');
  });

  it('applies configured result consequences when recording a journey match', () => {
    const win = recordJourneyMatchOutcome(
      makeState({ storyPressure: 0, storyMorale: 0, reputation: 25 }),
      { matchId: 'rtg_league_comeback' },
      { score: [2, 1], winner: 0 },
      0,
    );
    const loss = recordJourneyMatchOutcome(
      makeState({ storyPressure: 0, storyMorale: 0, reputation: 25 }),
      { matchId: 'rtg_league_comeback' },
      { score: [0, 2], winner: 1 },
      0,
    );

    expect(win.reputation).toBeGreaterThan(25);
    expect(win.storyMorale).toBeGreaterThan(0);
    expect(loss.storyPressure).toBeGreaterThan(0);
    expect(loss.storyMorale).toBeLessThan(0);
  });

  it('applies distinct result consequences for the new story fixtures', () => {
    const lastDanceLoss = recordJourneyMatchOutcome(
      makeState({ campaignId: 'last-dance-story', storyPressure: 0, storyMorale: 0, injuryRisk: 4 }),
      { matchId: 'ld_return_friendly' },
      { score: [0, 2], winner: 1 },
      0,
    );
    const passportsWin = recordJourneyMatchOutcome(
      makeState({ campaignId: 'two-passports-story', storyPressure: 0, storyMorale: 0, reputation: 22 }),
      { matchId: 'tp_heritage_playoff' },
      { score: [2, 1], winner: 0 },
      0,
    );

    expect(lastDanceLoss.storyPressure).toBeGreaterThan(0);
    expect(lastDanceLoss.storyMorale).toBeLessThan(0);
    expect(lastDanceLoss.injuryRisk).toBeGreaterThan(4);
    expect(passportsWin.reputation).toBeGreaterThan(22);
    expect(passportsWin.storyMorale).toBeGreaterThan(0);
    expect(passportsWin.relationships.tp_heritage_captain_etienne).toBeGreaterThan(0);
  });

  it('records player-perspective goal margin for an away-side Journey player', () => {
    const next = recordJourneyMatchOutcome(
      makeState(),
      { matchId: 'rtg_trial' },
      { score: [3, 1], winner: 0 },
      1,
    );

    expect(next.matchPerformance.at(-1)?.result).toBe('loss');
    expect(next.matchPerformance.at(-1)?.goalMargin).toBe(-2);
  });
});

function expectResultFlags(
  flags: JourneyState['storyFlags'],
  matchId: string,
  actual: 'win' | 'draw' | 'loss',
): void {
  expect(flags[`journey_match_${matchId}_result_win`]).toBe(actual === 'win');
  expect(flags[`journey_match_${matchId}_result_draw`]).toBe(actual === 'draw');
  expect(flags[`journey_match_${matchId}_result_loss`]).toBe(actual === 'loss');
}
