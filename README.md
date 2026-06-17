# Eviction Notice

**An autonomous crypto-trading agent that has to earn its own rent — or die.**

Eviction Notice is a live trading agent for the **BNB Hack: AI Trading Agent
Edition** (CoinMarketCap × Trust Wallet × BNB Chain). It trades real funds on BNB
Chain, and it lives inside a survival fiction: every hour it owes **rent**. Pay it
and the agent stays online; let its net worth hit zero and it is **EVICTED** —
permanently, no revivals. The whole run is a public, real-time spectator stream of
an AI fighting to keep the lights on.

The mortality is a lens, not a gimmick. An agent that can be evicted has to think
about **solvency**, not just returns — and that discipline is the project's edge
on both tracks of the hackathon.

---

## The angle

Most trading agents optimise for return and discover risk the hard way. Eviction
Notice inverts it: **stay solvent first, profit second.** Concretely —

- It books an honest **trading equity** (the real wallet) separately from the
  fictional rent, so the survival drama never pollutes the metric the competition
  actually scores.
- It sizes positions for **survival, not growth** — a skip-rule that refuses
  trades that can't beat their own friction, and a drawdown cap that refuses to
  risk a disqualification.
- It grounds every decision in **CoinMarketCap Agent Hub signals** (RSI/MACD,
  market regime, Fear & Greed, trending), not vibes.

## Two tracks, one codebase

### Track 1 — the autonomous trading agent
A persistent worker trades a real BNB-Chain wallet on a heartbeat: accrue rent →
mark the book → check it's still alive → think (gather signals, decide, size,
trade) → sleep. Swaps are real PancakeSwap spot trades via the Trust Wallet Agent
Kit CLI; the agent even pays its own sizing skill to think, over **x402**. A live
spectator **dashboard** streams its vitals — net worth, runway, burn, the depleting
life bar — and freezes a memorial **EVICTED** screen at end of life.

### Track 2 — the Solvency-Aware Sizing skill
A reusable **CMC Strategy Skill** ([`apps/skill`](apps/skill)) packaged as a
backtestable spec, not a live bot. It turns Agent Hub signals into a deterministic
**size-or-skip** decision tuned for survival under a burn rate and a max-drawdown
cap. It is reproducibly backtested against the standard baselines:

```
Survival over a 7-day window (2000 agents, seed=1) — % still alive
solvency-aware   100%   ·  kelly   8%   ·  fixed-fraction   0%
```

See [`apps/skill/SKILL.md`](apps/skill/SKILL.md),
[`apps/skill/BACKTEST.md`](apps/skill/BACKTEST.md), the schema in
[`apps/skill/skill.json`](apps/skill/skill.json), and authentic runs in
[`apps/skill/examples`](apps/skill/examples). Reproduce the backtest with
`pnpm --filter skill backtest`.

---

## How it works

```
CoinMarketCap Agent Hub ─┐
  (RSI/MACD, regime,     │      ┌──────────────┐     ┌─────────────────┐
   Fear & Greed)         ├────► │   worker     │ ──► │ Trust Wallet    │ ──► PancakeSwap
                         │      │ (heartbeat,  │     │ Agent Kit (CLI) │     spot, BNB Chain
  Solvency-Aware Sizing ─┘      │  reason+act) │     └─────────────────┘
  skill (x402, self-paid)       └──────┬───────┘
                                       │ append-only ledger + snapshots
                                       ▼
                                  Supabase  ──(Realtime)──►  live dashboard / replay
```

- **`apps/worker`** — the always-on agent daemon (deploys to Render). Reason-and-act
  loop, rent accrual, marked balance sheet, eviction, gas-tank watch.
- **`apps/skill`** — the x402-gated Solvency-Aware Sizing skill (Hono). Also the
  Track-2 strategy package + survival backtester.
- **`apps/web`** — the live spectator dashboard + post-mortem replay (Next.js,
  deploys to Vercel).
- **`packages/shared`** — the ledger types and `computeVitals` (cash, net worth,
  trading equity, drawdown, runway) shared by worker, web, and backtest.

The ledger is **append-only** in Supabase: balance is the sum of the ledger, net
worth marks open positions to market, and the dashboard reanimates the whole run
from it. Real money moves over **x402 with Permit2 on BSC** (USDT); the agent's
hourly rent and modeled data costs are fiction layered on top, never subtracted
from the real wallet value the competition scores.

## What it is / what it isn't

**Is:**
- A real spot-trading agent on BNB Chain (paper and live execution modes).
- Solvency-first: honest trading-equity accounting, a survival-tuned sizer, a hard
  drawdown-DQ guard, and a ≥1-trade/day floor.
- Grounded in CMC Agent Hub signals, with a deterministic, reproducible backtest.

**Isn't:**
- Not leveraged and not perps — spot only.
- Not financial advice, and the rent/eviction layer is **narrative**: it shapes the
  agent's behaviour but is excluded from the scored wallet PnL and drawdown.
- Not a promise of profit — survival-optimal sizing improves the *distribution* of
  outcomes; it can't manufacture edge that isn't in the signal.

## Quickstart

Requires Node ≥ 22 and `pnpm`.

```bash
pnpm install
pnpm test                      # shared + worker + skill suites
pnpm --filter skill backtest   # the survival-curve backtest (Track 2)
pnpm dev                       # run the apps locally
```

Each app reads its own `.env` (see each package for the variables it needs); the
worker defaults to **paper** execution so it runs without funds or keys.

## Repo layout

| Path | What |
| --- | --- |
| `apps/worker` | Autonomous trading agent (Render) |
| `apps/skill` | Solvency-Aware Sizing skill + backtester (Track 2) |
| `apps/web` | Live spectator dashboard + replay (Vercel) |
| `packages/shared` | Ledger + vitals, shared across the monorepo |

---

_Live dashboard: add the Vercel URL here before submission._
