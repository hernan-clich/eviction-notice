# Deploy

Two deployables (`render.yaml` Blueprint): the **skill** (x402 sizing endpoint) and the
**worker** (the agent loop). The **web** dashboard goes to Vercel separately.

## Secrets to have ready

| Key | Where from |
| --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → Data API |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys → `sb_secret_…` (server-side, bypasses RLS) |
| `CMC_API_KEY` | pro.coinmarketcap.com → API key |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `X402_PAYER` / `X402_PAY_TO` | BSC wallet addresses (placeholder `0x000…0` until #14) |

## A. Deploy the skill (free web service)

1. Render → **New → Blueprint** → connect this repo. Render reads `render.yaml`.
2. For **eviction-notice-skill**, set `X402_PAY_TO` (placeholder `0x0000000000000000000000000000000000000000` for now).
3. Deploy. Confirm `GET https://eviction-notice-skill.onrender.com/healthz` → `{"ok":true}`.
   - Free web services sleep after 15 min idle and cold-start on the next request — fine for the skill.

## B. Operational validation run (no paid hosting)

Run the worker **locally** against the **deployed skill** + **prod Supabase** + real CMC/Anthropic.
This exercises the entire pipeline (data → reasoning → ledger → x402 skill payment) with paper
execution — everything except on-chain swaps (#13).

In `apps/worker/.env`:

```
SUPABASE_URL=…           SUPABASE_SECRET_KEY=sb_secret_…
CMC_API_KEY=…            ANTHROPIC_API_KEY=…
SKILL_URL=https://eviction-notice-skill.onrender.com
TICK_INTERVAL_MS=60000   # fast ticks for a visible test
MAX_TICKS=20             # bound the cost of the first run
```

```
pnpm --filter worker start
```

Watch the dashboard (Supabase Realtime). You should see `data_call`, `x402_fee` (skill payment),
`decision`, and paper `trade_open`/`trade_close` rows. Set `MAX_TICKS=0` for a continuous run.

## C. Always-on worker (go-live, paid)

The permadeath loop must run 24/7, so the worker is a **paid** Render service (`plan: starter`).
In the Blueprint, set the worker's secrets + `SKILL_URL` to the deployed skill, then deploy.
Lower `TICK_INTERVAL_MS` back to `1800000` (30 min) for production cadence.

## D. Web dashboard (Vercel)

`apps/web` → Vercel project, root `apps/web`, env `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable `sb_publishable_…`, read-only via RLS).

## Real on-chain run (after #13/#14)

Once TWAK signing + a funded BSC burner land, repeat B/C with real swaps — testnet first,
then a small mainnet run (~$5) before the scored go-live.
