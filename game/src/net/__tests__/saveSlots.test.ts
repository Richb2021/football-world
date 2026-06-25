// src/net/__tests__/saveSlots.test.ts
import { describe, expect, it } from 'vitest';
import { makeSaveSlots, type CloudSlotStore, type SlotMeta } from '../saveSlots';

interface Foo { version: 1; n: number; }

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  } as Storage;
}

function makeFoo(seedBase = 0) {
  let t = 1000;
  let n = 0;
  const storage = mem();
  const slots = makeSaveSlots<Foo>('career', {
    cap: 6,
    summarise: (f) => ({ name: `Foo ${f.n}`, summary: `n=${f.n}` }),
    valid: (f) => f.version === 1,
  }, { storage, now: () => (t += 1), genId: () => `id${seedBase + n++}` });
  return { slots, storage };
}

describe('SaveSlots core', () => {
  it('creates, lists, loads, and tracks the active slot', () => {
    const { slots } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });
    expect(slots.active()).toBe(a.id);
    expect(slots.list().map((m) => m.id)).toEqual([a.id]);
    expect(slots.load()).toEqual({ version: 1, n: 1 });
    expect(slots.load(a.id)).toEqual({ version: 1, n: 1 });
  });

  it('saves to the active slot and refreshes the auto-name + summary', () => {
    const { slots } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });
    slots.save({ version: 1, n: 5 });
    expect(slots.load(a.id)).toEqual({ version: 1, n: 5 });
    const meta = slots.list().find((m) => m.id === a.id)!;
    expect(meta.name).toBe('Foo 5');
    expect(meta.summary).toBe('n=5');
  });

  it('keeps a custom name across saves but still updates the summary', () => {
    const { slots } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });
    slots.rename(a.id, 'My Run');
    slots.save({ version: 1, n: 9 });
    const meta = slots.list().find((m) => m.id === a.id)!;
    expect(meta.name).toBe('My Run');
    expect(meta.summary).toBe('n=9');
  });

  it('drops a slot whose payload fails the version guard', () => {
    const { slots, storage } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });
    storage.setItem(`sl93.slot.career.${a.id}`, JSON.stringify({ version: 2, n: 1 }));
    expect(slots.load(a.id)).toBeNull();
  });

  it('removes a slot and clears active when it was active', () => {
    const { slots } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });
    slots.remove(a.id);
    expect(slots.list()).toEqual([]);
    expect(slots.active()).toBeNull();
    expect(slots.load(a.id)).toBeNull();
  });

  it('reports atCap once the cap is reached', () => {
    const { slots } = makeFoo();
    for (let i = 0; i < 6; i++) slots.create({ version: 1, n: i });
    expect(slots.atCap()).toBe(true);
    expect(slots.list()).toHaveLength(6);
  });
});

describe('SaveSlots sync (with a fake cloud)', () => {
  function fakeCloud(initial: { meta: SlotMeta; payload: Foo }[] = []) {
    const rows = new Map(initial.map((r) => [r.meta.id, r]));
    const store: CloudSlotStore<Foo> = {
      list: async () => Array.from(rows.values()).map((r) => ({ meta: { ...r.meta }, payload: { ...r.payload } })),
      put: async (_m, meta, payload) => void rows.set(meta.id, { meta: { ...meta }, payload: { ...payload } }),
      del: async (_m, id) => void rows.delete(id),
    };
    return { store, rows };
  }

  it('uploads a local-only slot', async () => {
    const { slots } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });
    const { store, rows } = fakeCloud();
    slots.setCloud(store);
    await slots.sync(async () => 'local');
    expect(rows.has(a.id)).toBe(true);
  });

  it('downloads a cloud-only slot', async () => {
    const { slots } = makeFoo();
    const meta: SlotMeta = { id: 'cloudX', name: 'Cloud', custom: false, summary: 'n=7', updatedAt: 50, syncedAt: 0 };
    const { store } = fakeCloud([{ meta, payload: { version: 1, n: 7 } }]);
    slots.setCloud(store);
    await slots.sync(async () => 'local');
    expect(slots.load('cloudX')).toEqual({ version: 1, n: 7 });
  });

  it('does not leak syncedAt to cloud.put (passes syncedAt === 0)', async () => {
    const { slots } = makeFoo();
    let capturedMeta: SlotMeta | undefined;
    const capturingCloud: CloudSlotStore<Foo> = {
      list: async () => [],
      put: async (_m, meta, _payload) => { capturedMeta = { ...meta }; },
      del: async () => {},
    };
    slots.setCloud(capturingCloud);
    slots.save({ version: 1, n: 42 }); // triggers create → persist → cloud.put
    // Allow the fire-and-forget promise to resolve
    await Promise.resolve();
    expect(capturedMeta).toBeDefined();
    expect(capturedMeta!.syncedAt).toBe(0);
  });

  it('prompts and applies the chosen side when both diverged since last sync', async () => {
    const { slots } = makeFoo();
    const a = slots.create({ version: 1, n: 1 });          // updatedAt > syncedAt(0): local advanced
    const meta: SlotMeta = { id: a.id, name: 'Cloud', custom: false, summary: 'n=99', updatedAt: 99999, syncedAt: 0 };
    const { store } = fakeCloud([{ meta, payload: { version: 1, n: 99 } }]);
    slots.setCloud(store);
    let asked = false;
    await slots.sync(async () => { asked = true; return 'cloud'; });
    expect(asked).toBe(true);
    expect(slots.load(a.id)).toEqual({ version: 1, n: 99 });
  });
});
