// src/ui/slotPicker.ts
// Generic save-slot picker: lists a mode's slots with Continue / New / Rename / Delete.
// Exported as two pieces:
//   slotPickerHtml  — pure HTML builder (testable in node, no DOM)
//   slotPickerScreen — mounts the HTML and wires DOM events
import type { UI } from './screens';
import { bind } from './screens';
import { render, esc } from './stars/components';
import { showConfirm, showPrompt } from './modal';
import type { SlotMeta } from '../net/saveSlots';

export interface SlotPickerOpts {
  title: string;
  slots: SlotMeta[];
  atCap: boolean;
  signedIn: boolean;
  onContinue: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

/** Relative-time helper. Does NOT assert on clock — tests should not match this. */
function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * PURE: returns the inner screen HTML for a slot-picker.
 * Uses `esc` on all interpolated user text. No DOM side effects.
 */
export function slotPickerHtml(opts: SlotPickerOpts): string {
  const rows = opts.slots
    .map(
      (m) => `
    <div class="slot-row" data-slot="${esc(m.id)}">
      <button class="team-card slot-continue" style="text-align:left">
        <div class="tname">${esc(m.name)}</div>
        <div class="tmeta">${esc(m.summary)} · ${ago(m.updatedAt)}${opts.signedIn ? ' · ☁' : ''}</div>
      </button>
      <div class="slot-actions">
        <button class="btn small slot-rename">RENAME</button>
        <button class="btn small danger slot-delete">DELETE</button>
      </div>
    </div>`,
    )
    .join('');

  const emptyNotice = opts.slots.length === 0
    ? '<div class="notice">No saves yet — start a new one.</div>'
    : '';

  const newBtn = opts.atCap
    ? `<button class="btn primary" id="slot-new" disabled>SLOTS FULL — DELETE ONE TO ADD</button>`
    : `<button class="btn primary" id="slot-new">NEW ▶</button>`;

  return `
    <h1 class="h-screen">${esc(opts.title)}</h1>
    <div class="menu-col slot-list">
      ${emptyNotice}
      ${rows}
      ${newBtn}
      <button class="btn small" id="slot-back">◀ BACK</button>
    </div>`;
}

/**
 * Mounts the slot picker into the UI and wires all DOM events.
 * Delegates HTML generation to slotPickerHtml.
 */
export function slotPickerScreen(ui: UI, opts: SlotPickerOpts): void {
  render(ui, slotPickerHtml(opts), ui.bgUrl);

  ui.root.querySelectorAll<HTMLElement>('.slot-row').forEach((row) => {
    const id = row.dataset.slot!;
    row
      .querySelector<HTMLElement>('.slot-continue')
      ?.addEventListener('click', () => opts.onContinue(id));
    row.querySelector<HTMLElement>('.slot-rename')?.addEventListener('click', async () => {
      const current = opts.slots.find((s) => s.id === id)?.name ?? '';
      const name = await showPrompt({ title: 'RENAME SAVE', value: current, confirmLabel: 'RENAME' });
      if (name && name.trim()) opts.onRename(id, name.trim());
    });
    row.querySelector<HTMLElement>('.slot-delete')?.addEventListener('click', async () => {
      const ok = await showConfirm({
        title: 'DELETE SAVE?',
        message: 'This cannot be undone.',
        confirmLabel: 'DELETE',
        danger: true,
      });
      if (ok) opts.onDelete(id);
    });
  });

  if (!opts.atCap) bind('slot-new', opts.onNew);
  bind('slot-back', opts.onBack);
}
