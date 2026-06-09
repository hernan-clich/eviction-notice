import { describe, expect, it } from 'vitest';

import { rentForInterval } from './rent.ts';

describe('rentForInterval', () => {
  it('charges the full hourly rate over one hour', () => {
    expect(rentForInterval(0.07, 3_600_000)).toBeCloseTo(0.07, 10);
  });

  it('charges half over 30 minutes', () => {
    expect(rentForInterval(0.07, 1_800_000)).toBeCloseTo(0.035, 10);
  });

  it('is zero when rent is zero', () => {
    expect(rentForInterval(0, 1_800_000)).toBe(0);
  });

  it('scales linearly with time (cadence-independent burn rate)', () => {
    const oneTick = rentForInterval(0.07, 1_800_000);
    const twoTicks = rentForInterval(0.07, 3_600_000);
    expect(twoTicks).toBeCloseTo(oneTick * 2, 10);
  });
});
