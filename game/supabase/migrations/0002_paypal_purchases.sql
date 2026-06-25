-- PayPal purchase ledger for web/PWA digital goods.
-- Run this against the shared Grayson Games Supabase project before enabling
-- live PayPal captures.

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id text not null,
  provider text not null,
  provider_order_id text not null,
  provider_capture_id text,
  sku text not null,
  amount numeric(10, 2) not null,
  currency text not null,
  status text not null,
  grant jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchases_provider_order_uidx
  on purchases (provider, provider_order_id);

create unique index if not exists purchases_provider_capture_uidx
  on purchases (provider, provider_capture_id)
  where provider_capture_id is not null;

create index if not exists purchases_user_game_idx
  on purchases (user_id, game_id, created_at desc);
