import { describe, expect, it } from 'vitest';

import type { AgentState, Snapshot, Transaction } from './ledger.ts';
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
  it('derives cash, net worth, P&L, peak, burn, runway, and survival', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
      tx({ kind: 'rent', amount: -1.68, reason: 'rent', ts: '2026-06-22T12:00:00Z' }), // 24h burn proxy
      tx({ kind: 'expense', amount: -0.12, reason: 'data_call', ts: '2026-06-22T12:00:00Z' }),
      tx({ kind: 'expense', amount: -12, reason: 'trade_open', ts: '2026-06-22T13:00:00Z' }),
      tx({ kind: 'income', amount: 13.5, reason: 'trade_close', ts: '2026-06-22T18:00:00Z' }),
    ];
    const v = computeVitals(transactions, state, now);

    // No snapshots → net worth degrades gracefully to cash.
    expect(v.cashUsd).toBeCloseTo(19.7, 6);
    expect(v.netWorthUsd).toBeCloseTo(19.7, 6);
    expect(v.positionValueUsd).toBe(0);
    expect(v.seedUsd).toBe(20);
    expect(v.netPnlUsd).toBeCloseTo(-0.3, 6);
    expect(v.peakUsd).toBe(20); // never got above the seed — close only recovered to 19.7
    expect(v.tradeCount).toBe(1);
    expect(v.daysSurvived).toBeCloseTo(1, 6);
    // burn = (rent 1.68 + data 0.12) over 24h = 1.8/24 = 0.075/h → runway = 19.7/0.075
    expect(v.burnPerHourUsd).toBeCloseTo(0.075, 6);
    expect(v.netWorthRunwayHours).toBeCloseTo(262.67, 1);
    expect(v.cashRunwayHours).toBeCloseTo(262.67, 1);
    expect(v.alive).toBe(true);
    expect(v.series).toHaveLength(5);
  });

  it('marks net worth from the latest snapshot (cash + open positions)', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
      tx({ kind: 'expense', amount: -12, reason: 'trade_open', ts: '2026-06-22T13:00:00Z' }),
    ];
    const snap = (id: number, ts: string, net: number, pos: number): Snapshot => ({
      id,
      agent_id: 'agent-0',
      ts,
      cash_usd: 8,
      position_value_usd: pos,
      net_worth_usd: net,
      positions: [{ token: 'AAVE', sizeUsd: 12, entryPx: 60, markPx: 65, valueUsd: pos }],
    });
    const snapshots: Snapshot[] = [
      snap(1, '2026-06-22T13:00:00Z', 20, 12),
      snap(2, '2026-06-22T18:00:00Z', 21, 13),
    ];
    const v = computeVitals(transactions, state, now, snapshots);

    expect(v.cashUsd).toBeCloseTo(8, 6); // liquidity from the ledger
    expect(v.positionValueUsd).toBe(13); // latest snapshot's marked position value
    expect(v.netWorthUsd).toBe(21); // cash + positions, from the snapshot
    expect(v.netPnlUsd).toBe(1); // net worth − seed
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0]?.token).toBe('AAVE');
    expect(v.series).toHaveLength(2); // net-worth series comes from snapshots
    expect(v.series.at(-1)?.balanceUsd).toBe(21);
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
