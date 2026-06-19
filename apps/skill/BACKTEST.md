# Backtesting Solvency-Aware Sizing

This skill ships a **real, reproducible** backtest, not a single illustrative
trade and not synthetic candles engineered to reach a target. Run it yourself:

```bash
pnpm --filter skill backtest
```

## What the backtest does

`src/backtest.ts` runs a **population of agents** (identical seed capital and
burn rate, different sizing brains) over seeded Monte-Carlo market paths, and
measures the only outcome that matters for a solvency-constrained agent: **how
many are still solvent at the end of day N.**

- **Same path per agent for every strategy**, so differences are *sizing*, not luck.
- **No lookahead**: each tick sizes on the state available at that tick.
- Drawdown is measured on **trading equity** (rent added back), so the fictional
  burn metabolism never trips the DQ on its own; only real trading losses do.
- Seeded PRNG (`mulberry32`) → byte-identical results on every run.

Baselines it is measured against:

- **`kelly`**: return-optimal `edge / variance`, capped. No survival guard.
- **`fixed-fraction`**: naively deploys half the balance every tick.

## Headline result

A 7-day window, 2000 agents, `seed=1`, `$20` seed, `$0.07/h` burn, 30% drawdown DQ
(the defaults in `src/backtest-run.ts`):

```
Survival curves - 2000 agents over 7 days (% still solvent at day end)
strategy            d1    d2    d3    d4    d5    d6    d7
solvency-aware    100%  100%  100%  100%  100%  100%  100%
kelly              93%   67%   42%   28%   19%   13%    8%
fixed-fraction     34%    0%    0%    0%    0%    0%    0%

solvency-aware   ██████████████████████████████ 100% survived the window · median 7.0d
kelly            ███                            8% survived the window · median 2.7d
fixed-fraction                                  0% survived the window · median 0.9d
```

**Read it plainly:** over the full window, every solvency-aware agent survives;
~92% of Kelly agents are wiped out, and fixed-fraction is gone by day 2. The
skip-rule and drawdown cap don't chase the most return; they refuse the trades
and sizes that end the run.

## What it does and doesn't prove

- **Does:** under a burn rate and a hard drawdown cap, sizing for survival
  dominates return-optimal sizing on *staying in the game*: reproducibly, across
  thousands of paths, against standard baselines.
- **Doesn't:** manufacture edge that isn't in the signal. Survival-optimal sizing
  improves the *distribution* of outcomes (fewer ruinous drawdowns, longer
  time-in-game); it can't turn a zero-edge signal into profit.

The paths are synthetic for a controlled, reproducible comparison; a
real-historical path provider can drop in without touching the strategy. Every
number here regenerates from the command above: verify, don't trust.
