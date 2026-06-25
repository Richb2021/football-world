// src/ui/__tests__/conflictModal.test.ts
// Pure string tests — NO document, NO DOM. vitest runs in node (no jsdom).
import { describe, expect, it } from 'vitest';
import { conflictModalHtml } from '../conflictModal';
import type { SlotMeta } from '../../net/saveSlots';

function meta(name: string, summary: string, updatedAt: number): SlotMeta {
  return { id: 'a', name, custom: false, summary, updatedAt, syncedAt: 0 };
}

describe('conflictModalHtml', () => {
  const local = meta('Phone Save', 'Season 3, Week 12', 200_000);
  const cloud = meta('Laptop Save', 'Season 2, Week 5', 100_000);
  const info = { mode: 'career', local, cloud };

  it('contains the conflict-local and conflict-cloud button ids', () => {
    const html = conflictModalHtml(info);
    expect(html).toContain('id="conflict-local"');
    expect(html).toContain('id="conflict-cloud"');
  });

  it('contains the local slot name and cloud slot name', () => {
    const html = conflictModalHtml(info);
    expect(html).toContain('Phone Save');
    expect(html).toContain('Laptop Save');
  });

  it('contains both summary strings', () => {
    const html = conflictModalHtml(info);
    expect(html).toContain('Season 3, Week 12');
    expect(html).toContain('Season 2, Week 5');
  });

  it('includes the mode in the heading', () => {
    const html = conflictModalHtml(info);
    // heading should include "career" in some form (case-insensitive check)
    expect(html.toLowerCase()).toContain('career');
  });

  it('escapes HTML in names (XSS prevention)', () => {
    const xssLocal = meta('<script>alert(1)</script>', 'sum', 1000);
    const html = conflictModalHtml({ mode: 'career', local: xssLocal, cloud });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
