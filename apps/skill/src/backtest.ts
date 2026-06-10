import { decideSizing } from './sizing.ts';

/**
 * Survival-curve backtest (Track 2). Runs a population of agents — identical
 * seed + burn, different sizing brains — over Monte Carlo market paths and asks
 * the only question that matters: how many are still alive at day N?
 *
 * Paths are synthetic (seeded GBM-ish) so the comparison is controlled and
 * reproducible; a real-historical path provider can drop in later. The point is
 * relative survival across sizing strategies under a burn rate — where the
 * survival-optimal skill should outlive return-optimal Kelly and naive
 * fixed-fraction sizing.
 */

export interface MarketTick {
  /** The strategy's expected fractional return for the candidate trade. */
  edge: number;
  /** Fractional downside risk over the hold. */
  volatility: number;
  /** The return actually realised if the trade is taken. */
  realizedReturn: number;
}

export interface SimConfig {
  seedUsd: number;
  rentPerHourUsd: number;
  hoursPerTick: number;
  gasPerSwapUsd: number;
  swapFeeRate: number;
  slippage: number;
  maxDrawdownFraction: number;
}

export interface SizingArgs {
  balanceUsd: number;
  peakUsd: number;
  tick: MarketTick;
  config: SimConfig;
}

/** A sizing brain: given state + a candidate trade, returns the USD to deploy (0 = skip). */
export type SizingStrategy = (args: SizingArgs) => number;

/** Round-trip friction (two swaps): fixed gas dominates at small size. */
function roundTripFrictionUsd(sizeUsd: number, config: SimConfig): number {
  return 2 * config.gasPerSwapUsd + sizeUsd * (2 * config.swapFeeRate + config.slippage);
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);

export const STRATEGIES: Record<string, SizingStrategy> = {
  // The skill under test: survival-optimal, with a skip-rule and drawdown cap.
  'solvency-aware': ({ balanceUsd, peakUsd, tick, config }) => {
    const decision = decideSizing({
      balanceUsd,
      peakBalanceUsd: peakUsd,
      burnRatePerHourUsd: config.rentPerHourUsd,
      edge: tick.edge,
      volatility: tick.volatility,
      gasPerSwapUsd: config.gasPerSwapUsd,
      swapFeeRate: config.swapFeeRate,
      slippage: config.slippage,
      maxDrawdownFraction: config.maxDrawdownFraction,
    });
    return decision.decision === 'trade' ? decision.sizeUsd : 0;
  },
  // Return-optimal Kelly fraction (edge / variance), capped — no survival guard.
  kelly: ({ balanceUsd, tick }) => {
    const fraction = clamp(tick.edge / (tick.volatility * tick.volatility), 0, 1);
    return fraction * balanceUsd;
  },
  // Naive: always deploy half the balance, regardless of edge or friction.
  'fixed-fraction': ({ balanceUsd }) => 0.5 * balanceUsd,
};

/** Run one agent over one path with one strategy. Returns ticks survived + whether it died. */
export function simulateAgent(
  path: readonly MarketTick[],
  strategy: SizingStrategy,
  config: SimConfig,
): { ticksSurvived: number; died: boolean } {
  let balanceUsd = config.seedUsd;
  let peakBalanceUsd = balanceUsd;
  // Drawdown is measured on *trading* equity (balance + rent already paid), so
  // the rent metabolism alone never triggers the DQ — only trading losses do.
  let cumulativeRentUsd = 0;
  let peakEquityUsd = balanceUsd;
  const rentPerTick = config.rentPerHourUsd * config.hoursPerTick;

  for (const [index, tick] of path.entries()) {
    balanceUsd -= rentPerTick;
    cumulativeRentUsd += rentPerTick;
    if (balanceUsd <= 0) {
      return { ticksSurvived: index + 1, died: true }; // evicted
    }

    const sizeUsd = Math.min(
      strategy({ balanceUsd, peakUsd: peakBalanceUsd, tick, config }),
      balanceUsd,
    );
    if (sizeUsd > 0) {
      balanceUsd += sizeUsd * tick.realizedReturn - roundTripFrictionUsd(sizeUsd, config);
    }
    if (balanceUsd <= 0) {
      return { ticksSurvived: index + 1, died: true }; // evicted
    }

    peakBalanceUsd = Math.max(peakBalanceUsd, balanceUsd);
    const tradingEquityUsd = balanceUsd + cumulativeRentUsd;
    peakEquityUsd = Math.max(peakEquityUsd, tradingEquityUsd);
    const tradingDrawdown = (peakEquityUsd - tradingEquityUsd) / peakEquityUsd;
    if (tradingDrawdown > config.maxDrawdownFraction) {
      return { ticksSurvived: index + 1, died: true }; // drawdown DQ
    }
  }
  return { ticksSurvived: path.length, died: false };
}

// --- seeded RNG + market paths -------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // `| 0` is an intentional int32 wrap for the PRNG, not truncation.
    // eslint-disable-next-line unicorn/prefer-math-trunc
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function standardNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface PathParams {
  ticks: number;
  volatility: number;
  /** Mean and spread of the per-tick true expected return (the tradeable edge). */
  driftMean: number;
  driftSpread: number;
}

/** Generate one market path. Edge = the (perfect-signal) expected return; realized = edge + vol·z. */
export function makePath(rng: () => number, params: PathParams): MarketTick[] {
  const path: MarketTick[] = [];
  for (let index = 0; index < params.ticks; index += 1) {
    const edge = params.driftMean + params.driftSpread * standardNormal(rng);
    const realizedReturn = edge + params.volatility * standardNormal(rng);
    path.push({ edge, volatility: params.volatility, realizedReturn });
  }
  return path;
}

// --- population backtest --------------------------------------------------------

export interface StrategyResult {
  /** Fraction of the population still alive at the end of day d (index 0 = day 1). */
  survivalByDay: number[];
  survivedWindow: number;
  medianSurvivalDays: number;
}

export interface BacktestResult {
  days: number;
  agents: number;
  byStrategy: Record<string, StrategyResult>;
}

export function runBacktest(args: {
  seed: number;
  agents: number;
  days: number;
  ticksPerDay: number;
  config: Omit<SimConfig, 'hoursPerTick'>;
  pathVolatility: number;
  driftMean: number;
  driftSpread: number;
}): BacktestResult {
  const ticks = args.days * args.ticksPerDay;
  const hoursPerTick = 24 / args.ticksPerDay;
  const config: SimConfig = { ...args.config, hoursPerTick };
  const names = Object.keys(STRATEGIES);
  const survivalTicks: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));

  const rng = mulberry32(args.seed);
  for (let agent = 0; agent < args.agents; agent += 1) {
    // Same path for every strategy this agent — differences are sizing, not luck.
    const path = makePath(rng, {
      ticks,
      volatility: args.pathVolatility,
      driftMean: args.driftMean,
      driftSpread: args.driftSpread,
    });
    for (const name of names) {
      const strategy = STRATEGIES[name];
      if (!strategy) continue;
      survivalTicks[name]?.push(simulateAgent(path, strategy, config).ticksSurvived);
    }
  }

  const byStrategy: Record<string, StrategyResult> = {};
  for (const name of names) {
    const survived = survivalTicks[name] ?? [];
    const survivalByDay: number[] = [];
    for (let day = 1; day <= args.days; day += 1) {
      const ticksForDay = day * args.ticksPerDay;
      const aliveAtDayEnd = survived.filter((t) => t >= ticksForDay).length;
      survivalByDay.push(aliveAtDayEnd / args.agents);
    }
    const survivedWindow = survived.filter((t) => t >= ticks).length / args.agents;
    const sorted = [...survived].sort((a, b) => a - b);
    const medianTicks = sorted[Math.floor(sorted.length / 2)] ?? 0;
    byStrategy[name] = {
      survivalByDay,
      survivedWindow,
      medianSurvivalDays: medianTicks / args.ticksPerDay,
    };
  }

  return { days: args.days, agents: args.agents, byStrategy };
}
