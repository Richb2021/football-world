import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('bundle splitting boundaries', () => {
  it('keeps the app shell behind a dynamic import from the entry module', () => {
    const mainSource = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');

    expect(mainSource).toContain("await import('./game/app')");
    expect(mainSource).not.toContain("import { App } from './game/app'");
  });

  it('loads the match runner only when a match actually starts', () => {
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');

    expect(appSource).toContain("import type { MatchRunner } from './matchRunner'");
    expect(appSource).toContain("await import('./matchRunner')");
    expect(appSource).toContain('private async playMatch(');
    expect(appSource).not.toContain("import { MatchRunner } from './matchRunner'");
  });

  it('defines stable manual chunks for heavyweight runtime areas', () => {
    const viteConfig = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8');

    expect(viteConfig).toContain('manualChunks(id)');
    expect(viteConfig).toContain("'vendor-three'");
    expect(viteConfig).toContain("'vendor-supabase'");
    expect(viteConfig).toContain("'match-engine'");
    expect(viteConfig).toContain("'teams-data'");
    expect(viteConfig).toContain("'story-mode'");
    expect(viteConfig).toContain("'stars-mode'");
  });
});
