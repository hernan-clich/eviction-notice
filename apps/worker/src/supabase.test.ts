import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';
import { ensureBorn, fetchBalance, fetchTransactions, type AppSupabaseClient } from './supabase.ts';

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

interface AgentStateRow {
  agent_id: string;
  status: string;
  born_at: string | null;
  died_at: string | null;
}

/**
 * Purpose-built mock for the ensureBorn write path: upsert (ignoreDuplicates),
 * the seed lookup, the seed insert, and the born_at update guarded on `is null`.
 */
function ensureBornMock(initial: {
  agentState?: AgentStateRow | null;
  txs?: { reason: string }[];
}) {
  const state = {
    agentState: initial.agentState ?? null,
    txs: (initial.txs ?? []).map((t, i) => ({
      id: i + 1,
      ts: `2026-06-22T00:00:0${i}.000+00:00`,
      ...t,
    })),
  };
  const client = {
    from(table: string) {
      if (table === 'agent_state') {
        return {
          upsert(row: { agent_id: string; status: string }) {
            state.agentState ??= { born_at: null, died_at: null, ...row };
            return Promise.resolve({ error: null });
          },
          update(patch: Partial<AgentStateRow>) {
            const chain = {
              eq: () => chain,
              is: (field: keyof AgentStateRow) => {
                if (state.agentState?.[field] === null) {
                  Object.assign(state.agentState, patch);
                }
                return Promise.resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () =>
          Promise.resolve({
            data: state.txs
              .filter((t) => t.reason === 'seed')
              .sort((a, b) => a.ts.localeCompare(b.ts))
              .slice(0, 1)
              .map((t) => ({ id: t.id, ts: t.ts })),
            error: null,
          }),
        insert: (row: { reason: string }) => {
          state.txs.push({ id: state.txs.length + 1, ts: '2026-06-22T00:00:01.266+00:00', ...row });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
    _state: state,
  };
  return client as unknown as AppSupabaseClient & { _state: typeof state };
}

const bornConfig = loadConfig({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
});

describe('ensureBorn stamps born_at', () => {
  it('stamps a fresh birth with the seed timestamp', async () => {
    const client = ensureBornMock({ agentState: null, txs: [] });
    const { seeded } = await ensureBorn(client, bornConfig);
    expect(seeded).toBe(true);
    expect(client._state.agentState?.born_at).toBe('2026-06-22T00:00:01.266+00:00');
  });

  it('backfills a legacy row whose born_at is null', async () => {
    const client = ensureBornMock({
      agentState: { agent_id: 'agent-0', status: 'alive', born_at: null, died_at: null },
      txs: [{ reason: 'seed' }],
    });
    const { seeded } = await ensureBorn(client, bornConfig);
    expect(seeded).toBe(false);
    expect(client._state.agentState?.born_at).toBe('2026-06-22T00:00:00.000+00:00');
  });

  it('never clobbers a born_at that is already set', async () => {
    const client = ensureBornMock({
      agentState: {
        agent_id: 'agent-0',
        status: 'alive',
        born_at: '2026-01-01T00:00:00.000+00:00',
        died_at: null,
      },
      txs: [{ reason: 'seed' }],
    });
    await ensureBorn(client, bornConfig);
    expect(client._state.agentState?.born_at).toBe('2026-01-01T00:00:00.000+00:00');
  });
});
