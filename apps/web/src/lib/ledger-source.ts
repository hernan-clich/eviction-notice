import {
  agentStateSchema,
  snapshotSchema,
  transactionSchema,
  type AgentState,
  type Snapshot,
  type Transaction,
} from 'shared';

import { getSupabase } from './supabase-client';

export interface LedgerData {
  transactions: Transaction[];
  agentState: AgentState | null;
  snapshots: Snapshot[];
}

export interface LedgerHandlers {
  onTransaction: (tx: Transaction) => void;
  onAgentState: (state: AgentState) => void;
  onSnapshot: (snap: Snapshot) => void;
}

/**
 * Abstracts where ledger data comes from, so the same UI serves both live and
 * replay. The live dashboard uses `realtimeLedgerSource` (Supabase Realtime);
 * the Phase 6 portfolio afterlife will add a source that plays a static JSON on a
 * compressed clock - no component changes required.
 */
export interface LedgerSource {
  load: (agentId: string) => Promise<LedgerData>;
  subscribe: (agentId: string, handlers: LedgerHandlers) => () => void;
}

/**
 * Plays a frozen run from a committed static JSON (shape: a serialized `LedgerData`,
 * produced by /export-replay). The deterministic, DB-independent source behind the
 * shareable `/replay` route - same `LedgerSource` seam, so it feeds the identical
 * replay UI. A recording never streams, so `subscribe` is a no-op.
 */
export function staticReplaySource(jsonUrl: string): LedgerSource {
  return {
    async load() {
      const res = await fetch(jsonUrl);
      if (!res.ok) {
        throw new Error(`load replay: ${res.status} ${res.statusText}`);
      }
      const raw = (await res.json()) as {
        transactions?: unknown[];
        agentState?: unknown;
        snapshots?: unknown[];
      };
      return {
        transactions: (raw.transactions ?? []).map((row) => transactionSchema.parse(row)),
        agentState: raw.agentState ? agentStateSchema.parse(raw.agentState) : null,
        snapshots: (raw.snapshots ?? []).map((row) => snapshotSchema.parse(row)),
      };
    },
    subscribe() {
      // A recording never streams - no subscription, nothing to tear down.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    },
  };
}

// Bumped per subscription so a rebuilt channel never collides with one whose
// removal is still in flight (we re-subscribe on focus/reconnect to recover a
// dropped socket - tearing down and recreating the channel).
let channelSeq = 0;

// PostgREST caps any single response at `db-max-rows` (default 1000) and silently
// drops the overflow — the newest rows, since we order ascending. That froze the feed
// and clipped the vitals math once the ledger passed 1k rows. Page through with
// .range() so load() always sees the full history, whatever the cap is set to.
const PAGE_SIZE = 1000;

async function loadAll<Row>(
  label: string,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`${label}: ${error.message}`);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
  }
  return rows;
}

export const realtimeLedgerSource: LedgerSource = {
  async load(agentId) {
    const supabase = getSupabase();
    const [txRows, stateRes, snapRows] = await Promise.all([
      loadAll('load transactions', (from, to) =>
        supabase
          .from('transactions')
          .select('*')
          .eq('agent_id', agentId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      supabase.from('agent_state').select('*').eq('agent_id', agentId).maybeSingle(),
      loadAll('load snapshots', (from, to) =>
        supabase
          .from('snapshots')
          .select('*')
          .eq('agent_id', agentId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ]);
    if (stateRes.error) {
      throw new Error(`load agent_state: ${stateRes.error.message}`);
    }
    return {
      transactions: txRows.map((row) => transactionSchema.parse(row)),
      agentState: stateRes.data ? agentStateSchema.parse(stateRes.data) : null,
      snapshots: snapRows.map((row) => snapshotSchema.parse(row)),
    };
  },

  subscribe(agentId, handlers) {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`ledger:${agentId}:${channelSeq++}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transactions',
          filter: `agent_id=eq.${agentId}`,
        },
        (payload) => {
          handlers.onTransaction(transactionSchema.parse(payload.new));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_state', filter: `agent_id=eq.${agentId}` },
        (payload) => {
          handlers.onAgentState(agentStateSchema.parse(payload.new));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'snapshots',
          filter: `agent_id=eq.${agentId}`,
        },
        (payload) => {
          handlers.onSnapshot(snapshotSchema.parse(payload.new));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },
};

/** The committed recording the static source plays when the DB is gone. */
export const REPLAY_JSON_URL = '/replays/agent-0.json';

/**
 * Pick the ledger source from config, the one switch between a live agent and the
 * permanent memorial. When the Supabase env vars are present we read the live DB (and
 * stream updates); when they are absent - the post-teardown state - we fall back to the
 * frozen static recording. Reviving the DB is purely an ops change: restore the
 * NEXT_PUBLIC_SUPABASE_* vars and redeploy, no code edit. Same seam either way, so the
 * dashboard/memorial UI is identical; the static source's subscribe is just a no-op.
 */
export function selectLedgerSource(): LedgerSource {
  const hasDb =
    !!process.env['NEXT_PUBLIC_SUPABASE_URL'] &&
    !!process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  return hasDb ? realtimeLedgerSource : staticReplaySource(REPLAY_JSON_URL);
}
