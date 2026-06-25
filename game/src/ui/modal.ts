// src/ui/modal.ts
// Themed in-game modals that replace native alert()/confirm()/prompt().
// Same pattern as conflictModal.ts: mount a host into document.body, return a
// Promise, tear down on choice. Styling lives under `.modal-*` in style.css and
// matches the vibrant dark frosted-glass menu theme.
import { esc } from './stars/components';

function mount(inner: string): { host: HTMLElement; close: () => void } {
  const host = document.createElement('div');
  host.className = 'modal-overlay';
  host.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${inner}</div>`;
  document.body.appendChild(host);
  return { host, close: () => host.remove() };
}

export interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** style the confirm button as destructive (red) */
  danger?: boolean;
}

/** Themed yes/no confirmation. Resolves true on confirm, false on cancel/dismiss. */
export function showConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const { host, close } = mount(`
      <h2 class="modal-title">${esc(opts.title)}</h2>
      ${opts.message ? `<p class="modal-msg">${esc(opts.message)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">${esc(opts.cancelLabel ?? 'CANCEL')}</button>
        <button class="btn primary${opts.danger ? ' danger' : ''}" id="modal-ok">${esc(opts.confirmLabel ?? 'CONFIRM')}</button>
      </div>`);
    const done = (v: boolean) => { close(); resolve(v); };
    host.querySelector<HTMLElement>('#modal-ok')!.addEventListener('click', () => done(true));
    host.querySelector<HTMLElement>('#modal-cancel')!.addEventListener('click', () => done(false));
    host.addEventListener('click', (e) => { if (e.target === host) done(false); });
  });
}

export interface PromptOpts {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
}

/** Themed single-line text prompt. Resolves the entered string, or null if cancelled. */
export function showPrompt(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const { host, close } = mount(`
      <h2 class="modal-title">${esc(opts.title)}</h2>
      ${opts.message ? `<p class="modal-msg">${esc(opts.message)}</p>` : ''}
      <input class="modal-input" id="modal-input" type="text" maxlength="${opts.maxLength ?? 40}" />
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">CANCEL</button>
        <button class="btn primary" id="modal-ok">${esc(opts.confirmLabel ?? 'SAVE')}</button>
      </div>`);
    const input = host.querySelector<HTMLInputElement>('#modal-input')!;
    input.value = opts.value ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    const done = (v: string | null) => { close(); resolve(v); };
    host.querySelector<HTMLElement>('#modal-ok')!.addEventListener('click', () => done(input.value));
    host.querySelector<HTMLElement>('#modal-cancel')!.addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
    });
    host.addEventListener('click', (e) => { if (e.target === host) done(null); });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

/** Themed acknowledgement dialog (single OK). Resolves when dismissed. */
export function showAlert(opts: { title: string; message?: string; okLabel?: string }): Promise<void> {
  return new Promise((resolve) => {
    const { host, close } = mount(`
      <h2 class="modal-title">${esc(opts.title)}</h2>
      ${opts.message ? `<p class="modal-msg">${esc(opts.message)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn primary" id="modal-ok">${esc(opts.okLabel ?? 'OK')}</button>
      </div>`);
    const done = () => { close(); resolve(); };
    host.querySelector<HTMLElement>('#modal-ok')!.addEventListener('click', done);
    host.addEventListener('click', (e) => { if (e.target === host) done(); });
  });
}
