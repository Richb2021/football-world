import type { PadInput } from '../sim/types';

/**
 * Unified local input: keyboard (arrows/WASD + Z,X / K,L), gamepad, touch.
 * Touch builds a virtual stick + buttons into #touch when a touch screen exists.
 */
export class InputManager {
  private keys = new Set<string>();
  private touchState = { x: 0, y: 0, pass: false, shoot: false, sprint: false, switchPlayer: false, active: false };
  paused = false;
  onPause: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    if (window.matchMedia('(pointer: coarse)').matches) this.buildTouch();
  }

  getInput(): PadInput {
    let x = 0, y = 0;
    // keyboard --- screen-up = -y in sim? sim y is pitch width; we map up/down to y directly
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y += 1;
    let pass = this.keys.has('KeyZ') || this.keys.has('KeyK') || this.keys.has('Space');
    let shoot = this.keys.has('KeyX') || this.keys.has('KeyL');
    let sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyJ');
    let switchPlayer = this.keys.has('KeyC') || this.keys.has('Tab') || this.keys.has('KeyQ');

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (Math.abs(ax) > 0.18) x += ax;
      if (Math.abs(ay) > 0.18) y += ay;
      if (gp.buttons[14]?.pressed) x -= 1;
      if (gp.buttons[15]?.pressed) x += 1;
      if (gp.buttons[12]?.pressed) y -= 1;
      if (gp.buttons[13]?.pressed) y += 1;
      pass = pass || !!gp.buttons[0]?.pressed; // A / cross
      shoot = shoot || !!gp.buttons[1]?.pressed || !!gp.buttons[2]?.pressed; // B or X
      sprint = sprint || !!gp.buttons[5]?.pressed || !!gp.buttons[7]?.pressed; // RB/RT
      switchPlayer = switchPlayer || !!gp.buttons[4]?.pressed; // LB/L1
      if (gp.buttons[9]?.pressed) this.onPause?.();
      break;
    }

    // touch
    if (this.touchState.active || this.touchState.pass || this.touchState.shoot) {
      x += this.touchState.x;
      y += this.touchState.y;
      pass = pass || this.touchState.pass;
      shoot = shoot || this.touchState.shoot;
      sprint = sprint || this.touchState.sprint;
      switchPlayer = switchPlayer || this.touchState.switchPlayer;
    }

    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { moveX: x, moveY: y, pass, shoot, sprint, switchPlayer };
  }

  /** "any button" for menus / continue prompts */
  consumeAnyPress(): boolean {
    const inp = this.getInput();
    return inp.pass || inp.shoot;
  }

  showTouch(show: boolean) {
    const el = document.getElementById('touch');
    if (el) el.style.display = show && window.matchMedia('(pointer: coarse)').matches ? 'block' : 'none';
  }

  private touchAttacking: boolean | null = null;

  /**
   * Relabel the touch buttons for the possession context: the same physical
   * buttons pass/shoot in attack and switch/tackle in defence (the sim already
   * routes them that way — pass switches player off the ball, shoot slides).
   */
  setTouchContext(attacking: boolean) {
    if (this.touchAttacking === attacking) return;
    this.touchAttacking = attacking;
    const passBtn = document.getElementById('t-pass');
    const shootBtn = document.getElementById('t-shoot');
    if (passBtn) passBtn.textContent = attacking ? 'PASS' : 'SWITCH';
    if (shootBtn) shootBtn.textContent = attacking ? 'SHOOT' : 'TACKLE';
  }

  private buildTouch() {
    const root = document.getElementById('touch');
    if (!root) return;
    root.innerHTML = `
      <button class="t-pause" id="t-pause" aria-label="Pause">II</button>
      <div class="stick" id="t-stick"><div class="nub" id="t-nub"></div></div>
      <div class="t-btns">
        <button class="t-btn t-sprint" id="t-sprint">RUN</button>
        <button class="t-btn t-pass" id="t-pass">PASS</button>
        <button class="t-btn t-shoot" id="t-shoot">SHOOT</button>
      </div>`;
    const pauseBtn = root.querySelector('#t-pause') as HTMLElement;
    const firePause = (e: Event) => { e.preventDefault(); this.onPause?.(); };
    pauseBtn.addEventListener('touchstart', firePause, { passive: false });
    pauseBtn.addEventListener('click', firePause);
    const stick = root.querySelector('#t-stick') as HTMLElement;
    const nub = root.querySelector('#t-nub') as HTMLElement;
    const R = 56;
    const setFromTouch = (t: Touch) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      let dx = (t.clientX - cx) / R, dy = (t.clientY - cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.touchState.x = dx;
      this.touchState.y = dy;
      this.touchState.active = true;
      nub.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
    };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); setFromTouch(e.targetTouches[0]); }, { passive: false });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); setFromTouch(e.targetTouches[0]); }, { passive: false });
    stick.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.touchState.x = 0; this.touchState.y = 0; this.touchState.active = false;
      nub.style.transform = 'translate(0,0)';
    }, { passive: false });
    const bindBtn = (id: string, key: 'pass' | 'shoot' | 'sprint' | 'switchPlayer') => {
      const b = root.querySelector(id) as HTMLElement;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); (this.touchState as any)[key] = true; }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); (this.touchState as any)[key] = false; }, { passive: false });
    };
    bindBtn('#t-pass', 'pass');
    bindBtn('#t-shoot', 'shoot');
    bindBtn('#t-sprint', 'sprint');
  }
}
