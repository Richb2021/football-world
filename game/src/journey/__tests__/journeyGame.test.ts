import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEpisodeById } from '../episodes';
import { JourneyGame, type JourneyCallbacks } from '../journeyGame';
import { createNewJourney } from '../state';
import type { Choice, JourneyState } from '../types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function installStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
}

function storyChoice(episodeId: string, sceneId: string, choiceId: string): Choice {
  const final = getEpisodeById(episodeId);
  const scene = final?.scenes.find((candidate) => candidate.id === sceneId);
  const choice = scene?.choices?.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error(`Missing final choice ${episodeId}/${sceneId}/${choiceId}`);
  return choice;
}

function finalChoice(sceneId: string, choiceId: string): Choice {
  return storyChoice('rtg_ep5_final', sceneId, choiceId);
}

function makeContainer(): HTMLElement & { innerHTML: string } {
  return {
    innerHTML: '',
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    querySelector: () => null,
  } as unknown as HTMLElement & { innerHTML: string };
}

function makeGame(
  state: JourneyState,
  container: HTMLElement,
  callbacks: Partial<JourneyCallbacks> = {},
): JourneyGame {
  const game = new JourneyGame(container, {
    onEpisodeComplete: vi.fn(),
    onStatChange: vi.fn(),
    onRelationshipChange: vi.fn(),
    onSceneChange: vi.fn(),
    ...callbacks,
  });
  (game as unknown as { state: JourneyState }).state = state;
  return game;
}

function completeChoice(game: JourneyGame, choice: Choice): void {
  (game as unknown as { handleChoice: (candidate: Choice) => void }).handleChoice(choice);
}

describe('JourneyGame completion copy', () => {
  it('uses the campaign completion message for the final trophy ending', () => {
    installStorage();
    const container = makeContainer();
    const state = {
      ...createNewJourney('Jordan Reeves', 'FW', 'fictional-united'),
      episodeId: 'rtg_ep5_final',
      sceneId: 'scene7_lift',
    };
    const game = makeGame(state, container);

    completeChoice(game, finalChoice('scene7_lift', 'complete-story'));

    expect(container.innerHTML).toContain('Road to Glory 2026 complete.');
    expect(container.innerHTML).not.toContain('1992/93');
  });

  it('uses the campaign completion message for final loss endings', () => {
    installStorage();
    const container = makeContainer();
    const state = {
      ...createNewJourney('Jordan Reeves', 'FW', 'fictional-united'),
      episodeId: 'rtg_ep5_final',
      sceneId: 'scene5_loss_aftermath',
    };
    const game = makeGame(state, container);

    completeChoice(game, finalChoice('scene5_loss_aftermath', 'losspress-honest'));

    expect(container.innerHTML).toContain('Road to Glory 2026 complete.');
    expect(container.innerHTML).not.toContain('1992/93');
  });

  it('uses the Last Dance campaign completion message for new endings', () => {
    installStorage();
    const container = makeContainer();
    const state = {
      ...createNewJourney('Tomas Andrade', 'FW', 'cape-verde', 'last-dance-story'),
      episodeId: 'ld_ep4_legacy',
      sceneId: 'scene1_legacy_press',
    };
    const game = makeGame(state, container);

    completeChoice(game, storyChoice('ld_ep4_legacy', 'scene1_legacy_press', 'ld-ending-handover'));

    expect(container.innerHTML).toContain('The Last Dance 2026 complete.');
  });

  it('uses the Two Passports campaign completion message for new endings', () => {
    installStorage();
    const container = makeContainer();
    const state = {
      ...createNewJourney('Malik Carter', 'MF', 'haiti', 'two-passports-story'),
      episodeId: 'tp_ep5_between_names',
      sceneId: 'scene2_bridge_draw',
    };
    const game = makeGame(state, container);

    completeChoice(game, storyChoice('tp_ep5_between_names', 'scene2_bridge_draw', 'tp-ending-return'));

    expect(container.innerHTML).toContain('Two Passports 2026 complete.');
  });

  it('notifies listeners when a story campaign is completed', () => {
    installStorage();
    const container = makeContainer();
    const onStoryComplete = vi.fn((state: JourneyState) => {
      return `${state.playerName} joined your Stars club as an 88 OVR card.`;
    });
    const state = {
      ...createNewJourney('Malik Carter', 'MF', 'haiti', 'two-passports-story'),
      episodeId: 'tp_ep5_between_names',
      sceneId: 'scene2_bridge_draw',
    };
    const game = makeGame(state, container, { onStoryComplete });

    completeChoice(game, storyChoice('tp_ep5_between_names', 'scene2_bridge_draw', 'tp-ending-return'));

    expect(onStoryComplete).toHaveBeenCalledTimes(1);
    expect(onStoryComplete.mock.calls[0][0]).toMatchObject({
      campaignId: 'two-passports-story',
      playerName: 'Malik Carter',
      isComplete: true,
    });
    expect(container.innerHTML).toContain('Malik Carter joined your Stars club as an 88 OVR card.');
  });
});
