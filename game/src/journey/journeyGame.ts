/**
 * Journey Game Controller
 * Main class for running the story mode
 */

import type { JourneyMatchOutcome, JourneyMatchRequest, JourneyState, Choice, Episode, StoryCampaignId } from './types';
import { SceneRenderer } from './sceneRenderer';
import { 
  loadJourney, 
  saveJourney, 
  createNewJourney, 
  applyConsequences, 
  advanceToScene,
  completeEpisode,
  processSceneEntry
} from './state';
import { getEpisodeById, isEpisodeUnlocked, allEpisodes } from './episodes';
import { recordJourneyMatchOutcome } from './matches';
import { applyRouteConsequences, getAvailableStoryEntries, resolveStoryRoute } from './storyLogic';
import { applyStoryNarrativeAfterMatch, applyStoryNarrativeOnSceneEnter, enrichSceneWithStoryNarrative } from './storyNarrative';
import { storyCampaignById } from './campaigns';
import { contactChromeForMode, mountPhone } from '../meta/phone';

export interface JourneyCallbacks {
  onEpisodeComplete: (episodeId: string, nextEpisodeId?: string) => void;
  onStatChange: (stats: JourneyState['stats']) => void;
  onRelationshipChange: (relationships: JourneyState['relationships']) => void;
  onSceneChange: (sceneId: string, background: string) => void;
  onStoryComplete?: (state: JourneyState) => string | void;
  onMatchRequest?: (
    request: JourneyMatchRequest,
    state: JourneyState,
    onComplete: (outcome: JourneyMatchOutcome, localTeam: 0 | 1) => void,
  ) => void;
  onExit?: () => void;
}

export class JourneyGame {
  private state: JourneyState | null = null;
  private renderer: SceneRenderer | null = null;
  private callbacks: JourneyCallbacks;
  private container: HTMLElement;
  /** true while a scene's assets are preloading, so choice/advance input from the
   * outgoing scene can't trigger a second navigation mid-transition */
  private busyLoading = false;
  private pendingMatchChoice: Choice | null = null;

  constructor(container: HTMLElement, callbacks: JourneyCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  setContainer(container: HTMLElement): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.container = container;
  }

  startNew(
    playerName: string,
    playerPosition: 'GK' | 'DF' | 'MF' | 'FW',
    clubId: string,
    campaignId: StoryCampaignId = 'international-cup-story',
  ): void {
    this.state = createNewJourney(playerName, playerPosition, clubId, campaignId);
    saveJourney(this.state);
    this.initRenderer();
    this.loadCurrentScene();
  }

  continue(): boolean {
    const saved = loadJourney();
    if (!saved) return false;
    
    this.state = saved;
    this.initRenderer();
    this.loadCurrentScene();
    return true;
  }

  private initRenderer(): void {
    if (this.renderer) {
      this.renderer.destroy();
    }
    
    const rect = this.container.getBoundingClientRect();
    this.renderer = new SceneRenderer({
      width: Math.min(rect.width, 1920),
      height: Math.min(rect.height, 1080),
      container: this.container
    });
  }

  private async loadCurrentScene(): Promise<void> {
    if (!this.state || !this.renderer) return;

    const episode = getEpisodeById(this.state.episodeId);
    if (!episode) {
      console.error(`Episode not found: ${this.state.episodeId}`);
      this.showCompleteScreen('Football Story continues in a future update.');
      return;
    }
    
    const scene = episode.scenes.find(s => s.id === this.state!.sceneId);
    if (!scene) {
      console.error(`Scene not found: ${this.state.sceneId}`);
      this.showCompleteScreen('Football Story continues in a future update.');
      return;
    }
    
    // Process scene entry callback
    this.state = processSceneEntry(this.state, scene.id);
    this.state = applyStoryNarrativeOnSceneEnter(this.state, scene.id);
    
    // Notify callback
    this.callbacks.onSceneChange(scene.id, scene.background.type);
    
    // Filter dialogue and choices based on the current story state.
    const narrativeScene = enrichSceneWithStoryNarrative(scene, this.state);
    const availableDialogue = getAvailableStoryEntries(this.state, narrativeScene.dialogue);
    const availableChoices = narrativeScene.choices
      ? getAvailableStoryEntries(this.state, narrativeScene.choices)
      : [];

    const sceneForRender = { ...narrativeScene, dialogue: availableDialogue, choices: availableChoices };

    // Preload the scene's images first so it paints fully assembled (the
    // outgoing scene stays on screen meanwhile, rather than flashing empty and
    // filling in piece by piece).
    this.busyLoading = true;
    await this.renderer.preloadScene(sceneForRender);
    this.busyLoading = false;
    if (!this.state || !this.renderer || this.state.sceneId !== scene.id) return;

    // Render scene
    this.renderer.renderScene(
      sceneForRender,
      this.state,
      (choice) => this.handleChoice(choice)
    );

    // wire the phone button + unread badge for this scene
    this.refreshPhone();
  }

  private refreshPhone(): void {
    if (!this.state || !this.renderer) return;
    const inbox = (this.state.inbox ??= { messages: [] });
    const unread = inbox.messages.filter((m) => !m.read).length;
    const chrome = contactChromeForMode(this.state.contactMode ?? 'phone');
    this.renderer.setPhone(() => this.openPhone(), unread, chrome);
  }

  private openPhone(): void {
    if (!this.state) return;
    const inbox = (this.state.inbox ??= { messages: [] });
    const chrome = contactChromeForMode(this.state.contactMode ?? 'phone');
    mountPhone(this.container, inbox, {
      title: chrome.title,
      subtitle: this.state.playerName,
      contactMode: this.state.contactMode ?? 'phone',
      onChange: () => { saveJourney(this.state!); this.refreshPhone(); },
      onClose: () => { saveJourney(this.state!); this.refreshPhone(); },
    });
  }

  private handleChoice(choice: Choice): void {
    if (!this.state) return;
    // ignore clicks from the outgoing scene while the next one is preloading
    if (this.busyLoading) return;

    // Apply consequences
    this.state = applyConsequences(this.state, choice.consequences);

    if (choice.match && this.callbacks.onMatchRequest) {
      const request = choice.match;
      this.pendingMatchChoice = choice;
      this.state = advanceToScene(this.state, choice.nextSceneId);
      this.callbacks.onStatChange(this.state.stats);
      this.callbacks.onRelationshipChange(this.state.relationships);
      if (this.renderer) {
        this.renderer.destroy();
        this.renderer = null;
      }
      this.container.innerHTML = '';
      this.callbacks.onMatchRequest(request, this.state, (outcome, localTeam) => {
        this.handleMatchComplete(request, outcome, localTeam);
      });
      return;
    }
    
    // Check for episode transition
    const nextEpisode = choice.consequences.find(c => c.type === 'nextEpisode');
    if (nextEpisode && nextEpisode.type === 'nextEpisode') {
      const completedEpisodeId = this.state.episodeId;
      const targetEpisode = getEpisodeById(nextEpisode.episodeId);
      if (!targetEpisode) {
        this.state = completeEpisode(this.state);
        const rewardMessage = this.callbacks.onStoryComplete?.(this.state);
        this.callbacks.onEpisodeComplete(completedEpisodeId);
        this.callbacks.onStatChange(this.state.stats);
        this.callbacks.onRelationshipChange(this.state.relationships);
        const message = [
          this.completionMessage(nextEpisode.episodeId),
          rewardMessage,
        ].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
        this.showCompleteScreen(message);
        return;
      }
      this.state = completeEpisode(this.state, nextEpisode.episodeId);
      this.state = advanceToScene(this.state, targetEpisode.scenes[0]?.id ?? choice.nextSceneId);
      this.callbacks.onEpisodeComplete(completedEpisodeId, nextEpisode.episodeId);
      this.callbacks.onStatChange(this.state.stats);
      this.callbacks.onRelationshipChange(this.state.relationships);
      this.loadCurrentScene();
      return;
    }
    
    const route = resolveStoryRoute(this.state, choice.routes, choice.nextSceneId);
    this.state = applyRouteConsequences(this.state, route.consequences);
    this.state = advanceToScene(this.state, route.nextSceneId);
    
    // Notify callbacks of stat changes
    this.callbacks.onStatChange(this.state.stats);
    this.callbacks.onRelationshipChange(this.state.relationships);
    
    // Load next scene
    this.loadCurrentScene();
  }

  private handleMatchComplete(request: JourneyMatchRequest, outcome: JourneyMatchOutcome, localTeam: 0 | 1): void {
    if (!this.state) return;
    this.state = recordJourneyMatchOutcome(this.state, request, outcome, localTeam);
    this.state = applyStoryNarrativeAfterMatch(this.state, request.matchId);
    const pendingChoice = this.pendingMatchChoice;
    this.pendingMatchChoice = null;
    if (pendingChoice?.postMatchRoutes) {
      const route = resolveStoryRoute(this.state, pendingChoice.postMatchRoutes, this.state.sceneId);
      this.state = applyRouteConsequences(this.state, route.consequences);
      this.state = advanceToScene(this.state, route.nextSceneId);
    } else {
      saveJourney(this.state);
    }
    this.callbacks.onStatChange(this.state.stats);
    this.callbacks.onRelationshipChange(this.state.relationships);
    this.initRenderer();
    this.loadCurrentScene();
  }

  private showCompleteScreen(message: string): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.container.innerHTML = `
      <div class="screen journey-menu-screen journey-complete-screen">
        <div class="scrim"></div>
        <div class="journey-menu-shell">
          <h1 class="h-screen">STORY <span class="accent">MODE</span></h1>
          <div class="notice journey-menu-copy">${this.escapeHtml(message)}</div>
          <div class="menu-col journey-menu-col">
            <button class="btn small" id="journey-exit">◀ BACK TO MAIN MENU</button>
          </div>
        </div>
      </div>
    `;
    this.container.querySelector('#journey-exit')?.addEventListener('click', () => this.callbacks.onExit?.());
  }

  private completionMessage(targetEpisodeId: string): string {
    if (!this.state || targetEpisodeId !== 'season_complete') return 'Story Mode complete.';
    const campaign = storyCampaignById(this.state.campaignId);
    return `${campaign.title} ${campaign.seasonLabel} complete.`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch] ?? ch));
  }

  getState(): JourneyState | null {
    return this.state;
  }

  getAvailableEpisodes(): Episode[] {
    if (!this.state) return [];
    
    return allEpisodes.filter(ep =>
      (ep.campaignId ?? 'breakthrough-92-93') === this.state!.campaignId &&
      isEpisodeUnlocked(ep, this.state!.episodeHistory)
    );
  }

  destroy(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.state = null;
  }
}
