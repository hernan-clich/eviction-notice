import { describe, expect, it } from 'vitest';

import { ELIGIBLE_TOKENS, LIQUID_TOKENS, isEligibleToken } from './eligible-tokens.ts';

describe('isEligibleToken', () => {
  it('accepts eligible tokens, case-insensitively', () => {
    expect(isEligibleToken('CAKE')).toBe(true);
    expect(isEligibleToken('cake')).toBe(true);
    expect(isEligibleToken('TWT')).toBe(true);
  });

  it('rejects tokens outside the universe — including native BNB', () => {
    expect(isEligibleToken('BNB')).toBe(false);
    expect(isEligibleToken('NOTACOIN')).toBe(false);
  });
});

describe('the universe', () => {
  it('has a substantial token list', () => {
    expect(ELIGIBLE_TOKENS.length).toBeGreaterThan(140);
  });

  it('only steers toward liquid tokens that are themselves eligible', () => {
    for (const token of LIQUID_TOKENS) {
      expect(isEligibleToken(token)).toBe(true);
    }
  });
});
