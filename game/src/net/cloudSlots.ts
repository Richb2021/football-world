// src/net/cloudSlots.ts
/**
 * Supabase-backed implementation of CloudSlotStore<T>.
 *
 * The soccer-only saves table schema (slot-aware):
 *   (user_id, game_id, mode, slot, data, updated_at)
 *
 * `data` is either:
 *   - wrapped: { meta: SlotMeta, payload: T }  (new rows)
 *   - legacy:  raw T blob (old Stars rows that stored StarsState directly)
 */
import type { CloudSlotStore, SlotMeta } from './saveSlots';
import { GAME_ID, SAVES_TABLE } from './supabase';

export interface SlotRow {
  user_id: string;
  game_id: string;
  mode: string;
  slot: string;
  /** New rows: { meta, payload }. Legacy rows: raw payload blob. */
  data: { meta: SlotMeta; payload: unknown } | unknown;
  updated_at: string;
}

/**
 * Minimal slice of the Supabase client this module relies on.
 * Kept narrow so the unit tests can inject a simple in-memory fake.
 */
export interface SlotClient {
  from(table: string): {
    select(cols: string): {
      eq(c: string, v: unknown): {
        eq(c: string, v: unknown): {
          eq(c: string, v: unknown): Promise<{ data: SlotRow[] | null; error: unknown }>;
        };
      };
    };
    upsert(row: SlotRow, opts?: { onConflict: string }): Promise<{ error: unknown }>;
    delete(): {
      eq(c: string, v: unknown): {
        eq(c: string, v: unknown): {
          eq(c: string, v: unknown): {
            eq(c: string, v: unknown): Promise<{ error: unknown }>;
          };
        };
      };
    };
  };
}

function isWrapped(data: unknown): data is { meta: SlotMeta; payload: unknown } {
  return (
    !!data &&
    typeof data === 'object' &&
    'meta' in (data as object) &&
    'payload' in (data as object)
  );
}

export function makeCloudSlotStore<T>(userId: string, client: SlotClient): CloudSlotStore<T> {
  return {
    async list(mode: string): Promise<{ meta: SlotMeta; payload: T }[]> {
      let result: { data: SlotRow[] | null; error: unknown };
      try {
        result = await (client
          .from(SAVES_TABLE)
          .select('user_id,game_id,mode,slot,data,updated_at') as unknown as {
            eq(c: string, v: unknown): {
              eq(c: string, v: unknown): {
                eq(c: string, v: unknown): Promise<{ data: SlotRow[] | null; error: unknown }>;
              };
            };
          })
          .eq('user_id', userId)
          .eq('game_id', GAME_ID)
          .eq('mode', mode);
      } catch {
        return [];
      }
      const { data, error } = result;
      if (error || !data) return [];

      return data.map((row): { meta: SlotMeta; payload: T } => {
        if (isWrapped(row.data)) {
          return { meta: row.data.meta, payload: row.data.payload as T };
        }
        // Legacy row: raw payload stored without a meta wrapper.
        const meta: SlotMeta = {
          id: row.slot,
          name: row.slot,
          custom: false,
          summary: '',
          updatedAt: Date.parse(row.updated_at) || 0,
          syncedAt: 0,
        };
        return { meta, payload: row.data as T };
      });
    },

    async put(mode: string, meta: SlotMeta, payload: T): Promise<void> {
      // Strip syncedAt — it's local bookkeeping, never uploaded.
      const { syncedAt: _drop, ...cloudMeta } = meta;
      const { error } = await client.from(SAVES_TABLE).upsert(
        {
          user_id: userId,
          game_id: GAME_ID,
          mode,
          slot: meta.id,
          data: { meta: cloudMeta as SlotMeta, payload },
          updated_at: new Date(meta.updatedAt).toISOString(),
        },
        { onConflict: 'user_id,game_id,mode,slot' },
      );
      if (error) throw error;
    },

    async del(mode: string, id: string): Promise<void> {
      const { error } = await client
        .from(SAVES_TABLE)
        .delete()
        .eq('user_id', userId)
        .eq('game_id', GAME_ID)
        .eq('mode', mode)
        .eq('slot', id);
      if (error) throw error;
    },
  };
}
