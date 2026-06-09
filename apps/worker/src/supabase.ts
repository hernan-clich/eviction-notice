import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { agentStatusSchema, computeBalance, type AgentStatus, type TransactionKind } from 'shared';
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
