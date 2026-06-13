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
 * compressed clock — no component changes required.
 */
export interface LedgerSource {
  load: (agentId: string) => Promise<LedgerData>;
  subscribe: (agentId: string, handlers: LedgerHandlers) => () => void;
}

/**
 * Plays a frozen run from a committed static JSON (shape: a serialized `LedgerData`,
 * produced by /export-replay). The deterministic, DB-independent source behind the
 * shareable `/replay` route — same `LedgerSource` seam, so it feeds the identical
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
      // A recording never streams — no subscription, nothing to tear down.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    },
  };
}

// Bumped per subscription so a rebuilt channel never collides with one whose
// removal is still in flight (we re-subscribe on focus/reconnect to recover a
// dropped socket — tearing down and recreating the channel).
let channelSeq = 0;

export const realtimeLedgerSource: LedgerSource = {
  async load(agentId) {
    const supabase = getSupabase();
    const [txRes, stateRes, snapRes] = await Promise.all([
      supabase.from('transactions').select('*').eq('agent_id', agentId).order('id', {
        ascending: true,
      }),
      supabase.from('agent_state').select('*').eq('agent_id', agentId).maybeSingle(),
      supabase.from('snapshots').select('*').eq('agent_id', agentId).order('id', {
        ascending: true,
      }),
    ]);
    if (txRes.error) {
      throw new Error(`load transactions: ${txRes.error.message}`);
    }
    if (stateRes.error) {
      throw new Error(`load agent_state: ${stateRes.error.message}`);
    }
    if (snapRes.error) {
      throw new Error(`load snapshots: ${snapRes.error.message}`);
    }
    return {
      transactions: (txRes.data ?? []).map((row) => transactionSchema.parse(row)),
      agentState: stateRes.data ? agentStateSchema.parse(stateRes.data) : null,
      snapshots: (snapRes.data ?? []).map((row) => snapshotSchema.parse(row)),
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
