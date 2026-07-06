import { describe, expect, it } from 'vitest';

import { fetchBalance, fetchTransactions, type AppSupabaseClient } from './supabase.ts';

/**
 * Minimal PostgREST stand-in: the real API caps a response at `db-max-rows` and
 * drops the overflow. This mock enforces that cap per `.range()` window, so a read
 * that fails to paginate would observe only the first page — exactly the truncation
 * bug these tests guard against.
 */
function mockClient(rowsByTable: Record<string, unknown[]>, maxRows: number): AppSupabaseClient {
  const from = (table: string) => {
    const rows = rowsByTable[table] ?? [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (start: number, end: number) => {
        // PostgREST clamps the requested window to db-max-rows rows.
        const stop = Math.min(end, start + maxRows - 1);
        return Promise.resolve({ data: rows.slice(start, stop + 1), error: null });
      },
    };
    return builder;
  };
  return { from } as unknown as AppSupabaseClient;
}

function txRow(id: number, amount: number) {
  return {
    id,
    agent_id: 'agent-0',
    ts: '2026-07-06T00:00:00+00:00',
    kind: 'expense',
    amount,
    reason: 'rent',
    reasoning: null,
    meta: null,
  };
}

describe('fetchBalance pagination', () => {
  it('sums the whole ledger even when it exceeds the row cap', async () => {
    const rows = Array.from({ length: 2508 }, (_, i) => txRow(i + 1, 0.01));
    const client = mockClient({ transactions: rows }, 1000);
    // 2508 × $0.01 — a single capped page would return only $10.00.
    expect(await fetchBalance(client, 'agent-0')).toBeCloseTo(25.08, 9);
  });

  it('handles a ledger that fits in one page', async () => {
    const rows = [txRow(1, 20), txRow(2, -5.5)];
    const client = mockClient({ transactions: rows }, 1000);
    expect(await fetchBalance(client, 'agent-0')).toBeCloseTo(14.5, 9);
  });

  it('returns 0 for an empty ledger', async () => {
    const client = mockClient({ transactions: [] }, 1000);
    expect(await fetchBalance(client, 'agent-0')).toBe(0);
  });
});

describe('fetchTransactions pagination', () => {
  it('returns every row past the cap, not just the first page', async () => {
    const rows = Array.from({ length: 2100 }, (_, i) => txRow(i + 1, 0.01));
    const client = mockClient({ transactions: rows }, 1000);
    const out = await fetchTransactions(client, 'agent-0');
    expect(out).toHaveLength(2100);
    expect(out.at(-1)?.id).toBe(2100);
  });

  it('stops cleanly when the total is an exact multiple of the page size', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => txRow(i + 1, 0.01));
    const client = mockClient({ transactions: rows }, 1000);
    expect(await fetchTransactions(client, 'agent-0')).toHaveLength(2000);
  });
});
