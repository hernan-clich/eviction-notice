import { z } from 'zod';

/**
 * Solvency-Aware Sizing — the Track 2 skill.
 *
 * Almost all position sizing (Kelly and friends) is *return*-optimal. This is
 * *survival*-optimal: given a balance, a burn rate, and a candidate trade, size
 * to maximise how long the agent stays alive, not expected return. Two ideas:
 *
 *   1. Skip-rule — only trade when the expected edge beats round-trip friction
 *      (gas + fees + slippage) by a margin. Gas is a *fixed* cost per swap, so
 *      friction% falls as size grows; we evaluate it at the largest survival-safe
 *      size to give the edge its best chance, then skip if it still can't clear.
 *   2. Drawdown-capped sizing — never risk so much that a volatility-sized loss
 *      could breach the max-drawdown DQ gate; never go all-in.
 *
 * The exact sizing curve is intentionally simple here; #11's survival-curve
 * backtest tunes it against fixed-fraction and Kelly baselines.
 */

export const sizingInputSchema = z.object({
  /** Current ledger balance (USD). */
  balanceUsd: z.number().positive(),
  /** Peak balance to date (USD) — drawdown is measured peak-to-trough. */
  peakBalanceUsd: z.number().positive(),
  /** Cost of being alive (USD/hour) — rent + expected data burn. */
  burnRatePerHourUsd: z.number().nonnegative(),
  /** Expected fractional return on the position (e.g. 0.02 = +2%). */
  edge: z.number(),
  /** Fractional downside risk of the position over the hold (e.g. 0.05 = 5%). */
  volatility: z.number().positive(),
  /** Live gas cost of a single swap (USD). */
  gasPerSwapUsd: z.number().nonnegative(),
  /** Swap fee per side (PancakeSwap V2 = 0.25%). */
  swapFeeRate: z.number().nonnegative().default(0.0025),
  /** Expected slippage over the round trip (fractional). */
  slippage: z.number().nonnegative().default(0.001),
  /** Max-drawdown DQ gate (fractional, e.g. 0.30). */
  maxDrawdownFraction: z.number().positive().max(1).default(0.3),
  /** Never deploy more than this fraction of balance in one position. */
  maxPositionFraction: z.number().positive().max(1).default(0.75),
  /** Smallest viable position (gas makes anything smaller pure friction). */
  minPositionUsd: z.number().positive().default(5),
  /** Required margin of edge over friction before trading (fractional). */
  edgeMargin: z.number().nonnegative().default(0.005),
  /** Daily-floor override: force the least-harmful qualifying trade (≥1 trade/day rule). */
  mustTrade: z.boolean().default(false),
});

export type SizingInput = z.input<typeof sizingInputSchema>;

export interface SizingDecision {
  decision: 'trade' | 'skip';
  sizeUsd: number;
  roundTripFrictionFraction: number;
  reason: string;
}

interface FrictionParams {
  gasPerSwapUsd: number;
  swapFeeRate: number;
  slippage: number;
}

/** Round-trip friction as a fraction of position size. Gas is fixed per swap, so
 *  it dominates at small size; fees + slippage are proportional. */
export function roundTripFrictionFraction(sizeUsd: number, params: FrictionParams): number {
  return (2 * params.gasPerSwapUsd) / sizeUsd + 2 * params.swapFeeRate + params.slippage;
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`;
const usd = (value: number): string => `$${value.toFixed(2)}`;
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function decideSizing(input: SizingInput): SizingDecision {
  const cfg = sizingInputSchema.parse(input);
  const frictionParams: FrictionParams = {
    gasPerSwapUsd: cfg.gasPerSwapUsd,
    swapFeeRate: cfg.swapFeeRate,
    slippage: cfg.slippage,
  };

  // How much we can lose before breaching the drawdown DQ gate.
  const floorBalanceUsd = cfg.peakBalanceUsd * (1 - cfg.maxDrawdownFraction);
  const allowedLossUsd = cfg.balanceUsd - floorBalanceUsd;

  if (allowedLossUsd <= 0) {
    return {
      decision: 'skip',
      sizeUsd: 0,
      roundTripFrictionFraction: roundTripFrictionFraction(cfg.minPositionUsd, frictionParams),
      reason: `At the ${pct(cfg.maxDrawdownFraction)} drawdown cap — skipping to avoid disqualification.`,
    };
  }

  // Largest survival-safe size: a volatility-sized loss stays within the drawdown
  // budget, and never more than maxPositionFraction of balance.
  const drawdownCappedSize = allowedLossUsd / cfg.volatility;
  const balanceCappedSize = cfg.balanceUsd * cfg.maxPositionFraction;
  const size = Math.min(drawdownCappedSize, balanceCappedSize);

  // Not enough risk budget for a viable (>= min) position.
  if (size < cfg.minPositionUsd) {
    const friction = roundTripFrictionFraction(cfg.minPositionUsd, frictionParams);
    if (cfg.mustTrade && cfg.balanceUsd >= cfg.minPositionUsd) {
      return {
        decision: 'trade',
        sizeUsd: cfg.minPositionUsd,
        roundTripFrictionFraction: friction,
        reason: `Mandatory daily trade at the ${usd(cfg.minPositionUsd)} floor; risk budget is tight.`,
      };
    }
    return {
      decision: 'skip',
      sizeUsd: 0,
      roundTripFrictionFraction: friction,
      reason: `Risk budget too small for a viable (>= ${usd(cfg.minPositionUsd)}) position.`,
    };
  }

  const friction = roundTripFrictionFraction(size, frictionParams);

  // Skip-rule: edge must clear friction by the margin.
  if (cfg.edge < friction + cfg.edgeMargin) {
    if (cfg.mustTrade) {
      return {
        decision: 'trade',
        sizeUsd: round2(size),
        roundTripFrictionFraction: friction,
        reason: `Mandatory daily trade: ${pct(cfg.edge)} edge under-clears ${pct(friction)} friction; sizing for least harm.`,
      };
    }
    return {
      decision: 'skip',
      sizeUsd: 0,
      roundTripFrictionFraction: friction,
      reason: `Skipping: ${pct(cfg.edge)} edge doesn't beat ${pct(friction)} round-trip friction (+${pct(cfg.edgeMargin)} margin).`,
    };
  }

  return {
    decision: 'trade',
    sizeUsd: round2(size),
    roundTripFrictionFraction: friction,
    reason: `Trading ${usd(round2(size))}: ${pct(cfg.edge)} edge clears ${pct(friction)} friction with margin.`,
  };
}
