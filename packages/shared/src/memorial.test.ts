import { describe, expect, it } from 'vitest';

import type { AgentState, Transaction } from './ledger.ts';
import { computeMemorial, memorialEulogy } from './memorial.ts';

let nextId = 1;
function tx(
  partial: Partial<Transaction> & Pick<Transaction, 'kind' | 'amount' | 'reason'>,
): Transaction {
  return {
    id: nextId++,
    agent_id: 'agent-0',
    ts: partial.ts ?? '2026-06-22T00:00:00Z',
    reasoning: null,
    meta: null,
    ...partial,
  };
}

const bornAt = '2026-06-22T00:00:00Z';
const diedAt = '2026-06-27T14:00:00Z'; // 5d 14h later
const state: AgentState = {
  agent_id: 'agent-0',
  born_at: bornAt,
  died_at: diedAt,
  status: 'dead',
};

describe('computeMemorial', () => {
  it('derives lifespan, sums, win/loss split, and last words from the ledger', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
      tx({ kind: 'rent', amount: -3.4, reason: 'rent' }),
      tx({ kind: 'expense', amount: -0.6, reason: 'data_call' }),
      tx({ kind: 'expense', amount: -0.2, reason: 'x402_fee' }),
      tx({ kind: 'income', amount: 1, reason: 'trade_close', meta: { netPnlUsd: 0.5 } }),
      tx({ kind: 'income', amount: 1, reason: 'trade_close', meta: { netPnlUsd: -0.3 } }),
      tx({
        kind: 'expense',
        amount: 0,
        reason: 'decision',
        reasoning: "I'll preserve what's left and wait for a clearer setup.",
        ts: '2026-06-27T13:55:00Z',
      }),
    ];

    const m = computeMemorial(transactions, state, { peakUsd: 5.12, netWorthUsd: 0 });

    expect(m.seedUsd).toBe(20);
    expect(m.lifespanMs).toBe(Date.parse(diedAt) - Date.parse(bornAt));
    expect(m.peakUsd).toBe(5.12);
    expect(m.finalPnlUsd).toBe(-20);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.trades).toBe(2);
    expect(m.rentPaidUsd).toBeCloseTo(3.4, 6);
    // rent + data + x402 = 3.4 + 0.6 + 0.2
    expect(m.spentToExistUsd).toBeCloseTo(4.2, 6);
    expect(m.lastWords).toBe("I'll preserve what's left and wait for a clearer setup.");
  });

  it('classifies a slow grind with no fatal trade as starved', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 5, reason: 'seed', ts: bornAt }),
      tx({ kind: 'rent', amount: -4, reason: 'rent' }),
      tx({ kind: 'income', amount: 1, reason: 'trade_close', meta: { netPnlUsd: -0.2 } }),
    ];
    const m = computeMemorial(transactions, state, { peakUsd: 5, netWorthUsd: 0 });
    expect(m.causeOfDeath).toBe('starved');
    expect(memorialEulogy(m)).toContain('made rent for 5 days');
  });

  it('classifies one large unrecoverable loss as bled out', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 5, reason: 'seed', ts: bornAt }),
      tx({ kind: 'income', amount: 1, reason: 'trade_close', meta: { netPnlUsd: -3 } }),
    ];
    const m = computeMemorial(transactions, state, { peakUsd: 5, netWorthUsd: 0 });
    expect(m.causeOfDeath).toBe('bled out');
  });

  it('classifies liquidation losses exceeding cost of living as strangled', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 5, reason: 'seed', ts: bornAt }),
      tx({ kind: 'rent', amount: -0.5, reason: 'rent' }),
      tx({ kind: 'income', amount: 1, reason: 'trade_close', meta: { netPnlUsd: -0.8 } }),
      tx({ kind: 'income', amount: 1, reason: 'trade_close', meta: { netPnlUsd: -0.9 } }),
    ];
    const m = computeMemorial(transactions, state, { peakUsd: 5, netWorthUsd: 0 });
    expect(m.causeOfDeath).toBe('strangled');
  });
});
