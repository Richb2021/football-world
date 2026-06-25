// src/ui/conflictModal.ts
// Save-conflict chooser modal.
// conflictModalHtml is pure (no DOM, testable in node).
// showConflictModal mounts it into document.body for in-game use.
import type { SlotMeta } from '../net/saveSlots';
import { esc } from './stars/components';

function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/** Pure: returns the inner HTML for the conflict chooser. No DOM side effects. */
export function conflictModalHtml(info: { mode: string; local: SlotMeta; cloud: SlotMeta }): string {
  return `
    <h2 class="conflict-heading">SAVE CONFLICT — ${esc(info.mode.toUpperCase())}</h2>
    <p class="conflict-notice">This save changed on two devices. Which do you want to keep?</p>
    <div class="conflict-choices">
      <button class="btn primary" id="conflict-local">
        THIS DEVICE<br>
        <span class="tmeta">${esc(info.local.name)} · ${esc(info.local.summary)} · ${ago(info.local.updatedAt)}</span>
      </button>
      <button class="btn" id="conflict-cloud">
        CLOUD<br>
        <span class="tmeta">${esc(info.cloud.name)} · ${esc(info.cloud.summary)} · ${ago(info.cloud.updatedAt)}</span>
      </button>
    </div>`;
}

/** Mounts the conflict modal into document.body. Resolves with the player's choice and tears down. */
export function showConflictModal(info: { mode: string; local: SlotMeta; cloud: SlotMeta }): Promise<'local' | 'cloud'> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'conflict-overlay';
    host.innerHTML = `<div class="conflict-box">${conflictModalHtml(info)}</div>`;
    document.body.appendChild(host);
    const done = (choice: 'local' | 'cloud') => {
      host.remove();
      resolve(choice);
    };
    host.querySelector<HTMLElement>('#conflict-local')!.addEventListener('click', () => done('local'));
    host.querySelector<HTMLElement>('#conflict-cloud')!.addEventListener('click', () => done('cloud'));
  });
}
