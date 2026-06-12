import { describe, expect, it } from 'vitest';

import { survivalDesperation, survivalTier } from './survival.ts';

describe('survivalTier', () => {
  it('maps net-worth fraction of seed to the three life stages', () => {
    expect(survivalTier(5, 5)).toBe('stable'); // 100%
    expect(survivalTier(3, 5)).toBe('stable'); // 60% — boundary
    expect(survivalTier(2.5, 5)).toBe('strained'); // 50%
    expect(survivalTier(1.5, 5)).toBe('strained'); // 30% — boundary
    expect(survivalTier(1, 5)).toBe('final-notice'); // 20%
    expect(survivalTier(0, 5)).toBe('final-notice');
  });

  it('treats a non-positive seed as final-notice', () => {
    expect(survivalTier(5, 0)).toBe('final-notice');
  });
});

describe('survivalDesperation', () => {
  it('is 0 while comfortable and ramps to 1 at the brink', () => {
    expect(survivalDesperation(5, 5)).toBe(0); // 100%
    expect(survivalDesperation(3, 5)).toBe(0); // 60% — still calm
    expect(survivalDesperation(0, 5)).toBe(1); // broke
  });

  it('rises monotonically as net worth falls', () => {
    const half = survivalDesperation(2.5, 5); // 50%
    const finalNotice = survivalDesperation(1.5, 5); // 30%
    expect(half).toBeGreaterThan(0);
    expect(finalNotice).toBeGreaterThan(half);
    expect(finalNotice).toBeCloseTo(0.5, 5); // (0.6 - 0.3) / 0.6
  });

  it('clamps to [0, 1]', () => {
    expect(survivalDesperation(10, 5)).toBe(0); // above seed
    expect(survivalDesperation(-1, 5)).toBe(1); // underwater
  });
});
