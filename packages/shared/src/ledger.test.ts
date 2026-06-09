import { describe, expect, it } from 'vitest';

import { computeBalance, isAlive, transactionSchema } from './ledger.ts';

describe('computeBalance', () => {
  it('sums signed amounts', () => {
    // seed +$20, rent -$0.07, gas -$0.15, trade close +$1.50
    expect(
      computeBalance([{ amount: 20 }, { amount: -0.07 }, { amount: -0.15 }, { amount: 1.5 }]),
    ).toBe(21.28);
  });

  it('is free of binary-float drift', () => {
    expect(computeBalance([{ amount: 0.1 }, { amount: 0.2 }, { amount: -0.3 }])).toBe(0);
  });

  it('returns 0 for an empty ledger', () => {
    expect(computeBalance([])).toBe(0);
  });
});

describe('isAlive', () => {
  it('is alive when status is alive and balance is positive', () => {
    expect(isAlive({ status: 'alive', balance: 0.01 })).toBe(true);
  });

  it('is dead at or below a zero balance (eviction)', () => {
    expect(isAlive({ status: 'alive', balance: 0 })).toBe(false);
    expect(isAlive({ status: 'alive', balance: -1 })).toBe(false);
  });

  it('is dead when status is dead regardless of balance', () => {
    expect(isAlive({ status: 'dead', balance: 100 })).toBe(false);
  });
});

describe('transactionSchema', () => {
  it('coerces PostgREST numeric/bigint strings to numbers', () => {
    const row = transactionSchema.parse({
      id: '1',
      agent_id: 'agent-0',
      ts: '2026-06-22T00:00:00Z',
      kind: 'rent',
      amount: '-0.07',
      reason: 'rent',
      reasoning: null,
      meta: null,
    });
    expect(row.id).toBe(1);
    expect(row.amount).toBe(-0.07);
  });
});
