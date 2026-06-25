// src/net/saveSlots.ts
/**
 * Mode-agnostic multi-slot save store. Each game mode (career/story/seasons/stars)
 * owns one instance. Writes are local-first and synchronous; an optional cloud
 * mirror (set via setCloud) is best-effort and never throws.
 */
export interface SlotMeta {
  id: string;
  name: string;
  custom: boolean;          // true once the player renames — stops auto-name overwrite
  summary: string;
  updatedAt: number;        // ms epoch of last payload write
  syncedAt: number;         // updatedAt at last successful cloud sync (local only, never uploaded)
  extra?: Record<string, unknown>;
}

export interface SlotSummary {
  name: string;
  summary: string;
  extra?: Record<string, unknown>;
}

/** Cloud transport for one mode's slots. Implemented in Milestone 2. */
export interface CloudSlotStore<T> {
  list(mode: string): Promise<{ meta: SlotMeta; payload: T }[]>;
  put(mode: string, meta: SlotMeta, payload: T): Promise<void>;
  del(mode: string, id: string): Promise<void>;
}

export type ConflictResolver =
  (info: { mode: string; local: SlotMeta; cloud: SlotMeta }) => Promise<'local' | 'cloud'>;

export interface SaveSlotsOptions<T> {
  cap: number;
  summarise: (payload: T) => SlotSummary;
  revive?: (raw: T) => T;     // post-load fixups (ensureCareerSystems / migrateJourneyState)
  valid?: (raw: T) => boolean; // version guard; an invalid payload loads as null
}

export interface SaveSlotsDeps {
  storage?: Storage;
  now?: () => number;
  genId?: () => string;
}

export interface SaveSlots<T> {
  list(): SlotMeta[];
  active(): string | null;
  setActive(id: string | null): void;
  load(id?: string): T | null;
  save(payload: T, id?: string): void;
  create(payload: T): SlotMeta;
  rename(id: string, name: string): void;
  remove(id: string): void;
  atCap(): boolean;
  importLegacy(raw: T): SlotMeta | null;
  setCloud(cloud: CloudSlotStore<T> | null): void;
  sync(resolve: ConflictResolver): Promise<void>;
}

const PREFIX = 'sl93';

function readJSON<V>(storage: Storage, key: string, fallback: V): V {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as V) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('saveSlots write failed', key, e);
  }
}

export function makeSaveSlots<T>(
  mode: string,
  opts: SaveSlotsOptions<T>,
  deps: SaveSlotsDeps = {},
): SaveSlots<T> {
  const resolveStorage = (): Storage => deps.storage ?? globalThis.localStorage;
  const now = deps.now ?? (() => Date.now());
  const genId = deps.genId
    ?? (() => globalThis.crypto?.randomUUID?.() ?? `s_${now()}_${Math.floor(now() % 1e6)}`);

  const indexKey = `${PREFIX}.slots.${mode}`;
  const activeKey = `${PREFIX}.active.${mode}`;
  const slotKey = (id: string) => `${PREFIX}.slot.${mode}.${id}`;

  let cloud: CloudSlotStore<T> | null = null;

  // syncedAt is local-only bookkeeping; strip it before every cloud.put call.
  const toCloudMeta = (m: SlotMeta): SlotMeta => {
    const { syncedAt: _omit, ...rest } = m;
    return { ...rest, syncedAt: 0 };
  };

  const index = () => readJSON<SlotMeta[]>(resolveStorage(), indexKey, []);
  const writeIndex = (metas: SlotMeta[]) => writeJSON(resolveStorage(), indexKey, metas);

  function list(): SlotMeta[] {
    return index().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  function active(): string | null {
    return resolveStorage().getItem(activeKey);
  }
  function setActive(id: string | null): void {
    try {
      if (id) resolveStorage().setItem(activeKey, id);
      else resolveStorage().removeItem(activeKey);
    } catch (e) {
      console.warn('saveSlots setActive failed', e);
    }
  }
  function atCap(): boolean {
    return index().length >= opts.cap;
  }

  function load(id: string | undefined = active() ?? undefined): T | null {
    if (!id) return null;
    const raw = readJSON<T | null>(resolveStorage(), slotKey(id), null);
    if (raw == null) return null;
    if (opts.valid && !opts.valid(raw)) return null;
    return opts.revive ? opts.revive(raw) : raw;
  }

  function refreshMeta(metas: SlotMeta[], id: string, payload: T): SlotMeta {
    const s = opts.summarise(payload);
    const existing = metas.find((m) => m.id === id);
    const ts = now();
    if (existing) {
      existing.updatedAt = ts;
      existing.summary = s.summary;
      if (!existing.custom) existing.name = s.name;
      if (s.extra) existing.extra = s.extra;
      return existing;
    }
    const meta: SlotMeta = {
      id, name: s.name, custom: false, summary: s.summary,
      updatedAt: ts, syncedAt: 0, extra: s.extra,
    };
    metas.push(meta);
    return meta;
  }

  function persist(id: string, payload: T, meta: SlotMeta): void {
    writeJSON(resolveStorage(), slotKey(id), payload);
    if (cloud) void cloud.put(mode, toCloudMeta(meta), payload).catch((e) => console.warn('cloud put failed', e));
  }

  function save(payload: T, id: string | undefined = active() ?? undefined): void {
    if (!id) { create(payload); return; }
    const metas = index();
    const meta = refreshMeta(metas, id, payload);
    writeIndex(metas);
    persist(id, payload, meta);
  }

  function create(payload: T): SlotMeta {
    const metas = index();
    const id = genId();
    const meta = refreshMeta(metas, id, payload);
    writeIndex(metas);
    setActive(id);
    persist(id, payload, meta);
    return meta;
  }

  function rename(id: string, name: string): void {
    const metas = index();
    const meta = metas.find((m) => m.id === id);
    if (!meta) return;
    meta.name = name;
    meta.custom = true;
    meta.updatedAt = now();
    writeIndex(metas);
    const payload = readJSON<T | null>(resolveStorage(), slotKey(id), null);
    if (cloud && payload != null) void cloud.put(mode, toCloudMeta(meta), payload).catch((e) => console.warn('cloud rename failed', e));
  }

  function remove(id: string): void {
    const metas = index().filter((m) => m.id !== id);
    writeIndex(metas);
    try { resolveStorage().removeItem(slotKey(id)); } catch (e) { console.warn('saveSlots remove failed', e); }
    if (active() === id) setActive(null);
    if (cloud) void cloud.del(mode, id).catch((e) => console.warn('cloud del failed', e));
  }

  function importLegacy(raw: T): SlotMeta | null {
    if (opts.valid && !opts.valid(raw)) return null;
    return create(raw);
  }

  function setCloud(c: CloudSlotStore<T> | null): void {
    cloud = c;
  }

  async function sync(resolve: ConflictResolver): Promise<void> {
    if (!cloud) return;
    let cloudSlots: { meta: SlotMeta; payload: T }[];
    try {
      cloudSlots = await cloud.list(mode);
    } catch (e) {
      console.warn('cloud list failed', e);
      return;
    }
    const metas = index();
    const localById = new Map(metas.map((m) => [m.id, m]));
    const cloudById = new Map(cloudSlots.map((c) => [c.meta.id, c]));
    const ids = new Set<string>([...localById.keys(), ...cloudById.keys()]);

    const uploadLocal = async (meta: SlotMeta) => {
      const payload = readJSON<T | null>(resolveStorage(), slotKey(meta.id), null);
      if (payload == null) return;
      try { await cloud!.put(mode, toCloudMeta(meta), payload); meta.syncedAt = meta.updatedAt; }
      catch (e) { console.warn('cloud upload failed', e); }
    };
    const takeCloud = (meta: SlotMeta | undefined, row: { meta: SlotMeta; payload: T }) => {
      writeJSON(resolveStorage(), slotKey(row.meta.id), row.payload);
      if (meta) Object.assign(meta, row.meta, { syncedAt: row.meta.updatedAt });
      else metas.push({ ...row.meta, syncedAt: row.meta.updatedAt });
    };

    for (const id of ids) {
      const local = localById.get(id);
      const row = cloudById.get(id);
      if (local && !row) { await uploadLocal(local); continue; }
      if (!local && row) { takeCloud(undefined, row); continue; }
      if (!local || !row) continue;
      if (local.updatedAt === row.meta.updatedAt) continue;             // already agree
      if (local.updatedAt <= local.syncedAt) { takeCloud(local, row); continue; } // local untouched
      if (row.meta.updatedAt <= local.syncedAt) { await uploadLocal(local); continue; } // cloud untouched
      const choice = await resolve({ mode, local: { ...local }, cloud: { ...row.meta } }); // both advanced
      if (choice === 'cloud') takeCloud(local, row);
      else await uploadLocal(local);
    }
    writeIndex(metas);
  }

  return { list, active, setActive, load, save, create, rename, remove, atCap, importLegacy, setCloud, sync };
}
