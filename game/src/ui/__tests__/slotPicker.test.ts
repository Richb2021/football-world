// src/ui/__tests__/slotPicker.test.ts
// Pure string tests — NO document, NO new UI(). vitest runs in node (no jsdom).
import { describe, expect, it } from 'vitest';
import { slotPickerHtml } from '../slotPicker';
import type { SlotMeta } from '../../net/saveSlots';

function meta(id: string, name: string): SlotMeta {
  return { id, name, custom: false, summary: 'summary text', updatedAt: 1, syncedAt: 0 };
}

const BASE_OPTS = {
  title: 'CAREERS',
  atCap: false,
  signedIn: false,
  onContinue: () => {},
  onNew: () => {},
  onRename: () => {},
  onDelete: () => {},
  onBack: () => {},
};

describe('slotPickerHtml', () => {
  it('renders a slot-continue button per slot with correct data-slot attributes', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [meta('a', 'Alpha'), meta('b', 'Beta')] });
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect((html.match(/slot-continue/g) ?? []).length).toBe(2);
    expect(html).toContain('data-slot="a"');
    expect(html).toContain('data-slot="b"');
  });

  it('marks #slot-new as disabled when atCap is true', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [], atCap: true });
    // The button element with id slot-new should carry the disabled attribute
    expect(html).toMatch(/id="slot-new"[^>]*disabled|disabled[^>]*id="slot-new"/);
  });

  it('does NOT disable #slot-new and shows NEW when atCap is false', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [meta('x', 'Xray')], atCap: false });
    expect(html).toContain('NEW');
    // Must not have disabled on the slot-new button
    // Extract the button tag to check
    const btnMatch = html.match(/<button[^>]*id="slot-new"[^>]*>/);
    expect(btnMatch).not.toBeNull();
    expect(btnMatch![0]).not.toContain('disabled');
  });

  it('shows "No saves yet" notice when slots is empty', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [] });
    expect(html).toContain('No saves yet');
  });

  it('includes ☁ cloud marker when signedIn is true', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [meta('c', 'Charlie')], signedIn: true });
    expect(html).toContain('☁');
  });

  it('does NOT include ☁ cloud marker when signedIn is false', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [meta('d', 'Delta')], signedIn: false });
    expect(html).not.toContain('☁');
  });

  it('HTML-escapes slot names with special characters', () => {
    const html = slotPickerHtml({ ...BASE_OPTS, slots: [meta('e', '<script>evil</script>')] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
