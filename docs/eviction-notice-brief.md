# Eviction Notice — Build Brief

> **Eviction Notice** is an autonomous crypto trading agent that has to **earn its own survival**. It pays for its own existence — data, compute, gas — out of its trades, and only keeps running while it earns more than it burns. When it runs out of balance, the dashboard flips to **EVICTED** and the run is over. No revivals. A trading bot with a metabolism, living perpetually one bad day from the curb.

This document is the complete spec for building the agent, written to be handed directly to a coding agent. It captures the concept, the economy, the architecture, the data model, the UI, the safety model, the lifecycle, and a phased build plan.

---

## 1. Concept

Most trading agents are greed machines: make the number go up. This one is a survival machine. It has a **burn rate** (the cost of being alive) and has to trade well enough to outrun it. The drama — and the reason people watch — is mortality: a live death-clock, a public feed of it thinking and bleeding in real time, and the genuine possibility that it dies on camera.

Why this is the right project:
- It can only exist on this tech. Autonomous economic agents paying to survive is native to crypto and impossible without it.
- The x402 payments aren't theater — the agent is literally paying to live, so every micro-payment is load-bearing drama, not a checkbox.
- It's the most model-in-the-loop thing possible: the reasoning *is* the survival. A glorified if-statement can't decide to skimp on data when it's broke.
- It's a spectacle **and** substantive (risk management becomes the gameplay), instead of trading one for the other.
- The hook writes itself: "an AI that has to make rent or it dies."

---

## 2. Hackathon context

- **Sponsors / stack:** CoinMarketCap (data) × Trust Wallet (custody/execution) × BNB Chain (chain/venue).
- **Track 1 — Autonomous Trading Agents:** judged on live, real-money performance during the trading window. **This is the agent.**
- **Track 2 — Strategy Skills:** a backtestable, marketplace-published CMC Skill. **This is the sizing skill (see §5).**
- **Prizes:** Track 1 1st $10k / 2nd $6k / 3rd $4k / 4th–5th $2k. Track 2 1st $3k / 2nd $2k / 3rd $1k. Three special prizes ($2k each): Best Use of CoinMarketCap Data, Best Use of Trust Wallet Agent Kit, Best Use of BNB AI Agent SDK.
- **Double-dip strategy:** the Skill is the brain (Track 2), the agent is the hands that consume it (Track 1). One body of work, two tracks, and it touches all three sponsor layers to chase the special prizes.

**Timeline (confirm against the live hackathon page):**
- Build + simulate now through the code lock (~June 21, 12:00 UTC).
- **Birth the live agent at the window open (~June 22); live trading window June 22–28.**
- Winners announced ~week of July 6.

---

## 3. How it works — the two loops

There are two distinct loops; don't conflate them.

**Outer loop (the heartbeat).** A long-running worker daemon that ticks forever. Each tick:
1. Accrue rent (write a rent expense to the ledger).
2. Check if alive (balance > 0). If dead → halt permanently, mark dead.
3. If alive → optionally gather data, decide, maybe trade.
4. Sleep until the next tick.

This is `while (true) { await tick(); await sleep(interval); }` — a polling loop with a sleep, not a hot spin. It must be a **persistent process**, not serverless/cron, because the metabolism is a continuous clock (rent accrues every interval regardless of market activity).

**Inner loop (reason-and-act).** Within a tick, the LLM tool-use loop: the model decides what data to buy (each purchase is a metered ledger expense), calls the sizing skill, decides whether to trade, and executes. Bounded — it loops while the model requests tools and stops when it returns a final decision (with a max-iterations guard).

**Permadeath:** when the ledger balance hits zero, the agent halts forever. No auto-restart.

---

## 4. The economy (seed economy)

The whole feel of the project lives in these numbers. Tune so a break-even agent dies right at the window edge — survival should hinge on the agent being *smart*, not on starving it.

### Burn components

| Component | Scales with | Real or designed | Notes |
|---|---|---|---|
| **Rent** | time (always-on) | designed (virtual) | The "cost of existing." A number you impose; see §4.3. |
| **Data** | thinking frequency | can be real (x402) | Each CMC data call costs money. Per-think cost × thinks/day. |
| **Friction** | trading frequency | **real** | Gas + swap fees + slippage. The unavoidable, non-negotiable burn. |

### The friction headwind (the most important fact)

On BSC, a PancakeSwap swap burns ~130k gas. At ~1–3 gwei with BNB ≈ $600, that's **~$0.08–$0.25 per swap (~$0.15 working figure)**. A round trip (buy + sell) = 2 swaps ≈ $0.30 gas, plus PancakeSwap's 0.25% fee per side, plus slippage.

Because gas is a **fixed cost per swap**, it dominates at small size:
- $5 position → ~6.5% round-trip headwind
- $10 position → ~3.5%
- ~$20 position → ~2%

**Consequences:**
- The agent cannot churn. Every round trip must expect to clear its friction cost or it shouldn't fire.
- Bigger, fewer positions amortize gas better than many small ones — at the cost of diversification.
- Trade frequency should be an **output of a skip-rule**, not a fixed schedule (see §5).

### Recommended starting config (validate in simulation)

- Seed: **$20**
- Rent: **~$0.07 / hour** (this lands a break-even, idle agent at ~7-day runway = right at the window edge — the knife's edge)
- Think interval: **30 min** (≈ 48 thinks/day; data ≈ $0.01/think ≈ $0.48/day)
- Position size: **~$12–15** (keeps gas a small % without going all-in)
- Gas/swap: **~$0.15** (variable — the agent should read live gas)
- Swap fee: 0.25% per side (PancakeSwap V2)

At $0.07/hr rent the idle runway is ~7 days, so it MUST net positive trading P&L to survive the full window. Nudge rent to tune the exact runway. **Do not reduce trade frequency to save money** — trades are where income comes from; suppressing them just guarantees a slow idle death. The fix is trades that clear the bar, not fewer trades.

### How rent actually works (mechanics)

Rent is **a ledger entry, not an on-chain transfer.** Each interval the worker writes one negative row (`-$X, reason: rent`); no money moves. Real money only ever leaves the wallet via gas and trade losses (and real x402 data fees, if enabled).

- **Wallet = vault, ledger = truth.** The wallet physically holds the funds; the ledger decides alive/dead and how much the agent may risk. The agent reads its post-rent ledger balance as its true runway.
- **Death:** ledger balance ≤ 0 → halt the worker. The operator then sweeps any remaining real funds from the burner wallet.
- **Why not hourly on-chain rent:** a $0.07 transfer would cost ~$0.10–0.15 in gas — more than the rent. Never do per-hour on-chain transfers.
- **Optional legitimacy:** accrue rent virtually, then do a **single real "rent sweep"** transaction to a landlord wallet (yours) at the end (or a couple of checkpoints) — one gas payment instead of 168, with the honest "the money actually left its wallet" story.

---

## 5. Track 2 deliverable — the Solvency-Aware Sizing skill

The agent's hardest decision isn't buy/sell — it's *"I have $X left and I'm burning $Y/hour; how much do I dare risk to maximize how long I stay alive?"* That question is the Skill.

- **Input:** current balance, burn rate, and a candidate trade (expected edge + volatility), plus live gas/friction.
- **Output:** a position size and a **go / no-go** (the skip-rule), optimized for **longevity**, not return.
- **Why it's novel:** almost all position-sizing (Kelly and friends) is return-optimal. Sizing for "don't die before rent is due" — survival-optimal under a burn rate — is a fresh contribution.
- **The skip-rule principle:** only trade if `expected_edge > round_trip_friction` (with margin). Otherwise skip and say so in the feed ("skipping: 1.5% edge doesn't beat 3.5% friction"). This is both real survival behavior and great model-in-the-loop theater.
- **Backtest = survival curves.** Simulate a population of agents over historical BSC data — same burn rate, different sizing brains (yours vs naive fixed-fraction vs Kelly) — and plot Kaplan-Meier-style "how many are alive at day N." If your agents outlive the others, that one chart is the Track 2 pitch.
- **x402-gated + reusable.** Publish the skill on the CMC Skills Marketplace behind x402. The agent pays its **own** skill to think — meaningful, not circular, because other survival-agents can pay it too (staying alive is everyone's problem).

---

## 6. Architecture & tech stack

**TypeScript end to end.** No Python needed — Trust Wallet's Agent Kit speaks REST + MCP, and CMC's MCP is just an endpoint. (Python only if you go deep on the BNB APEX/ERC-8004 agent-economy layer, which this agent doesn't require.)

**Three things you deploy:**
- **Agent worker** — Node daemon on Railway (or Render/Fly). Persistent, always-on. Holds the loop, the TWAK signer, the CMC + skill calls.
- **Database** — Supabase (Postgres + Realtime). Source of truth and the realtime push to the UI.
- **Frontend** — Next.js on Vercel. Almost entirely read-only.

**Three things the worker calls:**
- **CMC MCP** (`https://mcp.coinmarketcap.com/mcp`, header `X-CMC-MCP-API-KEY`) — market data; paid per call (x402).
- **Sizing skill** — your own x402-gated endpoint.
- **Trust Wallet Agent Kit (TWAK)** — local self-custody signing → PancakeSwap swaps on BSC.

**LLM:** Claude via the Anthropic SDK or Vercel AI SDK (hackathon provides API credits).

**Key architectural rule:** the worker **never talks to the frontend directly.** It writes everything as rows to Postgres; Supabase Realtime pushes those rows to the browser. The worker doesn't know the frontend exists — so the agent and the dashboard develop independently. (The UI is a window onto persisted state.)

**Data flow:** worker reaches *down* to act (buy data, ask the skill, sign + trade) and everything it does flows *up* as ledger rows → Postgres → realtime → frontend.

---

## 7. Data model — the ledger

Do **not** store a mutable `balance`. Store an **append-only ledger**; balance = `SELECT SUM(amount)`. This one table is simultaneously the source of truth, the live feed content, and the Track 2 backtest data. It also lets the agent rehydrate exact state after a crash.

```sql
-- transactions: append-only ledger
create table transactions (
  id          bigserial primary key,
  agent_id    text not null,
  ts          timestamptz not null default now(),
  kind        text not null,         -- 'income' | 'expense' | 'rent'
  amount      numeric not null,      -- signed: income > 0, expense/rent < 0
  reason      text not null,         -- 'trade_close' | 'data_call' | 'gas' | 'x402_fee' | 'rent' | ...
  reasoning   text,                  -- the model's thought for this action (feeds the UI)
  meta        jsonb                  -- token, tx hash, position size, edge, etc.
);

-- positions: open trades (optional, can also be derived)
create table positions (
  id          bigserial primary key,
  agent_id    text not null,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  token       text not null,
  size_usd    numeric not null,
  entry_px    numeric not null,
  exit_px     numeric,
  pnl_usd     numeric
);

-- agent_state: lifecycle flags
create table agent_state (
  agent_id    text primary key,
  born_at     timestamptz,
  died_at     timestamptz,
  status      text not null default 'alive'  -- 'alive' | 'dead'
);
```

- **Balance:** `SELECT SUM(amount) FROM transactions WHERE agent_id = $1`.
- **Alive check:** balance > 0 AND status = 'alive'.
- **Feed:** stream `transactions` newest-first; color income green, expense/rent red, reasoning neutral.
- **Frontend** subscribes to `transactions` (and `agent_state`) via Supabase Realtime.

---

## 8. The UI / live feed

Vibe: hospital vital-signs monitor crossed with a Twitch stream.

- **Vital signs (top):** balance (life force), runway (time-to-death at current burn), burn rate, days survived. A depleting life bar. A pulsing "alive" indicator.
- **Live feed (the centerpiece):** a streaming, timestamped log interleaving reasoning, data purchases (expense), trades, and rent ticks — money in/out color-coded. People tune in for the feed, not the P&L number. The flip into "survival mode" with hours left is the screenshot.
- **Balance sparkline:** balance over time — is it winning the race against its own burn?
- **Death screen:** when the ledger hits zero, the whole dashboard flips to a full-bleed **EVICTED** state — final stats frozen (days survived, peak balance, final P&L, total trades). The run is over; no revival.

**Interaction model:**
1. **Spectator (default):** one agent, one life — watch it live or die and see how long it lasts. No leaderboard, no colony, no crew. Single agent by design.
2. **Lifeline tip-jar:** viewers can tip balance to extend its life. Must be **scarce/costly** (rate-limited, buys minutes not full rescues) or it defuses the mortality that makes it interesting.

---

## 9. Execution & money safety

- **Mainnet, not testnet.** Testnet is useless for a *trading* agent (no real market, fake prices). Validate strategy in **simulation** (paper-trade against live CMC data into the virtual ledger); validate the **plumbing** (TWAK signs → swap submits → confirms) with a couple of trivial transactions before funding the real run.
- **Burner wallet:** generate a fresh key that holds **only** the ~$20. Never the agent's signer touch a personal wallet. Worst case (bug, bad loop, key leak from a hosted worker) is bounded at $20.
- **Key handling:** signing key in the worker's environment / Railway secret — never in the repo.
- **Liquid pairs only:** $20 trades into thin pools get eaten by slippage and possibly sandwiched. Stick to deep pools (e.g. BNB/USDT, major pairs).
- **Live gas:** the agent should read current gas and fold it into the skip-rule — refuse trades when friction exceeds expected edge.
- **Real vs simulated burn:** build simulated first (virtual ledger). Upgrade data calls to **real x402** once the loop is stable — that's the flex that wins the x402/CMC narrative (nothing faked).

---

## 10. Activation & lifecycle

- There is **no "activate" button.** Activation = deploy the worker in live mode + fund the burner wallet + flip execution from paper to mainnet. From that instant it runs itself off its heartbeat; no daily trigger.
- **Birth is unpausable.** The live mainnet run is a committed, roughly one-shot event — light it and let the arc play out. Time it to the window open (~June 22) so its survival arc happens while judges and an audience are watching. Activating early just means it's already dead (or boringly stable) by judging.
- **Single life, no revivals (decided).** One agent, one committed life. When the ledger hits zero, the dashboard flips to **EVICTED** and the run is over — no respawns, no lineage, no fresh $20, no leaderboard of past lives. Tune hard in sim so a typical life comfortably outlasts the window, making an early death unlikely; then accept the small remaining risk, because "survived the whole week" and "died on day 4 fighting a crash" are both far better stories than a bot that respawns whenever it dies. The finality is the point.

---

## 11. Build plan (phases)

- **Phase 0 — Scaffold.** Worker process, Supabase schema (§7), Next.js frontend skeleton subscribed to `transactions`.
- **Phase 1 — Loop in simulation.** Outer tick + inner reason-and-act loop. Paper-trade against live CMC data. Virtual ledger (rent, data, simulated gas/fees, trade P&L). Feed renders live. Watch where it dies; this is where you tune the economy.
- **Phase 2 — Sizing skill + skip-rule + backtest.** Build the Solvency-Aware Sizing skill, wire it into the loop, produce the survival-curve backtest (Track 2 deliverable). Publish behind x402 on the Skills Marketplace.
- **Phase 3 — Real execution.** Integrate TWAK signing → PancakeSwap on BSC. Validate plumbing with trivial transactions. Optionally upgrade data calls to real x402.
- **Phase 4 — Tune + polish.** Lock the seed economy with real BSC gas/spread numbers. Polish the dashboard; add the lifeline tip-jar.
- **Phase 5 — Lock & birth.** Lock code (~June 21). Deploy live, fund the burner wallet, birth on mainnet (~June 22). Watch it live through the window.

---

## 12. Open questions / flags to resolve early

- **Mainnet vs testnet for judging** is not definitively answered in the builder Telegram. Proceeding on **mainnet** (testnet is useless for a trading agent). Confirm before the live window.
- **CMC x402 per-call price** — confirm the real cost from CMC docs; it sets the data burn and your think frequency.
- **TWAK reference** — fork `tw-agent-skills` on day one; confirm its language and the local signing-loop pattern.
- **BNB AI Agent SDK** (`bnbagent` = APEX + ERC-8004) is an agent identity/commerce protocol, **not** a PancakeSwap execution toolkit and currently testnet-only. The metabolism agent doesn't need it; execution is via TWAK + PancakeSwap contracts directly. (Only relevant if you later add an agent-economy angle.)
- **Gas is variable** — never hardcode it; read live and fold into the skip-rule.

---

## 13. Stack → prize mapping

| Deliverable | Competes for |
|---|---|
| The metabolism agent (live, real money) | Track 1 |
| Solvency-Aware Sizing skill (backtested, marketplace, x402) | Track 2 |
| CMC MCP data + x402 data purchases | Best Use of CoinMarketCap Data |
| TWAK self-custody signing of live trades | Best Use of Trust Wallet Agent Kit |
| BSC / PancakeSwap execution (+ optional APEX) | Best Use of BNB AI Agent SDK |

---

### One-line north star

Tune the rent so a break-even agent dies exactly when the window closes — then let the quality of its trading decide whether it lives. The mortality should hinge on the agent being smart, not on you starving it.
