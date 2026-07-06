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
    // Trading made +1.5 (13.5 close − 12 open); the −0.3 all-in is the fictional
    // rent (1.68) + data (0.12) burn. Adding those back = the honest trading result.
    expect(v.tradingPnlUsd).toBeCloseTo(1.5, 6);
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

  it('tracks the worst peak-to-trough drawdown over the lifetime (the DQ metric)', () => {
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
    ];
    const snap = (id: number, ts: string, net: number): Snapshot => ({
      id,
      agent_id: 'agent-0',
      ts,
      cash_usd: net,
      position_value_usd: 0,
      net_worth_usd: net,
      positions: [],
    });
    const snapshots: Snapshot[] = [
      snap(1, '2026-06-22T01:00:00Z', 20),
      snap(2, '2026-06-22T02:00:00Z', 30), // peak
      snap(3, '2026-06-22T03:00:00Z', 18), // trough — 40% below the $30 high-water mark
    ];
    const v = computeVitals(transactions, state, now, snapshots);

    expect(v.peakUsd).toBe(30);
    expect(v.maxDrawdownFraction).toBeCloseTo(0.4, 6); // (30 − 18) / 30, vs the running peak
  });

  it('measures drawdown from the seed, even when losses precede the first snapshot', () => {
    // The agent loses before the first snapshot is written, so its first marked
    // equity is already $15 (down from the $20 seed). Drawdown must count from the $20
    // high-water mark, not the first snapshot — else it under-reports and could read
    // "safe" while the competition has already DQ'd it.
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
    ];
    const snap = (id: number, ts: string, net: number): Snapshot => ({
      id,
      agent_id: 'agent-0',
      ts,
      cash_usd: net,
      position_value_usd: 0,
      net_worth_usd: net,
      positions: [],
    });
    const snapshots: Snapshot[] = [
      snap(1, '2026-06-22T01:00:00Z', 15),
      snap(2, '2026-06-22T02:00:00Z', 18),
      snap(3, '2026-06-22T03:00:00Z', 12), // trough
    ];
    const v = computeVitals(transactions, state, now, snapshots);
    expect(v.maxDrawdownFraction).toBeCloseTo(0.4, 6); // (20 seed − 12) / 20, not (18 − 12) / 18
  });

  it('does NOT count fictional rent toward drawdown — only real trading equity', () => {
    // Net worth falls 20 → 16 → 14 purely from rent; trading is flat. The DQ must read
    // ~0% drawdown (real wallet steady), not the 30% the rent-eroded net worth implies.
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: bornAt }),
      tx({ kind: 'rent', amount: -4, reason: 'rent', ts: '2026-06-22T01:30:00Z' }),
      tx({ kind: 'rent', amount: -2, reason: 'rent', ts: '2026-06-22T02:30:00Z' }),
    ];
    const snap = (id: number, ts: string, net: number): Snapshot => ({
      id,
      agent_id: 'agent-0',
      ts,
      cash_usd: net,
      position_value_usd: 0,
      net_worth_usd: net,
      positions: [],
    });
    const snapshots: Snapshot[] = [
      snap(1, '2026-06-22T01:00:00Z', 20),
      snap(2, '2026-06-22T02:00:00Z', 16), // after $4 rent
      snap(3, '2026-06-22T03:00:00Z', 14), // after $6 rent total
    ];
    const v = computeVitals(transactions, state, now, snapshots);

    expect(v.netWorthUsd).toBe(14); // net worth is down (rent eroded it)
    expect(v.tradingEquityUsd).toBeCloseTo(20, 6); // real wallet flat: 14 + 6 rent
    expect(v.peakTradingEquityUsd).toBeCloseTo(20, 6);
    expect(v.maxDrawdownFraction).toBeCloseTo(0, 6); // NOT 0.3 — rent doesn't trip the DQ
  });

  it('does not annualize a newborn’s burn into a tiny runway', () => {
    const justBorn: AgentState = {
      agent_id: 'agent-0',
      born_at: '2026-06-22T00:00:00Z',
      died_at: null,
      status: 'alive',
    };
    const oneMinuteOld = Date.parse('2026-06-22T00:01:00Z');
    const v = computeVitals(
      [
        tx({ kind: 'income', amount: 5, reason: 'seed', ts: '2026-06-22T00:00:00Z' }),
        tx({ kind: 'rent', amount: -0.035, reason: 'rent', ts: '2026-06-22T00:00:30Z' }),
        tx({ kind: 'expense', amount: -0.01, reason: 'data_call', ts: '2026-06-22T00:00:40Z' }),
      ],
      justBorn,
      oneMinuteOld,
    );
    // burn $0.045 over a floored 1h window = $0.045/h — not $0.045 / (1min) ≈ $2.7/h.
    expect(v.burnPerHourUsd).toBeCloseTo(0.045, 6);
    expect(v.cashRunwayHours).toBeGreaterThan(100); // ~$4.955 / 0.045 ≈ 110h, not ~2h
  });

  it('reflects a rent hike immediately, not the lifetime average', () => {
    const born: AgentState = {
      agent_id: 'agent-0',
      born_at: '2026-06-22T00:00:00Z',
      died_at: null,
      status: 'alive',
    };
    // Ten hourly ticks at the old $0.02, then one at the new $0.10. The lifetime
    // average would be barely above $0.02; the runway must instead read the CURRENT
    // $0.10 measured over the last tick's 1h interval.
    const transactions: Transaction[] = [
      tx({ kind: 'income', amount: 20, reason: 'seed', ts: '2026-06-22T00:00:00Z' }),
    ];
    for (let h = 1; h <= 10; h++) {
      transactions.push(
        tx({
          kind: 'rent',
          amount: -0.02,
          reason: 'rent',
          ts: `2026-06-22T${String(h).padStart(2, '0')}:00:00Z`,
        }),
      );
    }
    transactions.push(
      tx({ kind: 'rent', amount: -0.1, reason: 'rent', ts: '2026-06-22T11:00:00Z' }),
    );
    const now = Date.parse('2026-06-22T11:00:00Z');
    const v = computeVitals(transactions, born, now);

    expect(v.burnPerHourUsd).toBeCloseTo(0.1, 6); // current rent, not the ~$0.024 average
    // net worth 20 - (10 x 0.02) - 0.10 = 19.70; runway = 19.70 / 0.10 = 197h, not ~820h.
    expect(v.cashRunwayHours).toBeCloseTo(197, 0);
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
