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

1. Render → **New → Blueprint** → connect this repo. Render reads `render.yaml` — the active
   Blueprint is the **skill only** (free tier), so **no card is required**.
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

## C. Always-on worker (paid Starter, live)

The permadeath loop runs 24/7 as a paid Render `worker` (in `render.yaml`). It signs
real BSC swaps via TWAK, so `render-start.sh` provisions the wallet on boot from
secrets. **Only one worker may run per `agent_id`** — don't also run it locally.

1. **Provision the wallet secrets** — on your machine:
   ```
   base64 -i ~/.twak/wallet.json        # → TWAK_WALLET_JSON_B64
   base64 -i ~/.twak/credentials.json   # → TWAK_CREDENTIALS_JSON_B64
   ```
   `wallet.json` is AES-encrypted (only usable with `TWAK_WALLET_PASSWORD`).
2. Render Blueprint → set the worker's `sync: false` secrets: `SUPABASE_URL`,
   `SUPABASE_SECRET_KEY`, `CMC_API_KEY`, `ANTHROPIC_API_KEY`, `SKILL_URL`, `X402_PAYER`,
   `TWAK_WALLET_PASSWORD`, `TWAK_WALLET_JSON_B64`, `TWAK_CREDENTIALS_JSON_B64`.
3. Deploy. It re-seeds `SEED_USD` on first boot and ticks every 30 min. Watch logs for
   `live swap executed`; a low-BNB warning means top up the gas tank.

For a $0 alternative (tick-on-cron) see the git history — paid Starter is the launch path.

## D. Web dashboard (Vercel)

`apps/web` → Vercel project, root `apps/web`, env `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable `sb_publishable_…`, read-only via RLS).
Pre-launch: set `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD` to gate the site; unset at go-live.

## Real on-chain run (after #13/#14)

Once TWAK signing + a funded BSC burner land, repeat B/C with real swaps — testnet first,
then a small mainnet run (~$5) before the scored go-live.
