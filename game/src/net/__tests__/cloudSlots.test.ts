// src/net/__tests__/cloudSlots.test.ts
import { describe, expect, it } from 'vitest';
import { makeCloudSlotStore, type SlotRow } from '../cloudSlots';
import type { SlotMeta } from '../saveSlots';

// Minimal in-memory stand-in for the Supabase query builder used by cloudSlots.
function fakeClient(rows: SlotRow[]) {
  return {
    from() {
      let filtered = rows;
      const api: any = {
        select() { return api; },
        eq(col: string, val: unknown) { filtered = filtered.filter((r) => (r as any)[col] === val); return api; },
        async then(res: (v: { data: SlotRow[]; error: null }) => void) { res({ data: filtered, error: null }); },
        async upsert(row: SlotRow) { rows.push(row); return { error: null }; },
        async delete() { return { eq: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }; },
      };
      return api;
    },
  };
}

const meta: SlotMeta = { id: 'a', name: 'Alpha', custom: false, summary: 's', updatedAt: 5, syncedAt: 0 };

describe('cloud slot store', () => {
  it('lists rows as {meta,payload}', async () => {
    const rows: SlotRow[] = [{ user_id: 'u', game_id: 'soccer', mode: 'career', slot: 'a',
      data: { meta, payload: { version: 2 } }, updated_at: '2026-01-01' }];
    const store = makeCloudSlotStore<{ version: number }>('u', fakeClient(rows) as never);
    const got = await store.list('career');
    expect(got[0].meta.id).toBe('a');
    expect(got[0].payload).toEqual({ version: 2 });
  });

  it('adapts a legacy raw-blob row (no meta wrapper)', async () => {
    const rows: SlotRow[] = [{ user_id: 'u', game_id: 'soccer', mode: 'stars', slot: 'main',
      data: { version: 1, coins: 50 } as never, updated_at: '2026-01-01' }];
    const store = makeCloudSlotStore<{ version: number; coins: number }>('u', fakeClient(rows) as never);
    const got = await store.list('stars');
    expect(got[0].meta.id).toBe('main');
    expect(got[0].payload.coins).toBe(50);
  });
});
