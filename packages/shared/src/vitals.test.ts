import { describe, expect, it } from 'vitest';

import type { AgentState, Transaction } from './ledger.ts';
import { computeVitals } from './vitals.ts';

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
const state: AgentState = { agent_id: 'agent-0', born_at: bornAt, died_at: null, status: 'alive' };
// 24h after birth
const now = Date.parse('2026-06-23T00:00:00Z');

describe('computeVitals', () => {
  it('derives balance, seed, P&L, peak, burn, runway, and survival', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
      tx({ kind: 'rent', amount: -1.68, reason: 'rent', ts: '2026-06-22T12:00:00Z' }), // 24h burn proxy
      tx({ kind: 'expense', amount: -0.12, reason: 'data_call', ts: '2026-06-22T12:00:00Z' }),
      tx({ kind: 'expense', amount: -12, reason: 'trade_open', ts: '2026-06-22T13:00:00Z' }),
      tx({ kind: 'income', amount: 13.5, reason: 'trade_close', ts: '2026-06-22T18:00:00Z' }),
    ];
    const v = computeVitals(transactions, state, now);

    expect(v.balanceUsd).toBeCloseTo(19.7, 6);
    expect(v.seedUsd).toBe(20);
    expect(v.netPnlUsd).toBeCloseTo(-0.3, 6);
    expect(v.peakUsd).toBe(20); // never got above the seed — close only recovered to 19.7
    expect(v.tradeCount).toBe(1);
    expect(v.daysSurvived).toBeCloseTo(1, 6);
    // burn = (rent 1.68 + data 0.12) over 24h = 1.8/24 = 0.075/h → runway = 19.7/0.075
    expect(v.burnPerHourUsd).toBeCloseTo(0.075, 6);
    expect(v.runwayHours).toBeCloseTo(262.67, 1);
    expect(v.alive).toBe(true);
    expect(v.series).toHaveLength(5);
  });

  it('reports dead when status is dead, freezing days-survived at died_at', () => {
    const dead: AgentState = {
      agent_id: 'agent-0',
      born_at: bornAt,
      died_at: '2026-06-25T00:00:00Z',
      status: 'dead',
    };
    const v = computeVitals(
      [tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt })],
      dead,
      now,
    );
    expect(v.alive).toBe(false);
    expect(v.daysSurvived).toBeCloseTo(3, 6);
  });
});
