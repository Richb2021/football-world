/**
 * Journey Scene Renderer
 * Renders isometric-style scenes with characters, dialogue, and choices
 */

import type { Scene, SceneBackground, SceneCharacter, DialogueEntry, Choice, JourneyState } from './types';
import { getNPCById } from './episodes';
import { getJourneyBackgroundAsset } from './backgroundAssets';
import { getJourneyCharacterAsset, hasJourneyCharacterAsset } from './characterAssets';
import { figureUrl } from '../meta/avatar';

/** map an NPC role to a shirt tint for its procedural avatar */
function roleTint(role: string): string | undefined {
  switch (role) {
    case 'manager': return '#2a2a35';
    case 'assistant': return '#1f7a3d';
    case 'physio': return '#0d6b6b';
    case 'media': return '#b3243b';
    case 'agent': return '#5a2d82';
    case 'family': return '#c44a17';
    case 'rival': return '#8d2222';
    case 'teammate': return '#1d4e89';
    default: return undefined;
  }
}

const BASE_URL = import.meta.env.BASE_URL;

export interface RenderOptions {
  width: number;
  height: number;
  container: HTMLElement;
}

export class SceneRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentScene: Scene | null = null;
  private currentDialogueIndex = 0;
  private currentState: JourneyState | null = null;
  private onChoiceSelected: ((choice: Choice) => void) | null = null;
  private typingInterval: number | null = null;
  private isTyping = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private backgroundImageCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();

  constructor(options: RenderOptions) {
    this.container = options.container;
    this.container.innerHTML = '';
    
    // Create canvas for background rendering
    this.canvas = document.createElement('canvas');
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.canvas.className = 'journey-scene-canvas';
    this.container.appendChild(this.canvas);
    
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    this.ctx = ctx;
    
    // Create UI overlay
    this.createUIOverlay();
  }

  private createUIOverlay(): void {
    const overlay = document.createElement('div');
    overlay.className = 'journey-scene-overlay';
    overlay.innerHTML = `
      <div class="journey-characters"></div>
      <div class="journey-topbar">
        <div class="journey-stats-overlay">
          <div class="journey-stat reputation">
            <span class="label">REP</span>
            <span class="value">0</span>
          </div>
          <div class="journey-stat rating">
            <span class="label">OVR</span>
            <span class="value">50</span>
          </div>
        </div>
        <button class="journey-phone-btn" type="button" aria-label="Phone">P<span class="journey-phone-badge" style="display:none">0</span></button>
      </div>
      <div class="journey-bottom">
        <div class="journey-dialogue-box">
          <div class="journey-speaker-name"></div>
          <div class="journey-dialogue-text"></div>
          <div class="journey-continue-hint">Press SPACE or Click to continue</div>
        </div>
        <div class="journey-choices-container"></div>
      </div>
    `;
    this.container.appendChild(overlay);
    
    // Add click handler for advancing dialogue
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === overlay || target.closest?.('.journey-dialogue-box')) {
        this.advanceDialogue();
      }
    });
    
    // Add keyboard handler
    this.keyHandler = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.advanceDialogue();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  /** Wire the phone button + unread badge. */
  setPhone(onOpen: () => void, badge: number, chrome?: { buttonLabel: string; buttonIcon: string }): void {
    const btn = this.container.querySelector('.journey-phone-btn') as HTMLElement | null;
    const badgeEl = this.container.querySelector('.journey-phone-badge') as HTMLElement | null;
    if (btn) {
      btn.onclick = (e) => { e.stopPropagation(); onOpen(); };
      btn.setAttribute('aria-label', chrome?.buttonLabel ?? 'Phone');
      if (btn.childNodes[0]) btn.childNodes[0].textContent = chrome?.buttonIcon ?? 'P';
    }
    if (badgeEl) {
      badgeEl.textContent = String(badge);
      badgeEl.style.display = badge > 0 ? 'flex' : 'none';
    }
  }

  /**
   * Preload the background + every character image for a scene so it can be
   * painted fully assembled, instead of the canvas, characters and dialogue
   * popping in one after another as each asset trickles in. Resolves when the
   * images are decoded, or after a short safety timeout so a slow/broken asset
   * can never stall the story.
   */
  preloadScene(scene: Scene): Promise<void> {
    const urls = new Set<string>();
    const bgAsset = getJourneyBackgroundAsset(scene.background);
    if (bgAsset) urls.add(this.resolveAssetUrl(bgAsset));
    for (const ch of scene.characters) {
      if (hasJourneyCharacterAsset(ch.id)) urls.add(this.resolveAssetUrl(getJourneyCharacterAsset(ch.id)));
    }
    if (urls.size === 0) return Promise.resolve();

    const loaders = [...urls].map((url) => new Promise<void>((resolve) => {
      const cached = this.backgroundImageCache.get(url);
      if (cached && cached !== 'loading' && cached !== 'error') { resolve(); return; }
      const img = new Image();
      const done = () => resolve();
      img.onload = () => { this.backgroundImageCache.set(url, img); done(); };
      img.onerror = () => { this.backgroundImageCache.set(url, 'error'); done(); };
      img.src = url;
    }));
    const safety = new Promise<void>((resolve) => window.setTimeout(resolve, 2200));
    return Promise.race([Promise.all(loaders).then(() => undefined), safety]);
  }

  renderScene(scene: Scene, state: JourneyState, onChoice: (choice: Choice) => void): void {
    this.currentScene = scene;
    this.currentState = state;
    this.currentDialogueIndex = 0;
    this.onChoiceSelected = onChoice;
    this.resetSceneChrome();
    
    // Render background
    this.renderBackground(scene.background, state);
    
    // Render characters
    this.renderCharacters(scene.characters, state);
    
    // Update stats display
    this.updateStats(state);
    
    // Start dialogue
    this.showDialogue(scene.dialogue[0], state);
  }

  private resetSceneChrome(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    this.isTyping = false;

    const choices = this.container.querySelector('.journey-choices-container') as HTMLElement | null;
    if (choices) {
      choices.innerHTML = '';
      choices.style.display = 'none';
    }

    const dialogue = this.container.querySelector('.journey-dialogue-box') as HTMLElement | null;
    if (dialogue) dialogue.style.display = 'block';
  }

  private renderBackground(background: SceneBackground, state: JourneyState): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Get color scheme based on background type and time
    const colors = this.getBackgroundColors(background);
    
    const asset = getJourneyBackgroundAsset(background);
    if (asset) {
      const url = this.resolveAssetUrl(asset);
      const cached = this.backgroundImageCache.get(url);
      if (cached && cached !== 'loading' && cached !== 'error') {
        this.drawImageCover(cached, background);
        return;
      }
      // Image is loading: draw a clean time-of-day sky color background
      ctx.fillStyle = colors.sky;
      ctx.fillRect(0, 0, width, height);
      
      this.renderBackgroundImage(asset, background);
      return;
    }
    
    // Fallback procedural layout when no image asset is available
    switch (background.type) {
      case 'home':
        this.renderHomeBackground(ctx, width, height, colors, background.variant);
        break;
      case 'training':
        this.renderTrainingBackground(ctx, width, height, colors, background.variant);
        break;
      case 'managerOffice':
        this.renderOfficeBackground(ctx, width, height, colors, background.variant);
        break;
      case 'lockerRoom':
        this.renderLockerRoomBackground(ctx, width, height, colors, background.variant);
        break;
      case 'town':
        this.renderTownBackground(ctx, width, height, colors, background.variant as 'pub' | 'street' | 'shop');
        break;
      case 'pitch':
        this.renderPitchBackground(ctx, width, height, colors, background.variant);
        break;
      case 'physio':
        this.renderPhysioBackground(ctx, width, height, colors, background.variant);
        break;
      default:
        this.renderDefaultBackground(ctx, width, height, colors);
    }
  }

  private renderBackgroundImage(asset: string, background: SceneBackground): void {
    const url = this.resolveAssetUrl(asset);
    const cached = this.backgroundImageCache.get(url);
    if (cached && cached !== 'loading' && cached !== 'error') {
      this.drawImageCover(cached, background);
      return;
    }
    if (cached === 'loading' || cached === 'error') return;

    this.backgroundImageCache.set(url, 'loading');
    const img = new Image();
    img.onload = () => {
      this.backgroundImageCache.set(url, img);
      if (this.currentScene?.background === background && this.currentState) {
        this.renderBackground(background, this.currentState);
      }
    };
    img.onerror = () => this.backgroundImageCache.set(url, 'error');
    img.src = url;
  }

  private resolveAssetUrl(asset: string): string {
    if (/^(https?:|data:|blob:)/.test(asset)) return asset;
    const clean = asset.replace(/^\/+/, '');
    return `${BASE_URL}${clean}`;
  }

  private drawImageCover(img: HTMLImageElement, background: SceneBackground): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(width / iw, height / ih);
    const sw = width / scale;
    const sh = height / scale;
    let sx = (iw - sw) / 2;
    let sy = (ih - sh) / 2;
    if (background.focus === 'left') sx = 0;
    if (background.focus === 'right') sx = iw - sw;
    if (background.focus === 'top') sy = 0;
    if (background.focus === 'bottom') sy = ih - sh;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

    const overlay = background.overlay ?? 'medium';
    const alpha = overlay === 'none' ? 0 : overlay === 'light' ? 0.16 : overlay === 'dark' ? 0.42 : 0.28;
    if (alpha > 0) {
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, `rgba(0,0,0,${alpha * 0.45})`);
      grad.addColorStop(0.62, `rgba(0,0,0,${alpha * 0.1})`);
      grad.addColorStop(1, `rgba(0,0,0,${alpha})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  }

  private getBackgroundColors(background: SceneBackground) {
    const variant = (background as { variant?: string }).variant;
    const timeOfDay = variant === 'morning' ? 'morning' :
      variant === 'evening' || variant === 'night' ? 'evening' : 'afternoon';
    
    const schemes: { [key: string]: { sky: string; ground: string; walls: string; accent: string } } = {
      morning: { sky: '#87CEEB', ground: '#4a6741', walls: '#f5f5dc', accent: '#d4a574' },
      afternoon: { sky: '#5ba3d0', ground: '#3d5c3d', walls: '#e8e4c9', accent: '#c4956a' },
      evening: { sky: '#2d4a5e', ground: '#2d4a2d', walls: '#d4c4a8', accent: '#a67c52' },
      night: { sky: '#1a1a2e', ground: '#1f3d1f', walls: '#b8a88a', accent: '#8b6914' }
    };
    
    return schemes[timeOfDay] ?? schemes.afternoon;
  }

  private renderTrainingBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: string
  ): void {
    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.6);
    skyGrad.addColorStop(0, colors.sky);
    skyGrad.addColorStop(1, '#e8f4f8');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);
    
    // Stand structure (isometric-ish)
    ctx.fillStyle = colors.walls;
    ctx.fillRect(width * 0.1, height * 0.25, width * 0.8, height * 0.15);
    
    // Roof
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(width * 0.05, height * 0.25);
    ctx.lineTo(width * 0.15, height * 0.15);
    ctx.lineTo(width * 0.85, height * 0.15);
    ctx.lineTo(width * 0.95, height * 0.25);
    ctx.closePath();
    ctx.fill();
    
    // Pitch
    const pitchGrad = ctx.createLinearGradient(0, height * 0.4, 0, height);
    pitchGrad.addColorStop(0, '#4a7c59');
    pitchGrad.addColorStop(1, '#3d6b4a');
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(0, height * 0.4, width, height * 0.6);
    
    // Pitch lines
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(width * 0.2, height * 0.5, width * 0.6, height * 0.4);
    
    // Training equipment (simplified)
    ctx.fillStyle = '#ff6b35';
    ctx.fillRect(width * 0.15, height * 0.7, 20, 20); // Cone
    ctx.fillRect(width * 0.75, height * 0.65, 20, 20); // Cone
    
    // Weather effect
    if (variant === 'rain') {
      this.renderRainEffect(ctx, width, height);
    }
  }

  private renderHomeBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: string
  ): void {
    // Room background
    const roomGrad = ctx.createLinearGradient(0, 0, 0, height);
    roomGrad.addColorStop(0, '#d4c4a8');
    roomGrad.addColorStop(1, '#c4b498');
    ctx.fillStyle = roomGrad;
    ctx.fillRect(0, 0, width, height);
    
    // Floor
    const floorGrad = ctx.createLinearGradient(0, height * 0.7, 0, height);
    floorGrad.addColorStop(0, '#8b7355');
    floorGrad.addColorStop(1, '#6b5344');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
    
    // Window with era-appropriate view (no modern elements)
    ctx.fillStyle = '#4a3728';
    ctx.fillRect(width * 0.1, height * 0.15, width * 0.3, height * 0.35);
    
    // Window glass
    ctx.fillStyle = colors.sky;
    ctx.fillRect(width * 0.12, height * 0.18, width * 0.26, height * 0.3);
    
    // Window frame
    ctx.strokeStyle = '#3d2b1f';
    ctx.lineWidth = 3;
    ctx.strokeRect(width * 0.12, height * 0.18, width * 0.26, height * 0.3);
    ctx.beginPath();
    ctx.moveTo(width * 0.25, height * 0.18);
    ctx.lineTo(width * 0.25, height * 0.48);
    ctx.moveTo(width * 0.12, height * 0.33);
    ctx.lineTo(width * 0.38, height * 0.33);
    ctx.stroke();
    
    // 1992-era furniture
    // Armchair
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(width * 0.6, height * 0.5, width * 0.25, height * 0.25);
    ctx.fillStyle = '#6b5a4a';
    ctx.fillRect(width * 0.62, height * 0.48, width * 0.21, height * 0.08);
    
    // Table with rotary phone (era-accurate)
    ctx.fillStyle = '#4a3d2f';
    ctx.fillRect(width * 0.65, height * 0.75, width * 0.15, height * 0.08);
    
    // Phone
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(width * 0.7, height * 0.72, width * 0.05, height * 0.05);
  }

  private renderOfficeBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: string
  ): void {
    // Wood-paneled office
    const wallGrad = ctx.createLinearGradient(0, 0, width, 0);
    wallGrad.addColorStop(0, '#5a4a3a');
    wallGrad.addColorStop(0.5, '#6b5a4a');
    wallGrad.addColorStop(1, '#5a4a3a');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, width, height);
    
    // Desk
    ctx.fillStyle = '#4a3728';
    ctx.fillRect(width * 0.2, height * 0.6, width * 0.6, height * 0.15);
    
    // Desk legs
    ctx.fillRect(width * 0.22, height * 0.75, width * 0.03, height * 0.2);
    ctx.fillRect(width * 0.75, height * 0.75, width * 0.03, height * 0.2);
    
    // Trophy cabinet
    ctx.fillStyle = '#3d2b1f';
    ctx.fillRect(width * 0.75, height * 0.2, width * 0.2, height * 0.4);
    
    // European Cup trophy (simplified)
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(width * 0.85, height * 0.4, width * 0.04, 0, Math.PI * 2);
    ctx.fill();
    
    // Tactics board
    ctx.fillStyle = '#2a4a2a';
    ctx.fillRect(width * 0.05, height * 0.2, width * 0.2, height * 0.3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(width * 0.06, height * 0.22, width * 0.18, height * 0.26);
  }

  private renderLockerRoomBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: string
  ): void {
    // Tiled walls
    ctx.fillStyle = '#c4d4e0';
    ctx.fillRect(0, 0, width, height);
    
    // Tile pattern
    ctx.strokeStyle = '#a4b4c0';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Benches
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(width * 0.1, height * 0.6, width * 0.8, height * 0.1);
    
    // Lockers
    ctx.fillStyle = '#8b4513';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(width * (0.05 + i * 0.15), height * 0.15, width * 0.13, height * 0.4);
    }
    
    // Kit hanging
    ctx.fillStyle = '#dd0000';
    ctx.fillRect(width * 0.08, height * 0.2, width * 0.08, height * 0.15);
  }

  private renderTownBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: 'pub' | 'street' | 'shop'
  ): void {
    // Street/pub scene
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.5);
    skyGrad.addColorStop(0, colors.sky);
    skyGrad.addColorStop(1, '#b8c8d8');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height * 0.5);
    
    // Buildings
    ctx.fillStyle = '#6b5a4a';
    ctx.fillRect(0, height * 0.3, width * 0.4, height * 0.4);
    ctx.fillRect(width * 0.6, height * 0.35, width * 0.4, height * 0.35);
    
    // Pub front if variant is pub
    if (variant === 'pub') {
      ctx.fillStyle = '#8b0000';
      ctx.fillRect(width * 0.35, height * 0.4, width * 0.3, height * 0.3);
      // Pub sign
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(width * 0.42, height * 0.42, width * 0.16, height * 0.06);
    }
    
    // Cobblestone street
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
  }

  private renderPitchBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: string
  ): void {
    // Stadium view
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.4);
    skyGrad.addColorStop(0, colors.sky);
    skyGrad.addColorStop(1, '#c8e0f0');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);
    
    // Stands
    ctx.fillStyle = '#4a4a5a';
    ctx.beginPath();
    ctx.ellipse(width * 0.5, height * 0.35, width * 0.9, height * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Crowd
    ctx.fillStyle = '#2a2a3a';
    for (let i = 0; i < 100; i++) {
      const x = (Math.sin(i * 0.5) * 0.4 + 0.5) * width;
      const y = (Math.cos(i * 0.3) * 0.15 + 0.35) * height;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Pitch
    const pitchGrad = ctx.createLinearGradient(0, height * 0.5, 0, height);
    pitchGrad.addColorStop(0, '#5a8a5a');
    pitchGrad.addColorStop(1, '#4a7a4a');
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(0, height * 0.5, width, height * 0.5);
    
    // Pitch markings
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(width * 0.2, height * 0.6, width * 0.6, height * 0.3);
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.75, width * 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }

  private renderPhysioBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string },
    variant: string
  ): void {
    // Clinical white room
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, width, height);
    
    // Treatment table
    ctx.fillStyle = '#4a6a8a';
    ctx.fillRect(width * 0.3, height * 0.5, width * 0.4, height * 0.1);
    
    // Medical equipment (1992 era)
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(width * 0.1, height * 0.4, width * 0.1, height * 0.2);
    ctx.fillRect(width * 0.8, height * 0.45, width * 0.08, height * 0.15);
    
    // Ice bath
    ctx.fillStyle = '#4a7a9a';
    ctx.fillRect(width * 0.75, height * 0.6, width * 0.2, height * 0.2);
  }

  private renderDefaultBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: { sky: string; ground: string; walls: string; accent: string }
  ): void {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, colors.sky);
    grad.addColorStop(1, colors.ground);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  private renderRainEffect(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = 'rgba(200, 200, 255, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 10);
      ctx.stroke();
    }
  }

  private renderCharacters(characters: SceneCharacter[], state: JourneyState): void {
    const container = this.container.querySelector('.journey-characters') as HTMLElement;
    container.innerHTML = '';
    // tag the stage with how many figures share it so the CSS can spread two of
    // them to the edges (and shrink them slightly) instead of overlapping
    container.className = `journey-characters count-${Math.min(characters.length, 3)}`;
    
    characters.forEach(char => {
      const npc = getNPCById(char.id);
      if (!npc) return;
      
      const charEl = document.createElement('div');
      charEl.className = `journey-character journey-character-${char.position} journey-expression-${char.expression}`;
      charEl.dataset.npcId = char.id;
      // a distinct procedural figure stands in for any NPC without a hand-made
      // portrait — so the story can introduce as many characters as it likes
      const procedural = figureUrl(npc.id, roleTint(npc.role));
      const asset = hasJourneyCharacterAsset(char.id)
        ? this.resolveAssetUrl(getJourneyCharacterAsset(char.id))
        : procedural;

      charEl.innerHTML = `
        <div class="character-sprite ${char.pose}">
          <img class="character-img" src="${asset}" data-fallback="${procedural}" alt="${this.escapeHtml(npc.name)}" />
        </div>
        <div class="character-name">${npc.name}</div>
      `;
      const img = charEl.querySelector('.character-img') as HTMLImageElement | null;
      img?.addEventListener('error', () => {
        if (img.src !== procedural) img.src = procedural;
        else charEl.classList.add('journey-character-missing-asset');
      });

      container.appendChild(charEl);
    });
  }

  private showDialogue(entry: DialogueEntry, state: JourneyState): void {
    const speakerEl = this.container.querySelector('.journey-speaker-name') as HTMLElement;
    const textEl = this.container.querySelector('.journey-dialogue-text') as HTMLElement;
    const hintEl = this.container.querySelector('.journey-continue-hint') as HTMLElement;
    
    // Get NPC name or use narrator
    const npc = getNPCById(entry.speakerId);
    const speakerName = npc ? npc.name : entry.speakerId === 'narrator' ? '' : entry.speakerId;
    
    speakerEl.textContent = speakerName;
    speakerEl.style.display = speakerName ? 'block' : 'none';
    
    // Typewriter effect
    this.isTyping = true;
    const text = this.processDialogueText(entry.text, state);
    let index = 0;
    textEl.textContent = '';
    hintEl.style.display = 'none';
    
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
    }
    
    this.typingInterval = window.setInterval(() => {
      if (index < text.length) {
        textEl.textContent += text[index];
        index++;
      } else {
        this.isTyping = false;
        hintEl.style.display = 'block';
        if (this.typingInterval) {
          clearInterval(this.typingInterval);
          this.typingInterval = null;
        }
      }
    }, 30);
  }

  private processDialogueText(text: string, state: JourneyState): string {
    return text.replace(/{playerName}/g, state.playerName);
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

  private advanceDialogue(): void {
    if (!this.currentScene) return;
    
    if (this.isTyping) {
      // Complete typing immediately
      if (this.typingInterval) {
        clearInterval(this.typingInterval);
        this.typingInterval = null;
      }
      const entry = this.currentScene.dialogue[this.currentDialogueIndex];
      const textEl = this.container.querySelector('.journey-dialogue-text') as HTMLElement;
      const hintEl = this.container.querySelector('.journey-continue-hint') as HTMLElement;
      textEl.textContent = this.processDialogueText(entry.text, this.currentState!);
      this.isTyping = false;
      hintEl.style.display = 'block';
      return;
    }
    
    this.currentDialogueIndex++;
    
    if (this.currentDialogueIndex < this.currentScene.dialogue.length) {
      this.showDialogue(this.currentScene.dialogue[this.currentDialogueIndex], this.currentState!);
    } else if (this.currentScene.choices && this.currentScene.choices.length > 0) {
      this.showChoices(this.currentScene.choices);
    }
  }

  private showChoices(choices: Choice[]): void {
    const container = this.container.querySelector('.journey-choices-container') as HTMLElement;
    const dialogueBox = this.container.querySelector('.journey-dialogue-box') as HTMLElement;
    
    dialogueBox.style.display = 'none';
    container.innerHTML = '';
    container.style.display = 'flex';
    
    choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'journey-choice-btn';
      btn.textContent = choice.text;
      btn.addEventListener('click', () => {
        if (this.onChoiceSelected) {
          this.onChoiceSelected(choice);
        }
      });
      container.appendChild(btn);
    });
  }

  private updateStats(state: JourneyState): void {
    const repEl = this.container.querySelector('.journey-stat.reputation .value') as HTMLElement;
    const ratingEl = this.container.querySelector('.journey-stat.rating .value') as HTMLElement;
    
    if (repEl) repEl.textContent = state.reputation.toString();
    if (ratingEl) {
      const overall = Math.round(
        (state.stats.pace + state.stats.shooting + state.stats.passing + 
         state.stats.dribbling + state.stats.defending + state.stats.physical + 
         state.stats.mental) / 7
      );
      ratingEl.textContent = overall.toString();
    }
  }

  destroy(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container.innerHTML = '';
  }
}
