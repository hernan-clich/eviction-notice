---
name: solvency-aware-sizing
description: |
  Survival-optimal position sizing for autonomous crypto trading agents on a
  burn rate. Turns CoinMarketCap Agent Hub signals (technical analysis, market
  regime, trending narratives) into a size-or-skip decision that maximises how
  long the agent stays SOLVENT - not expected return - under a max-drawdown DQ
  cap and round-trip trading friction.
  Use when an agent must decide HOW MUCH to deploy on a candidate trade (or
  whether to trade at all) while paying ongoing costs and risking a drawdown
  disqualification. Trigger phrases: "how big should this position be", "size
  this trade", "should I take this trade", "position sizing", "risk budget",
  "am I going to get disqualified".
license: MIT
compatibility: ">=1.0.0"
user-invocable: true
allowed-tools:
  - mcp__cmc-mcp__get_technical_analysis
  - mcp__cmc-mcp__get_crypto_technical_analysis
  - mcp__cmc-mcp__get_market_regime
  - mcp__cmc-mcp__get_global_metrics_latest
  - mcp__cmc-mcp__get_trending
  - mcp__cmc-mcp__trending_crypto_narratives
  - mcp__cmc-mcp__get_quotes
---

# Solvency-Aware Sizing

Almost every position-sizing rule - Kelly and its cousins - is **return**-optimal:
it maximises long-run growth assuming you can always stay in the game. An agent
that pays rent/compute to exist and can be **disqualified at a fixed drawdown**
plays a different game. This skill is **survival**-optimal: given a balance, a
burn rate, and a candidate trade, it sizes to maximise *how long the agent stays
solvent*, then proves that posture out-survives the return-optimal baselines on a
reproducible backtest.

It is a **backtestable strategy spec, not a live agent.** The output is a sizing
decision + the survival-curve evidence behind it; execution is the caller's job.

## When to use

Invoke this skill at the sizing step of a trading loop, *after* a candidate token
and direction have been chosen, to answer: **size, or skip?** It's built for
agents that (a) pay an ongoing cost to operate, and (b) face a hard max-drawdown
disqualification - the conditions of the BNB Hack Track-1 brief, but general to
any solvency-constrained trader.

## Signals → (edge, volatility), in code

The strategy needs two numbers per candidate - an **edge** (expected fractional
return) and a **volatility** (fractional downside over the hold). It derives both
**deterministically, in code** from Agent Hub signals (`deriveSignals` in
`src/signals.ts`) - not by asking a model to eyeball the charts. Same signals in
→ same numbers out, so the whole pipeline is replayable:

| Signal | Source | Tool | How it maps |
| --- | --- | --- | --- |
| RSI(14) | technical analysis | `get_technical_analysis` / `get_crypto_technical_analysis` | A momentum score: zero in weakness (≤50), peaks in the healthy-uptrend band, tapers when overbought |
| MACD histogram | technical analysis | `get_crypto_technical_analysis` | Confirmation - a positive histogram lets the momentum through |
| Price vs MA(30) | technical analysis | `get_crypto_technical_analysis` | Confirmation - price above a rising MA = trend agrees |
| ATR | technical analysis | `get_crypto_technical_analysis` | `volatility`, floored and capped |
| Fear & Greed | market regime | `get_market_regime` / `get_global_metrics_latest` | Regime gate - discounts the edge hard in fear (×0.3 extreme), passes it in greed |
| Candidate set | trending | `get_trending` / `trending_crypto_narratives` | Which liquid movers are worth scoring at all |
| Marks | quotes | `get_quotes` | Value balance + open positions |

The mapping is intentionally conservative: it produces a **positive edge only on
confirmed upward momentum** (never on oversold "due to bounce"), **caps** it (no
single read claims more than 3%), and **discounts it in a fearful tape**. The
parsers (`parseTechnicalAnalysis`, `parseMarketRegime`) tolerate the Hub's
payload shape; `signalsFromHub(caller, id)` pulls both tools and derives in one
call, and **throws rather than size on an unparseable payload** - it never guesses.
See `examples/signal-derivation-end-to-end.json` for a real raw-payload → size run.

Agent-state inputs the caller supplies: `balanceUsd`, `netWorthUsd`,
`peakNetWorthUsd`, `burnRatePerHourUsd`, `gasPerSwapUsd`, `maxDrawdownFraction`,
and a `desperation` scalar in [0,1] (0 while comfortable, 1 at death's door).

## The decision (two rules)

1. **Skip-rule.** Compute round-trip friction `f(size) = 2·gas/size + 2·fee +
   slippage`. Gas is *fixed per swap*, so friction% falls as size grows - evaluate
   it at the largest survival-safe size to give the edge its best chance. **Trade
   only if `edge ≥ friction + margin`**; otherwise the trade is a guaranteed bleed,
   so skip.
2. **Drawdown-capped sizing.** Never risk so much that a volatility-sized loss
   could breach the max-drawdown cap (measured on net worth vs its ratcheting
   all-time peak), never exceed a max fraction of balance, and always hold back a
   cash reserve for upcoming burn. The position is the **min** of those three caps.

**Desperation** bends both rules as runway shrinks: a calm agent waits for a clean
edge and hoards its rent reserve; a dying agent frees that reserve and lowers its
edge bar (down to a sub-friction hail-mary), because certain eviction makes
inaction the worst option. If the drawdown cap is *already breached* (permanently
DQ'd), the cap protects nothing and is voided - size by available cash alone.

> Reference implementation: `src/sizing.ts` - `decideSizing(input)` →
> `{ decision: 'trade' | 'skip', sizeUsd, roundTripFrictionFraction, reason }`.

## Backtest (the evidence)

`src/backtest.ts` runs a population of agents - identical seed + burn, different
sizing brains - over seeded Monte-Carlo market paths and asks the only question
that matters: **how many are still solvent at day N?** Every strategy sees the *same*
path per agent, so differences are sizing, not luck. Drawdown is measured on
trading equity (rent added back) so the burn metabolism alone never trips the DQ -
only real trading losses do.

Baselines it beats on survival:

- `kelly` - return-optimal `edge / variance`, capped; no survival guard.
- `fixed-fraction` - naively deploys half the balance every tick.

Output per strategy: `survivalByDay[]`, `survivedWindow`, `medianSurvivalDays`.
Run it: `pnpm --filter skill backtest` (see `src/backtest-run.ts`).

## Honest scope (what this does and doesn't prove)

Two claims, both reproducible - and nothing more:

1. **The sizing posture out-survives the standard baselines** under a burn rate and a
   drawdown cap, across many seeded market paths. This is measured, not asserted:
   re-run the backtest with the committed seed and you get the same survival curves.
2. **The edge/volatility inputs are derived from CoinMarketCap Agent Hub signals**, not
   guessed - see the inputs table above.

What we explicitly do **not** claim: a magic crypto alpha, or that any single live week
will rank well. Survival-optimal sizing improves the *distribution* of outcomes (fewer
ruinous drawdowns, longer time-in-game); it can't manufacture edge that isn't in the
signal. The backtest uses synthetic Monte-Carlo paths for a controlled, reproducible
comparison - a real-historical path provider can drop in without touching the strategy.

## How it scores Track 2's four criteria

| Criterion | How this skill answers it |
| --- | --- |
| **Technical execution** | A real, tested sizing engine (`decideSizing`) + a seeded Monte-Carlo survival backtest vs Kelly and fixed-fraction baselines - reproducible, not a slideshow. |
| **Creativity / originality** | Sizes for *solvency*, not return: a skip-rule on edge-vs-friction and a drawdown-capped, desperation-aware size. Most sizing skills optimise growth and ignore that the agent can be evicted or DQ'd. |
| **Application value** | Directly usable by any solvency-constrained agent (the Track-1 brief, but general). Our own live agent calls this exact skill to size real BSC trades - it's dogfooded, not theoretical. |
| **Live demo** | `pnpm --filter skill backtest` prints the survival curves on the spot; the live agent's feed shows the same skill making real size/skip calls with human-legible reasons. |

> **Special prize targeted:** *Best Use of CoinMarketCap Data & Signal* - the edge and
> volatility this skill sizes on are derived from Agent Hub technical-analysis, market-regime,
> and trending signals (see inputs table), so the sizing decision is grounded in CMC data end to end.

## Output contract

```jsonc
{
  "decision": "trade",            // or "skip"
  "sizeUsd": 7.5,                  // USD to deploy (0 when skipping)
  "roundTripFrictionFraction": 0.0123,
  "reason": "Trading $7.50: 2.10% edge clears 1.23% friction with margin."
}
```

The `reason` is always human-legible - it states the edge, the friction it had to
clear, and which rule (skip / drawdown cap / desperation / DQ-voided) drove the call.
