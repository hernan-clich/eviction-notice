import { describe, expect, it } from 'vitest';

import { makePath, runBacktest, simulateAgent, STRATEGIES, type SimConfig } from './backtest.ts';

const config: Omit<SimConfig, 'hoursPerTick'> = {
  seedUsd: 20,
  rentPerHourUsd: 0.07,
  gasPerSwapUsd: 0.15,
  swapFeeRate: 0.0025,
  slippage: 0.001,
  maxDrawdownFraction: 0.3,
};

const backtestArgs = {
  seed: 42,
  agents: 300,
  days: 7,
  ticksPerDay: 24,
  config,
  pathVolatility: 0.04,
  driftMean: 0.008,
  driftSpread: 0.02,
};

describe('simulateAgent', () => {
  const fullConfig: SimConfig = { ...config, hoursPerTick: 1 };

  it('a flat, no-edge market with no trading dies only of rent (survives the week idle)', () => {
    // never trade → balance drains by rent only; 7×24×0.07 = $11.76 < $20 seed
    const path = Array.from({ length: 168 }, () => ({
      edge: 0,
      volatility: 0.04,
      realizedReturn: 0,
    }));
    const result = simulateAgent(path, () => 0, fullConfig);
    expect(result.died).toBe(false);
  });

  it('an all-in agent in a volatile market eventually hits the drawdown cap', () => {
    const path = Array.from({ length: 168 }, () => ({
      edge: 0.05,
      volatility: 0.1,
      realizedReturn: -0.2, // relentless losses
    }));
    const result = simulateAgent(path, ({ balanceUsd }) => balanceUsd, fullConfig);
    expect(result.died).toBe(true);
  });
});

const constantRng = () => 0.5;

describe('makePath', () => {
  it('is deterministic for a given rng', () => {
    const params = { ticks: 3, volatility: 0.04, driftMean: 0.01, driftSpread: 0.02 };
    expect(makePath(constantRng, params)).toEqual(makePath(constantRng, params));
  });
});

describe('runBacktest', () => {
  const result = runBacktest(backtestArgs);

  it('covers every strategy with a non-increasing survival curve', () => {
    for (const name of Object.keys(STRATEGIES)) {
      const curve = result.byStrategy[name]?.survivalByDay ?? [];
      expect(curve).toHaveLength(7);
      for (let day = 1; day < curve.length; day += 1) {
        expect(curve[day]).toBeLessThanOrEqual(curve[day - 1] ?? 1);
      }
    }
  });

  it('the survival-optimal skill outlives Kelly and fixed-fraction', () => {
    const ours = result.byStrategy['solvency-aware']?.survivedWindow ?? 0;
    const kelly = result.byStrategy['kelly']?.survivedWindow ?? 1;
    const fixed = result.byStrategy['fixed-fraction']?.survivedWindow ?? 1;
    expect(ours).toBeGreaterThan(kelly);
    expect(ours).toBeGreaterThan(fixed);
  });
});
