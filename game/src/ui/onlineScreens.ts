import type { UI } from './screens';
import { bind } from './screens';
import type { AuthUser } from '../net/auth';
import { render, esc, ONLINE_BG } from './stars/components';

export function onlineMenu(
  ui: UI,
  opts: {
    signedIn: boolean;
    userLabel?: string;
    onSeasons: () => void;
    onQuickMatch: () => void;
    onFriend: () => void;
    onAccount: () => void;
    onBack: () => void;
  },
): void {
  const accountLabel = opts.signedIn && opts.userLabel ? esc(opts.userLabel) : 'GUEST';
  render(
    ui,
    `
    <h1 class="h-screen">ONLINE</h1>
    <div class="menu-col">
      <button class="btn primary" id="ol-seasons">SEASONS <span class="arrow">▶</span></button>
      <button class="btn" id="ol-quick">QUICK MATCH <span class="arrow">▶</span></button>
      <button class="btn" id="ol-friend">PLAY A FRIEND <span class="arrow">▶</span></button>
      <button class="btn small" id="ol-account">ACCOUNT · ${accountLabel}</button>
      <button class="btn small" id="ol-back">◀ BACK</button>
    </div>`,
    ONLINE_BG,
  );
  bind('ol-seasons', opts.onSeasons);
  bind('ol-quick', opts.onQuickMatch);
  bind('ol-friend', opts.onFriend);
  bind('ol-account', opts.onAccount);
  bind('ol-back', opts.onBack);
}

export function accountScreen(
  ui: UI,
  opts: {
    user: AuthUser | null;
    onSignIn: (email: string) => Promise<{ ok: boolean; error?: string }>;
    onSignOut: () => void;
    onGuest: () => void;
    onBack: () => void;
  },
): void {
  const signedIn = opts.user !== null;
  const bodyHtml = signedIn
    ? `
    <div class="panel account-form">
      <div class="account-status">SIGNED IN AS ${esc(opts.user!.email ?? opts.user!.id)}</div>
      <button class="btn small" id="acc-signout">SIGN OUT</button>
    </div>`
    : `
    <div class="panel account-form">
      <div class="notice" style="margin-bottom:12px">
        Sign in to sync your club across devices. We'll email you a magic link — no password needed.
      </div>
      <input class="txt" id="acc-email" type="email" placeholder="your@email.com" autocomplete="email" />
      <button class="btn primary" id="acc-send" style="margin-top:8px">SEND MAGIC LINK</button>
      <div class="account-status" id="acc-status" style="min-height:1.4em;margin-top:8px"></div>
    </div>`;

  render(
    ui,
    `
    <h1 class="h-screen">ACCOUNT</h1>
    ${bodyHtml}
    <div class="menu-col" style="margin-top:14px">
      <button class="btn small" id="acc-guest">CONTINUE AS GUEST</button>
      <button class="btn small" id="acc-back">◀ BACK</button>
    </div>`,
    ONLINE_BG,
  );

  if (signedIn) {
    bind('acc-signout', opts.onSignOut);
  } else {
    const sendBtn = ui.root.querySelector<HTMLButtonElement>('#acc-send');
    const statusEl = ui.root.querySelector<HTMLElement>('#acc-status');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const emailEl = ui.root.querySelector<HTMLInputElement>('#acc-email');
        const email = emailEl?.value.trim() ?? '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (statusEl) statusEl.textContent = 'Please enter a valid email address.';
          return;
        }
        sendBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Sending…';
        const result = await opts.onSignIn(email);
        sendBtn.disabled = false;
        if (statusEl) {
          statusEl.textContent = result.ok
            ? 'Magic link sent! Check your email.'
            : `Error: ${result.error ?? 'unknown error'}`;
        }
      });
    }
  }

  bind('acc-guest', opts.onGuest);
  bind('acc-back', opts.onBack);
}
