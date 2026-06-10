import { describe, expect, it } from 'vitest';

import { closeProceedsUsd, swapFrictionUsd } from './paper-trade.ts';

const params = { gasPerSwapUsd: 0.15, swapFeeRate: 0.0025, slippage: 0.001 };

describe('swapFrictionUsd', () => {
  it('is fixed gas + proportional fee + slippage', () => {
    // 0.15 + 12 * (0.0025 + 0.001) = 0.15 + 0.042 = 0.192
    expect(swapFrictionUsd(12, params)).toBeCloseTo(0.192, 10);
  });

  it('grows with size but gas dominates the small end', () => {
    expect(swapFrictionUsd(5, params)).toBeLessThan(swapFrictionUsd(20, params));
  });
});

describe('closeProceedsUsd', () => {
  it('returns a profit above entry, net of closing friction', () => {
    // 12 * (110/100) - 0.192 = 13.2 - 0.192
    expect(closeProceedsUsd(12, 100, 110, params)).toBeCloseTo(13.008, 10);
  });

  it('returns less than the stake on a loss', () => {
    // 12 * (90/100) - 0.192 = 10.8 - 0.192
    expect(closeProceedsUsd(12, 100, 90, params)).toBeCloseTo(10.608, 10);
  });

  it('loses the friction even on a flat round trip', () => {
    expect(closeProceedsUsd(12, 100, 100, params)).toBeCloseTo(11.808, 10);
  });
});
