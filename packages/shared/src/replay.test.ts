import { describe, expect, it } from 'vitest';

import type { Snapshot, Transaction } from './ledger.ts';
import { buildReplaySchedule, isReplayFeedReason, ledgerAt, realAt } from './replay.ts';

const bornMs = Date.parse('2026-06-22T00:00:00Z');
const evictedMs = Date.parse('2026-06-23T06:00:00Z'); // 30h

let nextId = 1;
function tx(reason: string, ts: string, amount = 0): Transaction {
  return {
    id: nextId++,
    agent_id: 'agent-0',
    ts,
    kind: 'expense',
    amount,
    reason,
    reasoning: null,
    meta: null,
  };
}
function snap(ts: string, net: number): Snapshot {
  return {
    id: nextId++,
    agent_id: 'agent-0',
    ts,
    cash_usd: net,
    position_value_usd: 0,
    net_worth_usd: net,
    positions: null,
  };
}

const transactions: Transaction[] = [
  tx('seed', '2026-06-22T00:00:00Z', 5),
  tx('trade_open', '2026-06-22T02:00:00Z'),
  tx('trade_close', '2026-06-22T05:00:00Z'),
  tx('data_call', '2026-06-22T18:00:00Z'),
];
const snapshots: Snapshot[] = [
  snap('2026-06-22T00:00:00Z', 5), // stable
  snap('2026-06-22T05:00:00Z', 5.2), // peak
  snap('2026-06-22T18:00:00Z', 2.5), // strained
  snap('2026-06-23T05:00:00Z', 0.3), // final notice
];

describe('buildReplaySchedule', () => {
  const schedule = buildReplaySchedule(transactions, snapshots, { bornMs, evictedMs });

  it('brackets the life and keeps keyframes sorted + monotonic in real time', () => {
    expect(schedule.keyframeMs[0]).toBe(bornMs);
    expect(schedule.keyframeMs.at(-1)).toBe(evictedMs);
    for (let i = 1; i < schedule.keyframeMs.length; i += 1) {
      expect(schedule.keyframeMs[i]!).toBeGreaterThan(schedule.keyframeMs[i - 1]!);
      expect(schedule.realAtKeyframe[i]!).toBeGreaterThan(schedule.realAtKeyframe[i - 1]!);
    }
    expect(schedule.totalRealMs).toBe(schedule.realAtKeyframe.at(-1));
  });

  it('lands the clock on born at t=0 and eviction at the end', () => {
    expect(ledgerAt(schedule, 0)).toBe(bornMs);
    expect(ledgerAt(schedule, schedule.totalRealMs)).toBe(evictedMs);
    expect(ledgerAt(schedule, -100)).toBe(bornMs); // clamps below
    expect(ledgerAt(schedule, schedule.totalRealMs + 100)).toBe(evictedMs); // clamps above
  });

  it('round-trips ledger ↔ real time through a keyframe', () => {
    const mid = schedule.keyframeMs[2]!;
    expect(ledgerAt(schedule, realAt(schedule, mid))).toBeCloseTo(mid, 0);
  });

  it('compresses long idle stretches (a 13h gap costs no more than a short one + cap)', () => {
    // The whole 30h life plays in well under a real minute thanks to the caps.
    expect(schedule.totalRealMs).toBeLessThan(60_000);
  });
});

describe('isReplayFeedReason', () => {
  it('keeps thoughts and trades, drops metabolism noise', () => {
    expect(isReplayFeedReason('decision')).toBe(true);
    expect(isReplayFeedReason('trade_open')).toBe(true);
    expect(isReplayFeedReason('data_call')).toBe(false);
    expect(isReplayFeedReason('x402_fee')).toBe(false);
    expect(isReplayFeedReason('rent')).toBe(false);
  });
});
