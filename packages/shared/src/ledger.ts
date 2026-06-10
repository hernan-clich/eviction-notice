import { z } from 'zod';

/**
 * The ledger domain. Schemas mirror the Postgres tables 1:1 (snake_case keys,
 * matching what Supabase returns) so DB rows parse without a mapping layer.
 *
 * `amount` and other numerics use `z.coerce.number()` because PostgREST may
 * serialise `numeric` columns as either JSON numbers or strings.
 */

export const transactionKindSchema = z.enum(['income', 'expense', 'rent']);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

export const agentStatusSchema = z.enum(['alive', 'dead']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/**
 * Known transaction reasons. `reason` stays an open string in the schema so new
 * reasons don't require a migration; this list documents the expected values.
 */
export const TRANSACTION_REASONS = ['trade_close', 'data_call', 'gas', 'x402_fee', 'rent'] as const;
export type KnownTransactionReason = (typeof TRANSACTION_REASONS)[number];

export const transactionSchema = z.object({
  id: z.coerce.number().int(),
  agent_id: z.string(),
  ts: z.string(), // ISO timestamptz
  kind: transactionKindSchema,
  amount: z.coerce.number(), // signed USD: income > 0, expense/rent < 0
  reason: z.string(),
  reasoning: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const positionSchema = z.object({
  id: z.coerce.number().int(),
  agent_id: z.string(),
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  token: z.string(),
  size_usd: z.coerce.number(),
  entry_px: z.coerce.number(),
  exit_px: z.coerce.number().nullable(),
  pnl_usd: z.coerce.number().nullable(),
});
export type Position = z.infer<typeof positionSchema>;

/** One open position marked to current price, as stored in a snapshot's `positions`. */
export const snapshotPositionSchema = z.object({
  token: z.string(),
  sizeUsd: z.number(),
  entryPx: z.number(),
  markPx: z.number(),
  valueUsd: z.number(),
});
export type SnapshotPosition = z.infer<typeof snapshotPositionSchema>;

/**
 * Per-tick marked balance sheet. `cash` is liquidity (SUM ledger), `position_value`
 * marks open positions to current price, and `net_worth = cash + position_value` is
 * the life force + death line. The dashboard can't mark positions itself, so the
 * worker writes these each tick.
 */
export const snapshotSchema = z.object({
  id: z.coerce.number().int(),
  agent_id: z.string(),
  ts: z.string(),
  cash_usd: z.coerce.number(),
  position_value_usd: z.coerce.number(),
  net_worth_usd: z.coerce.number(),
  positions: z.array(snapshotPositionSchema).nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const agentStateSchema = z.object({
  agent_id: z.string(),
  born_at: z.string().nullable(),
  died_at: z.string().nullable(),
  status: agentStatusSchema,
});
export type AgentState = z.infer<typeof agentStateSchema>;

/**
 * USD amounts are summed in integer nano-dollars (1e-9) to avoid binary-float
 * drift (e.g. 0.1 + 0.2) while still preserving sub-cent / sub-micro x402
 * micropayments. The authoritative balance is `SUM(amount)` in Postgres; this
 * mirrors it for in-memory state and crash rehydration. Nano-dollar resolution
 * keeps integer math safe (a $1M balance is 1e15 nano, within MAX_SAFE_INTEGER).
 */
const MONEY_SCALE = 1_000_000_000;

export function computeBalance(transactions: readonly Pick<Transaction, 'amount'>[]): number {
  let nano = 0;
  for (const tx of transactions) {
    nano += Math.round(tx.amount * MONEY_SCALE);
  }
  return nano / MONEY_SCALE;
}

/** Alive iff the lifecycle is 'alive' AND the ledger balance is strictly positive. */
export function isAlive(state: { balance: number; status: AgentStatus }): boolean {
  return state.status === 'alive' && state.balance > 0;
}
