-- Eviction Notice — net-worth snapshots.
--
-- One row per tick: the agent's marked balance sheet at that moment.
--   cash_usd           = SUM(transactions.amount) (liquidity)
--   position_value_usd = open positions marked to current price
--   net_worth_usd      = cash_usd + position_value_usd (life force + death line)
-- The dashboard reads these for the net-worth headline + the lifetime chart;
-- #28 replay reuses them. Cash stays derivable from the ledger; this just adds
-- the marked position value the web can't compute on its own.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.

create table if not exists snapshots (
  id                  bigserial primary key,
  agent_id            text not null,
  ts                  timestamptz not null default now(),
  cash_usd            numeric not null,
  position_value_usd  numeric not null,
  net_worth_usd       numeric not null,
  positions           jsonb              -- [{token, sizeUsd, entryPx, markPx, valueUsd}]
);

create index if not exists snapshots_agent_idx on snapshots (agent_id, id);

-- Row Level Security: public read; the worker writes with the service-role key
-- (bypasses RLS), so no write policy is needed.
alter table snapshots enable row level security;
create policy "public read snapshots" on snapshots for select using (true);

-- Realtime: the dashboard subscribes to new snapshots for the live net-worth feed.
alter publication supabase_realtime add table snapshots;
