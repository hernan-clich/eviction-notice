-- Eviction Notice — initial schema.
--
-- The append-only `transactions` ledger is the single source of truth:
--   balance = SELECT SUM(amount) FROM transactions WHERE agent_id = $1
-- No mutable balance column exists by design. `positions` records trades and
-- `agent_state` holds lifecycle flags.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.

-- transactions: append-only ledger -------------------------------------------
create table if not exists transactions (
  id         bigserial primary key,
  agent_id   text not null,
  ts         timestamptz not null default now(),
  kind       text not null check (kind in ('income', 'expense', 'rent')),
  amount     numeric not null,        -- signed USD: income > 0, expense/rent < 0
  reason     text not null,           -- 'trade_close' | 'data_call' | 'gas' | 'x402_fee' | 'rent' | ...
  reasoning  text,                    -- the model's thought for this action (feeds the UI)
  meta       jsonb                    -- token, tx hash, position size, edge, etc.
);

create index if not exists transactions_agent_ts_idx on transactions (agent_id, ts desc);

-- positions: open/closed trades ----------------------------------------------
create table if not exists positions (
  id         bigserial primary key,
  agent_id   text not null,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  token      text not null,
  size_usd   numeric not null,
  entry_px   numeric not null,
  exit_px    numeric,
  pnl_usd    numeric
);

create index if not exists positions_agent_idx on positions (agent_id, opened_at desc);

-- agent_state: lifecycle flags -----------------------------------------------
create table if not exists agent_state (
  agent_id   text primary key,
  born_at    timestamptz,
  died_at    timestamptz,
  status     text not null default 'alive' check (status in ('alive', 'dead'))
);

-- Row Level Security ---------------------------------------------------------
-- The dashboard reads with the anon key (public, read-only). The worker writes
-- with the service-role key, which bypasses RLS — so no write policies needed.
alter table transactions enable row level security;
alter table positions enable row level security;
alter table agent_state enable row level security;

create policy "public read transactions" on transactions for select using (true);
create policy "public read positions" on positions for select using (true);
create policy "public read agent_state" on agent_state for select using (true);

-- Realtime -------------------------------------------------------------------
-- The frontend subscribes to ledger rows + lifecycle changes via Supabase Realtime.
alter publication supabase_realtime add table transactions;
alter publication supabase_realtime add table agent_state;
