import type { AgentState, Snapshot, Transaction } from './ledger.ts';

/**
 * Derive the agent's vital signs from the ledger + per-tick snapshots + lifecycle
 * row. Two truths: NET WORTH (cash + positions marked to market) is the life force
 * and the death line — deploying cash into a token converts it, it isn't lost — and
 * CASH is liquidity: whether it can pay rent / open trades right now. Pure (takes
 * `nowMs`) so it's testable and works for both the live dashboard and #28 replay.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface BalancePoint {
  tsMs: number;
  /** Plotted value over time — net worth once snapshots exist, else cash. */
  balanceUsd: number;
}

export interface PositionMark {
  token: string;
  valueUsd: number;
}

export interface Vitals {
  /** Liquidity: SUM(ledger). Pays rent + opens trades. */
  cashUsd: number;
  /** Open positions marked to current price. */
  positionValueUsd: number;
  /** cash + positions — the life force and the death line. */
  netWorthUsd: number;
  seedUsd: number;
  /** netWorth − seed: the all-in change incl. the fictional eviction burn. */
  netPnlUsd: number;
  /**
   * The real trading result the competition scores: netPnl with the *fictional*
   * costs (rent + the modeled data-call fee) added back, since those never leave
   * the wallet. Real on-chain costs (x402, gas, swap friction) stay subtracted.
   * This is the honest "how is it trading" number, distinct from the eviction burn.
   */
  tradingPnlUsd: number;
  /** Peak net worth observed. */
  peakUsd: number;
  /** Worst peak-to-trough drop over the lifetime (fractional) — the drawdown DQ metric. */
  maxDrawdownFraction: number;
  burnPerHourUsd: number;
  /** Hours of cash left at burn — the forced-sale pressure. */
  cashRunwayHours: number;
  /** Hours of net worth left at burn — the true time to eviction. */
  netWorthRunwayHours: number;
  daysSurvived: number;
  tradeCount: number;
  alive: boolean;
  /** Open-position breakdown for the split bar + asset-rich/cash-poor warning. */
  positions: PositionMark[];
  /** Net worth over time, for the lifetime chart. */
  series: BalancePoint[];
}

export function computeVitals(
  transactions: readonly Transaction[],
  agentState: AgentState | null,
  nowMs: number,
  snapshots: readonly Snapshot[] = [],
): Vitals {
  const ordered = [...transactions].sort((a, b) => a.id - b.id);

  const cashSeries: BalancePoint[] = [];
  let cash = 0;
  let seedUsd = 0;
  let burnUsd = 0; // cost of existing: rent + data + x402
  let fictionalBurnUsd = 0; // rent + data only — invented costs, not real wallet spend
  let tradeCount = 0;

  for (const tx of ordered) {
    cash += tx.amount;
    cashSeries.push({ tsMs: Date.parse(tx.ts), balanceUsd: cash });
    if (tx.reason === 'seed') {
      seedUsd += tx.amount;
    }
    if (tx.reason === 'rent' || tx.reason === 'data_call' || tx.reason === 'x402_fee') {
      burnUsd += -tx.amount;
    }
    if (tx.reason === 'rent' || tx.reason === 'data_call') {
      fictionalBurnUsd += -tx.amount;
    }
    if (tx.reason === 'trade_open') {
      tradeCount += 1;
    }
  }
  const cashUsd = cash;

  // Net worth comes from the latest snapshot (the worker marks open positions).
  // Before any snapshot exists, net worth degrades gracefully to cash.
  const orderedSnaps = [...snapshots].sort((a, b) => a.id - b.id);
  const latest = orderedSnaps.at(-1) ?? null;
  const positionValueUsd = latest ? latest.position_value_usd : 0;
  const netWorthUsd = latest ? latest.net_worth_usd : cashUsd;
  const positions: PositionMark[] = latest?.positions
    ? latest.positions.map((p) => ({ token: p.token, valueUsd: p.valueUsd }))
    : [];

  const series: BalancePoint[] =
    orderedSnaps.length > 0
      ? orderedSnaps.map((s) => ({ tsMs: Date.parse(s.ts), balanceUsd: s.net_worth_usd }))
      : cashSeries;

  // Peak + worst drawdown over the lifetime. Max drawdown is measured against a
  // *running* peak (the high-water mark only ratchets up), so it never un-falls —
  // matching the competition's permanent DQ metric.
  let peakUsd = netWorthUsd;
  let runningPeak = 0;
  let maxDrawdownFraction = 0;
  for (const point of series) {
    runningPeak = Math.max(runningPeak, point.balanceUsd);
    peakUsd = Math.max(peakUsd, point.balanceUsd);
    if (runningPeak > 0) {
      maxDrawdownFraction = Math.max(
        maxDrawdownFraction,
        (runningPeak - point.balanceUsd) / runningPeak,
      );
    }
  }

  const bornMs = agentState?.born_at
    ? Date.parse(agentState.born_at)
    : (cashSeries[0]?.tsMs ?? nowMs);
  const endMs = agentState?.died_at ? Date.parse(agentState.died_at) : nowMs;
  const elapsedMs = Math.max(endMs - bornMs, 0);
  // Burn rate over at least a 1-hour window, so a newborn's first few cents of rent
  // aren't annualized into a huge $/h (which would falsely crater the cash runway).
  // It converges to the true rate as the agent ages past the window.
  const burnHours = Math.max(elapsedMs, HOUR_MS) / HOUR_MS;
  const burnPerHourUsd = burnUsd / burnHours;
  const runway = (value: number): number =>
    burnPerHourUsd > 0 ? value / burnPerHourUsd : Number.POSITIVE_INFINITY;

  return {
    cashUsd,
    positionValueUsd,
    netWorthUsd,
    seedUsd,
    netPnlUsd: netWorthUsd - seedUsd,
    tradingPnlUsd: netWorthUsd - seedUsd + fictionalBurnUsd,
    peakUsd,
    maxDrawdownFraction,
    burnPerHourUsd,
    cashRunwayHours: runway(cashUsd),
    netWorthRunwayHours: runway(netWorthUsd),
    daysSurvived: elapsedMs / DAY_MS,
    tradeCount,
    alive: (agentState?.status ?? 'alive') === 'alive' && netWorthUsd > 0,
    positions,
    series,
  };
}
