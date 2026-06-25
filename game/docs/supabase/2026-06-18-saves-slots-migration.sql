-- Generalise the single-blob `saves` table into slot-aware rows.
-- Existing Stars rows default to mode='stars', slot='main'.
alter table saves add column if not exists mode text not null default 'stars';
alter table saves add column if not exists slot text not null default 'main';

-- Repoint the primary key to include mode + slot.
alter table saves drop constraint if exists saves_pkey;
alter table saves add  constraint saves_pkey primary key (user_id, game_id, mode, slot);

-- RLS already restricts rows to auth.uid() = user_id; the new columns are covered.
-- (Confirm the live PK constraint name first if it is not the Postgres default `saves_pkey`.)
