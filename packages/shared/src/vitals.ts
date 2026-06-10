import type { AgentState, Transaction } from './ledger.ts';

/**
 * Derive the agent's vital signs from the append-only ledger + lifecycle row.
 * Pure (takes `nowMs` rather than reading the clock) so it's testable and works
 * identically for the live dashboard and the Phase 6 replay.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface BalancePoint {
  tsMs: number;
  balanceUsd: number;
}

export interface Vitals {
  balanceUsd: number;
  seedUsd: number;
  netPnlUsd: number;
  peakUsd: number;
  burnPerHourUsd: number;
  runwayHours: number;
  daysSurvived: number;
  tradeCount: number;
  alive: boolean;
  /** Cumulative balance over time, for the sparkline. */
  series: BalancePoint[];
}

export function computeVitals(
  transactions: readonly Transaction[],
  agentState: AgentState | null,
  nowMs: number,
): Vitals {
  const ordered = [...transactions].sort((a, b) => a.id - b.id);

  const series: BalancePoint[] = [];
  let cumulative = 0;
  let peakUsd = 0;
  let seedUsd = 0;
  let burnUsd = 0; // cost of existing: rent + data + x402
  let tradeCount = 0;

  for (const tx of ordered) {
    cumulative += tx.amount;
    peakUsd = Math.max(peakUsd, cumulative);
    series.push({ tsMs: Date.parse(tx.ts), balanceUsd: cumulative });
    if (tx.reason === 'seed') {
      seedUsd += tx.amount;
    }
    if (tx.reason === 'rent' || tx.reason === 'data_call' || tx.reason === 'x402_fee') {
      burnUsd += -tx.amount;
    }
    if (tx.reason === 'trade_open') {
      tradeCount += 1;
    }
  }

  const balanceUsd = cumulative;
  const bornMs = agentState?.born_at ? Date.parse(agentState.born_at) : (series[0]?.tsMs ?? nowMs);
  const endMs = agentState?.died_at ? Date.parse(agentState.died_at) : nowMs;
  const elapsedMs = Math.max(endMs - bornMs, 0);
  const hoursElapsed = elapsedMs / HOUR_MS;
  const burnPerHourUsd = hoursElapsed > 0 ? burnUsd / hoursElapsed : 0;

  return {
    balanceUsd,
    seedUsd,
    netPnlUsd: balanceUsd - seedUsd,
    peakUsd,
    burnPerHourUsd,
    runwayHours: burnPerHourUsd > 0 ? balanceUsd / burnPerHourUsd : Number.POSITIVE_INFINITY,
    daysSurvived: elapsedMs / DAY_MS,
    tradeCount,
    alive: (agentState?.status ?? 'alive') === 'alive' && balanceUsd > 0,
    series,
  };
}
