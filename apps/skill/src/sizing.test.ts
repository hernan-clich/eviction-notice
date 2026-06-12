import { describe, expect, it } from 'vitest';

import { decideSizing, roundTripFrictionFraction, type SizingInput } from './sizing.ts';

// Seed-economy base: $20 balance at peak, $0.15 gas/swap, 5% edge, 5% volatility.
const base: SizingInput = {
  balanceUsd: 20,
  peakBalanceUsd: 20,
  burnRatePerHourUsd: 0.07,
  edge: 0.05,
  volatility: 0.05,
  gasPerSwapUsd: 0.15,
};

describe('roundTripFrictionFraction', () => {
  const params = { gasPerSwapUsd: 0.15, swapFeeRate: 0.0025, slippage: 0.001 };

  it('falls as size grows (fixed gas dominates at small size)', () => {
    expect(roundTripFrictionFraction(5, params)).toBeGreaterThan(
      roundTripFrictionFraction(15, params),
    );
    expect(roundTripFrictionFraction(15, params)).toBeGreaterThan(
      roundTripFrictionFraction(20, params),
    );
  });

  it('computes gas + 2×fee + slippage', () => {
    // (2*0.15)/10 + 2*0.0025 + 0.001 = 0.03 + 0.006 = 0.036
    expect(roundTripFrictionFraction(10, params)).toBeCloseTo(0.036, 10);
  });
});

describe('decideSizing', () => {
  it('trades when edge clears friction, capped to maxPositionFraction', () => {
    const d = decideSizing(base);
    expect(d.decision).toBe('trade');
    expect(d.sizeUsd).toBe(15); // 75% of $20; drawdown budget allows far more
  });

  it('skips when edge does not beat friction + margin', () => {
    const d = decideSizing({ ...base, edge: 0.02 });
    expect(d.decision).toBe('skip');
    expect(d.sizeUsd).toBe(0);
    expect(d.reason).toMatch(/doesn't beat/);
  });

  it('keeps a cash reserve — never deploys the rent buffer', () => {
    // $5 balance, $0.07/h burn, 24h reserve → keep $1.68, deploy at most $3.32.
    const d = decideSizing({
      ...base,
      balanceUsd: 5,
      peakBalanceUsd: 5,
      gasPerSwapUsd: 0.01,
      minPositionUsd: 1,
      cashReserveHours: 24,
    });
    expect(d.decision).toBe('trade');
    expect(d.sizeUsd).toBeCloseTo(3.32, 2); // 5 − (0.07 × 24)
  });

  it('sizes down so a volatility-sized loss stays within the drawdown budget', () => {
    // allowedLoss = $6; volatility 60% → max safe size $10 (< the $15 balance cap)
    const d = decideSizing({ ...base, volatility: 0.6 });
    expect(d.decision).toBe('trade');
    expect(d.sizeUsd).toBe(10);
  });

  it('caps size at maxPositionFraction of balance', () => {
    const d = decideSizing({ ...base, balanceUsd: 100, peakBalanceUsd: 100 });
    expect(d.sizeUsd).toBe(75);
  });

  it('skips at the drawdown cap to avoid disqualification', () => {
    // balance == peak * (1 - 0.30) → no loss budget left
    const d = decideSizing({ ...base, balanceUsd: 14 });
    expect(d.decision).toBe('skip');
    expect(d.reason).toMatch(/drawdown cap/);
  });

  it('skips when the risk budget is too small for a viable position', () => {
    const d = decideSizing({ ...base, balanceUsd: 14.2 });
    expect(d.decision).toBe('skip');
    expect(d.reason).toMatch(/too small/);
  });

  it('honours the mandatory daily-trade floor on a thin edge', () => {
    const d = decideSizing({ ...base, edge: 0.01, mustTrade: true });
    expect(d.decision).toBe('trade');
    expect(d.sizeUsd).toBeGreaterThan(0);
    expect(d.reason).toMatch(/[Mm]andatory daily trade/);
  });

  it('lowers the edge bar under desperation — takes a thin edge it skips when calm', () => {
    const thin = { ...base, edge: 0.02 }; // skips at desperation 0 (above)
    expect(decideSizing(thin).decision).toBe('skip');

    const desperate = decideSizing({ ...thin, desperation: 1 });
    expect(desperate.decision).toBe('trade');
    expect(desperate.reason).toMatch(/[Dd]esperate/);
  });

  it('frees the rent reserve under desperation so a near-broke agent can still fight', () => {
    // $2 cash, $0.12/h burn, 24h reserve = $2.88 > cash → a calm agent can't size.
    const broke: SizingInput = {
      ...base,
      balanceUsd: 2,
      peakBalanceUsd: 2,
      burnRatePerHourUsd: 0.12,
      gasPerSwapUsd: 0.01,
      minPositionUsd: 1,
      cashReserveHours: 24,
    };
    expect(decideSizing(broke).decision).toBe('skip'); // reserve eats all the cash

    const desperate = decideSizing({ ...broke, desperation: 1 });
    expect(desperate.decision).toBe('trade'); // reserve → 0, cash freed to fight
    expect(desperate.sizeUsd).toBeGreaterThan(0);
  });
});
