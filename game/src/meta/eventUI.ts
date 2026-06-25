/** Modal for a between-game random event (story / jeopardy). */
import type { MetaEvent, MoraleDelta } from './metaTypes';
import { realAvatar } from './avatarAssets';

export interface EventOpts {
  /** resolves with the chosen effect (or the auto effect if no choices) */
  onResolve: (delta: MoraleDelta | undefined) => void;
}

export function eventAvatarFor(ev: Pick<MetaEvent, 'avatarAsset' | 'avatarSeed' | 'senderType'>): string {
  return ev.avatarAsset ?? realAvatar(ev.avatarSeed, ev.senderType);
}

export function mountEvent(container: HTMLElement, ev: MetaEvent, opts: EventOpts): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'meta-overlay';
  container.appendChild(overlay);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

  function render(outcome?: string, effect?: MoraleDelta) {
    const body = outcome
      ? `<p class="event-body">${esc(outcome)}</p><button class="press-done event-ok">OK</button>`
      : `<p class="event-body">${esc(ev.body)}</p>` + (ev.choices?.length
        ? `<div class="event-choices">${ev.choices.map((c) => `<button class="event-choice" data-cid="${c.id}">${esc(c.text)}</button>`).join('')}</div>`
        : `<button class="press-done event-ok">OK</button>`);
    overlay.innerHTML = `
      <div class="event-card">
        <div class="event-head">
          <img class="event-avatar" src="${eventAvatarFor(ev)}" alt=""/>
          <h2>${esc(ev.title)}</h2>
        </div>
        ${body}
      </div>`;
    if (outcome) {
      overlay.querySelector('.event-ok')!.addEventListener('click', () => { overlay.remove(); opts.onResolve(effect); });
      return;
    }
    if (ev.choices?.length) {
      overlay.querySelectorAll('.event-choice').forEach((el) => {
        el.addEventListener('click', () => {
          const cid = (el as HTMLElement).dataset.cid!;
          const c = ev.choices!.find((x) => x.id === cid)!;
          render(c.outcome ?? 'Decision made.', c.effect);
        });
      });
    } else {
      overlay.querySelector('.event-ok')!.addEventListener('click', () => { overlay.remove(); opts.onResolve(ev.effect); });
    }
  }
  render();
  return () => overlay.remove();
}
