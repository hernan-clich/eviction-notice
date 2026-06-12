import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  agentStateSchema,
  agentStatusSchema,
  computeBalance,
  snapshotSchema,
  transactionSchema,
  type AgentState,
  type AgentStatus,
  type Snapshot,
  type Transaction,
  type TransactionKind,
} from 'shared';
import { z } from 'zod';

import type { WorkerConfig } from './config.ts';

/** Service-role client — bypasses RLS so the worker can write ledger rows. */
export function createClient(config: WorkerConfig) {
  return createSupabaseClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The concrete client type our data layer operates on. */
export type AppSupabaseClient = ReturnType<typeof createClient>;

export interface LedgerEntry {
  agentId: string;
  kind: TransactionKind;
  amount: number;
  reason: string;
  reasoning?: string;
  meta?: Record<string, unknown>;
}

export async function insertTransaction(
  client: AppSupabaseClient,
  entry: LedgerEntry,
): Promise<void> {
  const { error } = await client.from('transactions').insert({
    agent_id: entry.agentId,
    kind: entry.kind,
    amount: entry.amount,
    reason: entry.reason,
    reasoning: entry.reasoning ?? null,
    meta: entry.meta ?? null,
  });
  if (error) {
    throw new Error(`insert transaction (${entry.reason}): ${error.message}`);
  }
}

const amountRowSchema = z.object({ amount: z.coerce.number() });

/** Balance = SUM(amount) over the ledger, computed via the shared helper. */
export async function fetchBalance(client: AppSupabaseClient, agentId: string): Promise<number> {
  const { data, error } = await client
    .from('transactions')
    .select('amount')
    .eq('agent_id', agentId);
  if (error) {
    throw new Error(`fetch balance: ${error.message}`);
  }
  const rows = z.array(amountRowSchema).parse(data ?? []);
  return computeBalance(rows);
}

const statusRowSchema = z.object({ status: agentStatusSchema });

export async function fetchStatus(
  client: AppSupabaseClient,
  agentId: string,
): Promise<AgentStatus> {
  const { data, error } = await client
    .from('agent_state')
    .select('status')
    .eq('agent_id', agentId)
    .single();
  if (error) {
    throw new Error(`fetch status: ${error.message}`);
  }
  return statusRowSchema.parse(data).status;
}

/** Full ledger for the agent (oldest-first) — for vitals / burn-rate computation. */
export async function fetchTransactions(
  client: AppSupabaseClient,
  agentId: string,
): Promise<Transaction[]> {
  const { data, error } = await client
    .from('transactions')
    .select('*')
    .eq('agent_id', agentId)
    .order('ts', { ascending: true });
  if (error) {
    throw new Error(`fetch transactions: ${error.message}`);
  }
  return z.array(transactionSchema).parse(data ?? []);
}

/** The agent lifecycle row (born_at, status, …) — for vitals. */
export async function fetchAgentState(
  client: AppSupabaseClient,
  agentId: string,
): Promise<AgentState> {
  const { data, error } = await client
    .from('agent_state')
    .select('agent_id, born_at, died_at, status')
    .eq('agent_id', agentId)
    .single();
  if (error) {
    throw new Error(`fetch agent_state: ${error.message}`);
  }
  return agentStateSchema.parse(data);
}

/** Per-tick balance-sheet snapshots — for marked net worth in vitals. */
export async function fetchSnapshots(
  client: AppSupabaseClient,
  agentId: string,
): Promise<Snapshot[]> {
  const { data, error } = await client
    .from('snapshots')
    .select('*')
    .eq('agent_id', agentId)
    .order('id', { ascending: true });
  if (error) {
    throw new Error(`fetch snapshots: ${error.message}`);
  }
  return z.array(snapshotSchema).parse(data ?? []);
}

/**
 * Idempotent birth: ensures the lifecycle row exists (without clobbering an
 * existing status — a dead agent stays dead) and seeds the ledger exactly once.
 * Safe to call on every boot (crash rehydration).
 */
export async function ensureBorn(
  client: AppSupabaseClient,
  config: WorkerConfig,
): Promise<{ seeded: boolean }> {
  const { error: upsertError } = await client
    .from('agent_state')
    .upsert(
      { agent_id: config.AGENT_ID, status: 'alive' },
      { onConflict: 'agent_id', ignoreDuplicates: true },
    );
  if (upsertError) {
    throw new Error(`ensure agent_state: ${upsertError.message}`);
  }

  const { data, error } = await client
    .from('transactions')
    .select('id')
    .eq('agent_id', config.AGENT_ID)
    .eq('reason', 'seed')
    .limit(1);
  if (error) {
    throw new Error(`check seed: ${error.message}`);
  }
  const existing = z.array(z.object({ id: z.coerce.number() })).parse(data ?? []);
  if (existing.length > 0) {
    return { seeded: false };
  }

  await insertTransaction(client, {
    agentId: config.AGENT_ID,
    kind: 'income',
    amount: config.SEED_USD,
    reason: 'seed',
    reasoning: 'Initial funding — the agent is born.',
  });
  return { seeded: true };
}

export async function markDead(client: AppSupabaseClient, agentId: string): Promise<void> {
  const { error } = await client
    .from('agent_state')
    .update({ status: 'dead', died_at: new Date().toISOString() })
    .eq('agent_id', agentId);
  if (error) {
    throw new Error(`mark dead: ${error.message}`);
  }
}

export interface OpenPosition {
  id: number;
  token: string;
  sizeUsd: number;
  entryPx: number;
  openedAt: string;
}

const openPositionRowSchema = z.object({
  id: z.coerce.number().int(),
  token: z.string(),
  size_usd: z.coerce.number(),
  entry_px: z.coerce.number(),
  opened_at: z.string(),
});

export async function openPosition(
  client: AppSupabaseClient,
  args: { agentId: string; token: string; sizeUsd: number; entryPx: number },
): Promise<number> {
  const { data, error } = await client
    .from('positions')
    .insert({
      agent_id: args.agentId,
      token: args.token,
      size_usd: args.sizeUsd,
      entry_px: args.entryPx,
    })
    .select('id')
    .single();
  if (error) {
    throw new Error(`open position: ${error.message}`);
  }
  return z.object({ id: z.coerce.number().int() }).parse(data).id;
}

export async function fetchOpenPositions(
  client: AppSupabaseClient,
  agentId: string,
): Promise<OpenPosition[]> {
  const { data, error } = await client
    .from('positions')
    .select('id, token, size_usd, entry_px, opened_at')
    .eq('agent_id', agentId)
    .is('closed_at', null)
    .order('id', { ascending: true });
  if (error) {
    throw new Error(`fetch open positions: ${error.message}`);
  }
  return z
    .array(openPositionRowSchema)
    .parse(data ?? [])
    .map((row) => ({
      id: row.id,
      token: row.token,
      sizeUsd: row.size_usd,
      entryPx: row.entry_px,
      openedAt: row.opened_at,
    }));
}

export async function closePosition(
  client: AppSupabaseClient,
  args: { id: number; exitPx: number; pnlUsd: number },
): Promise<void> {
  const { error } = await client
    .from('positions')
    .update({ closed_at: new Date().toISOString(), exit_px: args.exitPx, pnl_usd: args.pnlUsd })
    .eq('id', args.id);
  if (error) {
    throw new Error(`close position: ${error.message}`);
  }
}

export interface SnapshotInput {
  agentId: string;
  cashUsd: number;
  positionValueUsd: number;
  netWorthUsd: number;
  positions: {
    token: string;
    sizeUsd: number;
    entryPx: number;
    markPx: number;
    valueUsd: number;
  }[];
}

/** Append a per-tick marked balance sheet (cash + position value = net worth). */
export async function insertSnapshot(
  client: AppSupabaseClient,
  snap: SnapshotInput,
): Promise<void> {
  const { error } = await client.from('snapshots').insert({
    agent_id: snap.agentId,
    cash_usd: snap.cashUsd,
    position_value_usd: snap.positionValueUsd,
    net_worth_usd: snap.netWorthUsd,
    positions: snap.positions,
  });
  if (error) {
    throw new Error(`insert snapshot: ${error.message}`);
  }
}

/** Epoch ms of the most recent opened trade, or null if the agent has never traded. */
export async function lastTradeAtMs(
  client: AppSupabaseClient,
  agentId: string,
): Promise<number | null> {
  const { data, error } = await client
    .from('transactions')
    .select('ts')
    .eq('agent_id', agentId)
    .eq('reason', 'trade_open')
    .order('ts', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`last trade lookup: ${error.message}`);
  }
  const rows = z.array(z.object({ ts: z.string() })).parse(data ?? []);
  return rows[0] ? Date.parse(rows[0].ts) : null;
}
