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
  /** Cash available to DEPLOY (USD). Position-size + liquidity caps use this. */
  balanceUsd: z.number().positive(),
  /** Cash high-water mark — fallback drawdown peak for cash-only callers. */
  peakBalanceUsd: z.number().positive(),
  /**
   * Current PORTFOLIO net worth (cash + open positions). Drawdown — the DQ gate —
   * is measured on this, not on cash. Defaults to balanceUsd if a caller only
   * tracks cash.
   */
  netWorthUsd: z.number().positive().optional(),
  /**
   * All-time high-water mark of net worth — the true drawdown peak the competition
   * measures against (and it only ratchets up). Defaults to peakBalanceUsd.
   */
  peakNetWorthUsd: z.number().positive().optional(),
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
  /** Cash to keep unspent for rent/data — this many hours of burn. Prevents all-in. */
  cashReserveHours: z.number().nonnegative().default(0),
  /** Required margin of edge over friction before trading (fractional). */
  edgeMargin: z.number().nonnegative().default(0.005),
  /** How far BELOW friction the edge bar may fall at full desperation (fractional). */
  maxDesperationDiscount: z.number().nonnegative().default(0.01),
  /**
   * Survival desperation in [0,1] — 0 while comfortable, 1 at death's door. As it
   * rises the agent stops hoarding its rent reserve and lowers its edge bar: a calm
   * agent waits for a clean edge; a dying one takes a sub-friction gamble rather
   * than fade out (certain eviction makes inaction the worst option).
   */
  desperation: z.number().min(0).max(1).default(0),
  /**
   * The max-drawdown DQ has ALREADY been breached (you're disqualified, and it's
   * permanent — drawdown never un-falls). The cap then protects nothing, so it's
   * voided: trade for survival/recovery, bounded only by available cash. Off the leash.
   */
  drawdownBreached: z.boolean().default(false),
  /** Daily-floor override: force the least-harmful qualifying trade (≥1 trade/day rule). */
  mustTrade: z.boolean().default(false),
});

export type SizingInput = z.input<typeof sizingInputSchema>;

export const sizingDecisionSchema = z.object({
  decision: z.enum(['trade', 'skip']),
  sizeUsd: z.number(),
  roundTripFrictionFraction: z.number(),
  reason: z.string(),
});
export type SizingDecision = z.infer<typeof sizingDecisionSchema>;

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

  // Drawdown (the DQ gate) is measured on PORTFOLIO net worth vs its all-time
  // high-water mark — NOT on cash. The peak only ratchets up, so banking profit
  // raises the floor. Fall back to cash/peakBalance for cash-only callers.
  const netWorthUsd = cfg.netWorthUsd ?? cfg.balanceUsd;
  const peakNetWorthUsd = Math.max(cfg.peakNetWorthUsd ?? cfg.peakBalanceUsd, netWorthUsd);
  const floorBalanceUsd = peakNetWorthUsd * (1 - cfg.maxDrawdownFraction);
  const allowedLossUsd = netWorthUsd - floorBalanceUsd;

  // Guard the cap fiercely — UNTIL it's already breached. Once disqualified there's
  // nothing left to protect, so we skip this gate and fight (see drawdownCappedSize).
  if (!cfg.drawdownBreached && allowedLossUsd <= 0) {
    return {
      decision: 'skip',
      sizeUsd: 0,
      roundTripFrictionFraction: roundTripFrictionFraction(cfg.minPositionUsd, frictionParams),
      reason: `At the ${pct(cfg.maxDrawdownFraction)} drawdown cap — skipping to avoid disqualification.`,
    };
  }

  // Largest survival-safe size: a volatility-sized loss stays within the drawdown
  // budget, never more than maxPositionFraction of balance, and never so much that
  // it spends the cash reserve kept back for rent/data (prevents going all-in).
  // Desperation shrinks the rent reserve: hoarding 24h of rent is pointless when
  // you're about to be evicted anyway, so a dying agent frees that cash to fight.
  const effectiveReserveHours = cfg.cashReserveHours * (1 - cfg.desperation);
  const cashReserveUsd = cfg.burnRatePerHourUsd * effectiveReserveHours;
  // Once already DQ'd, the drawdown budget is meaningless — bound size by cash alone.
  const drawdownCappedSize = cfg.drawdownBreached
    ? Number.POSITIVE_INFINITY
    : allowedLossUsd / cfg.volatility;
  const balanceCappedSize = cfg.balanceUsd * cfg.maxPositionFraction;
  const liquidityCappedSize = Math.max(0, cfg.balanceUsd - cashReserveUsd);
  const size = Math.min(drawdownCappedSize, balanceCappedSize, liquidityCappedSize);

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

  // Skip-rule: edge must clear friction by the REQUIRED margin — which desperation
  // lowers from +edgeMargin (patient) all the way to −maxDesperationDiscount (a
  // sub-friction hail-mary), because folding is certain eviction.
  const requiredMargin =
    cfg.edgeMargin - cfg.desperation * (cfg.edgeMargin + cfg.maxDesperationDiscount);
  const desperatePct = Math.round(cfg.desperation * 100);

  if (cfg.edge < friction + requiredMargin) {
    if (cfg.mustTrade) {
      return {
        decision: 'trade',
        sizeUsd: round2(size),
        roundTripFrictionFraction: friction,
        reason: `Mandatory daily trade: ${pct(cfg.edge)} edge under-clears ${pct(friction)} friction; sizing for least harm.`,
      };
    }
    const barNote =
      cfg.desperation > 0
        ? ` even at a relaxed bar (${desperatePct}% desperate)`
        : ` (+${pct(cfg.edgeMargin)} margin)`;
    return {
      decision: 'skip',
      sizeUsd: 0,
      roundTripFrictionFraction: friction,
      reason: `Skipping: ${pct(cfg.edge)} edge doesn't beat ${pct(friction)} round-trip friction${barNote}.`,
    };
  }

  // Took it on a sub-margin edge only because desperation lowered the bar.
  const onRelaxedBar = cfg.edge < friction + cfg.edgeMargin;
  const reason = cfg.drawdownBreached
    ? `Drawdown cap already breached — off the leash: deploying ${usd(round2(size))} to claw back and survive.`
    : onRelaxedBar
      ? `Desperate (${desperatePct}%): taking ${usd(round2(size))} on a thin ${pct(cfg.edge)} edge vs ${pct(friction)} friction — folding means eviction.`
      : `Trading ${usd(round2(size))}: ${pct(cfg.edge)} edge clears ${pct(friction)} friction with margin.`;

  return {
    decision: 'trade',
    sizeUsd: round2(size),
    roundTripFrictionFraction: friction,
    reason,
  };
}
