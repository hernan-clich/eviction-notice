import { agentStateSchema, transactionSchema, type AgentState, type Transaction } from 'shared';

import { getSupabase } from './supabase-client';

export interface LedgerSnapshot {
  transactions: Transaction[];
  agentState: AgentState | null;
}

export interface LedgerHandlers {
  onTransaction: (tx: Transaction) => void;
  onAgentState: (state: AgentState) => void;
}

/**
 * Abstracts where ledger data comes from, so the same UI serves both live and
 * replay. The live dashboard uses `realtimeLedgerSource` (Supabase Realtime);
 * the Phase 6 portfolio afterlife will add a snapshot source that plays a static
 * JSON on a compressed clock — no component changes required.
 */
export interface LedgerSource {
  load: (agentId: string) => Promise<LedgerSnapshot>;
  subscribe: (agentId: string, handlers: LedgerHandlers) => () => void;
}

export const realtimeLedgerSource: LedgerSource = {
  async load(agentId) {
    const supabase = getSupabase();
    const [txRes, stateRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('*')
        .eq('agent_id', agentId)
        .order('id', { ascending: true }),
      supabase.from('agent_state').select('*').eq('agent_id', agentId).maybeSingle(),
    ]);
    if (txRes.error) {
      throw new Error(`load transactions: ${txRes.error.message}`);
    }
    if (stateRes.error) {
      throw new Error(`load agent_state: ${stateRes.error.message}`);
    }
    return {
      transactions: (txRes.data ?? []).map((row) => transactionSchema.parse(row)),
      agentState: stateRes.data ? agentStateSchema.parse(stateRes.data) : null,
    };
  },

  subscribe(agentId, handlers) {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`ledger:${agentId}`)
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
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
