import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GAME_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('visual asset generation script', () => {
  it('dry-runs badge generation through Fal GPT-Image-2.0 without requiring an API key', () => {
    const output = execFileSync(
      'node',
      ['scripts/generate-fal-visual-assets.mjs', '--dry-run', '--limit', '1', '--only', 'badges', '--team', 'england'],
      { cwd: GAME_ROOT, encoding: 'utf8' },
    );

    expect(output).toContain('using openai/gpt-image-2 via Fal');
    expect(output).toContain('badge_england -> assets/generated/badge_england.png');
    expect(output).toContain('Create a fictional football club badge');
  });

  it('reports the configured generation concurrency during dry-run', () => {
    const output = execFileSync(
      'node',
      [
        'scripts/generate-fal-visual-assets.mjs',
        '--dry-run',
        '--limit',
        '1',
        '--only',
        'badges',
        '--team',
        'england',
        '--concurrency',
        '4',
      ],
      { cwd: GAME_ROOT, encoding: 'utf8' },
    );

    expect(output).toContain('concurrency 4');
    expect(output).toContain('badge_england -> assets/generated/badge_england.png');
  });

  it('dry-runs purchase store asset prompts through Fal without requiring an API key', () => {
    const output = execFileSync(
      'node',
      ['scripts/generate-fal-visual-assets.mjs', '--dry-run', '--only', 'store', '--limit', '1'],
      { cwd: GAME_ROOT, encoding: 'utf8' },
    );

    expect(output).toContain('store_token_stack -> assets/ui/store_token_stack.webp');
    expect(output).toContain('arcade challenge tokens');
    expect(output).toContain('no payment logos');
  });

  it('keeps kit image generation behind an explicit experimental flag', () => {
    expect(() => execFileSync(
      'node',
      ['scripts/generate-fal-visual-assets.mjs', '--dry-run', '--limit', '1', '--only', 'kits', '--team', 'england'],
      { cwd: GAME_ROOT, encoding: 'utf8', stdio: 'pipe' },
    )).toThrow(/Kit image generation is disabled/);
  });

  it('dry-runs new historic story and challenge chronicle prompts', () => {
    const miners = execFileSync(
      'node',
      ['scripts/generate-journey-story-assets.mjs', '--dry-run', '--match', 'mc_colliery_street', '--limit', '1'],
      { cwd: GAME_ROOT, encoding: 'utf8' },
    );
    expect(miners).toContain('mc_colliery_street -> assets/journey/backgrounds/mc_colliery_street.png');
    expect(miners).toContain('1909 County Durham coalfield');

    const challenge = execFileSync(
      'node',
      ['scripts/generate-journey-story-assets.mjs', '--dry-run', '--match', 'challenge_2026_spain_cape_verde', '--limit', '1'],
      { cwd: GAME_ROOT, encoding: 'utf8' },
    );
    expect(challenge).toContain('challenge_2026_spain_cape_verde -> assets/journey/backgrounds/challenge_2026_spain_cape_verde.png');
    expect(challenge).toContain('fax dossier');
  });
});
