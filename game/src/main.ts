import './style.css';

async function bootApp(): Promise<void> {
  const { App } = await import('./game/app');
  const app = new App();
  await app.boot();
}

bootApp().then(() => {
  // Signal the splash screen that the game is ready to show
  const w = window as any;
  if (typeof w.__splashAppReady === 'function') w.__splashAppReady();
  else w.__appBooted = true;
}).catch((e) => {
  console.error('boot failed', e);
  const ui = document.getElementById('ui');
  if (ui) {
    ui.classList.add('active');
    ui.innerHTML = `<div class="screen"><div class="scrim"></div>
      <h1 class="h-screen" style="margin-top:30vh">BOOT FAILED</h1>
      <div class="notice">${(e as Error).message ?? e}</div></div>`;
  }
  // Still dismiss splash on boot failure so the error is visible
  const w = window as any;
  if (typeof w.__splashAppReady === 'function') w.__splashAppReady();
  else w.__appBooted = true;
});
