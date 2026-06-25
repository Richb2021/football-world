/**
 * Phone inbox: a message model + a self-contained DOM overlay (`mountPhone`)
 * that works over the cup hub or a story scene. The pure helpers are unit
 * tested; the overlay is browser-only.
 */
import type { MoraleDelta, PhoneInbox, PhoneMessage, PhoneReply, SenderType } from './metaTypes';
import { realAvatar } from './avatarAssets';

export function emptyInbox(): PhoneInbox {
  return { messages: [] };
}

export function unreadCount(inbox: PhoneInbox): number {
  return inbox.messages.reduce((n, m) => n + (m.read ? 0 : 1), 0);
}

let phoneSeq = 0;

export type ContactChromeMode = 'phone' | 'telegram' | 'cablegram' | 'fax-dossier';

export interface ContactChrome {
  title: string;
  status: string;
  buttonLabel: string;
  buttonIcon: string;
  emptyText: string;
  frameClass: string;
}

export function contactChromeForMode(mode: ContactChromeMode = 'phone'): ContactChrome {
  switch (mode) {
    case 'telegram':
      return {
        title: 'Telegrams',
        status: 'WIRE',
        buttonLabel: 'Telegrams',
        buttonIcon: 'T',
        emptyText: 'No telegrams yet. Check the wire desk between scenes.',
        frameClass: 'phone-frame telegram-frame',
      };
    case 'cablegram':
      return {
        title: 'Cablegrams',
        status: 'CABLE',
        buttonLabel: 'Cablegrams',
        buttonIcon: 'C',
        emptyText: 'No cablegrams yet. The hotel desk has nothing new.',
        frameClass: 'phone-frame cablegram-frame',
      };
    case 'fax-dossier':
      return {
        title: 'Fax Dossier',
        status: 'FAX',
        buttonLabel: 'Dossier',
        buttonIcon: 'F',
        emptyText: 'No faxed dossiers yet.',
        frameClass: 'phone-frame fax-frame',
      };
    case 'phone':
    default:
      return {
        title: 'Messages',
        status: 'SL93',
        buttonLabel: 'Phone',
        buttonIcon: 'P',
        emptyText: 'No messages yet. Check back between games.',
        frameClass: 'phone-frame',
      };
  }
}

/** Add a message; newest sorts first by `order`. Returns the created message. */
export function pushMessage(
  inbox: PhoneInbox,
  msg: { from: string; senderType: SenderType; text: string; time: string; order: number; replies?: PhoneReply[]; avatarSeed?: string; avatarAsset?: string; pinned?: boolean; requiresResponse?: boolean },
): PhoneMessage {
  const m: PhoneMessage = {
    id: `msg_${msg.order}_${phoneSeq++}`,
    from: msg.from,
    senderType: msg.senderType,
    avatarSeed: msg.avatarSeed ?? msg.from,
    avatarAsset: msg.avatarAsset,
    time: msg.time,
    order: msg.order,
    text: msg.text,
    read: false,
    pinned: msg.pinned,
    replies: msg.replies,
    requiresResponse: msg.requiresResponse,
  };
  inbox.messages.push(m);
  inbox.messages.sort((a, b) => b.order - a.order);
  return m;
}

export function markRead(inbox: PhoneInbox, id: string): void {
  const m = inbox.messages.find((x) => x.id === id);
  if (m) m.read = true;
}

export function markAllRead(inbox: PhoneInbox): void {
  for (const m of inbox.messages) m.read = true;
}

function avatarFor(m: { avatarAsset?: string; avatarSeed: string; senderType: SenderType }): string {
  return m.avatarAsset ?? realAvatar(m.avatarSeed, m.senderType);
}

export interface PhoneOpts {
  title?: string;
  subtitle?: string;
  contactMode?: ContactChromeMode;
  initialMessageId?: string;
  onClose?: () => void;
  /** called when a reply applies an effect */
  onEffect?: (delta: MoraleDelta) => void;
  /** called whenever inbox state changes (read flags, replies) so the host can persist */
  onChange?: () => void;
}

/** Mount the phone overlay into `container`. Returns an unmount function. */
export function mountPhone(container: HTMLElement, inbox: PhoneInbox, opts: PhoneOpts = {}): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'meta-overlay';
  container.appendChild(overlay);
  const chrome = contactChromeForMode(opts.contactMode);

  let openThread: string | null = opts.initialMessageId ?? null;
  if (openThread) {
    markRead(inbox, openThread);
    opts.onChange?.();
  }

  const close = () => {
    overlay.remove();
    opts.onClose?.();
  };

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

  function render() {
    const frame = document.createElement('div');
    frame.className = chrome.frameClass;
    if (openThread === null) {
      // always show newest first (pinned on top); journey messages are appended
      // in story order, so sort at render time rather than trusting array order
      const ordered = [...inbox.messages].sort(
        (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.order - a.order,
      );
      const list = ordered.map((m) => `
        <div class="phone-msg ${m.read ? '' : 'unread'}" data-id="${m.id}">
          <img class="phone-avatar" src="${avatarFor(m)}" alt=""/>
          <div class="phone-msg-body">
            <div class="phone-from">${esc(m.from)} <span class="phone-time">${esc(m.time)}</span></div>
            <div class="phone-preview">${esc(m.text)}</div>
          </div>
          ${m.requiresResponse && !m.replied ? '<div class="phone-required">REPLY</div>' : ''}
          ${m.read ? '' : '<div class="phone-dot"></div>'}
        </div>`).join('');
      frame.innerHTML = `
        <div class="phone-notch"></div>
        <button class="phone-close" aria-label="Close">×</button>
        <div class="phone-status"><span>${esc(chrome.status)}</span><span>${unreadCount(inbox)} new</span></div>
        <div class="phone-header"><div><h2>${esc(opts.title ?? chrome.title)}</h2><div class="phone-sub">${esc(opts.subtitle ?? '')}</div></div></div>
        <div class="phone-list">${list || `<div class="phone-empty">${esc(chrome.emptyText)}</div>`}</div>`;
      frame.querySelector('.phone-close')!.addEventListener('click', close);
      frame.querySelectorAll('.phone-msg').forEach((el) => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.id!;
          markRead(inbox, id);
          opts.onChange?.();
          openThread = id;
          swap();
        });
      });
    } else {
      const m = inbox.messages.find((x) => x.id === openThread);
      if (!m) { openThread = null; swap(); return; }
      const replied = m.replied ? (m.replies?.find((r) => r.id === m.replied)) : null;
      const repliesHtml = (!m.replied && m.replies?.length)
        ? `<div class="phone-replies">${m.replies.map((r) => `<button class="phone-reply" data-rid="${r.id}">${esc(r.text)}</button>`).join('')}</div>`
        : '';
      frame.innerHTML = `
        <div class="phone-notch"></div>
        <div class="phone-status"><span>${esc(chrome.status)}</span><span></span></div>
        <div class="phone-thread">
          <div class="phone-thread-head"><button class="phone-back">‹</button>
            <img class="phone-avatar" src="${avatarFor(m)}" style="width:34px;height:34px" alt=""/>
            <h3>${esc(m.from)}</h3>
            ${m.requiresResponse && !m.replied ? '<span class="phone-required thread">REPLY NEEDED</span>' : ''}</div>
          <div class="phone-bubbles">
            <div class="phone-bubble them">${esc(m.text)}</div>
            ${m.replied && replied ? `<div class="phone-bubble me">${esc(m.replies!.find((r) => r.id === m.replied)!.text)}</div>${replied.response ? `<div class="phone-bubble them">${esc(replied.response)}</div>` : ''}` : ''}
          </div>
          ${repliesHtml}
        </div>`;
      frame.querySelector('.phone-back')!.addEventListener('click', () => { openThread = null; swap(); });
      frame.querySelectorAll('.phone-reply').forEach((el) => {
        el.addEventListener('click', () => {
          const rid = (el as HTMLElement).dataset.rid!;
          const r = m.replies?.find((x) => x.id === rid);
          if (r) {
            m.replied = rid;
            if (r.effect) opts.onEffect?.(r.effect);
            opts.onChange?.();
            swap();
          }
        });
      });
    }
    overlay.innerHTML = '';
    overlay.appendChild(frame);
  }
  function swap() { render(); }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  render();
  return () => overlay.remove();
}
