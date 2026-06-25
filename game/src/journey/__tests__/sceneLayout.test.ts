import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Journey scene character layout', () => {
  it('moves lone right and center characters left of the top UI chrome', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../sceneRenderer.ts', import.meta.url), 'utf8');

    expect(renderer).toContain('count-${Math.min(characters.length, 3)}');
    expect(css).toMatch(/\.journey-characters\.count-1 \.journey-character-(?:center|right),\s*\.journey-characters\.count-1 \.journey-character-(?:center|right)\s*\{[^}]*left: 43%;[^}]*right: auto;[^}]*transform: translateX\(-50%\);[^}]*\}/);
    expect(css).toMatch(/@media \(max-width: 768px\)\s*\{[\s\S]*\.journey-characters\.count-1 \.journey-character-(?:center|right),\s*\.journey-characters\.count-1 \.journey-character-(?:center|right)\s*\{[^}]*left: 41%;[^}]*right: auto;[^}]*transform: translateX\(-50%\) scale\(0\.8\);[^}]*\}/);
  });
});
