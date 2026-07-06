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
  /** Current real-wallet equity: net worth with the fictional rent/data burn added back. */
  tradingEquityUsd: number;
  /** Peak net worth observed (narrative high-water mark). */
  peakUsd: number;
  /** Peak real-wallet equity — the high-water mark the DQ drawdown is measured against. */
  peakTradingEquityUsd: number;
  /**
   * Worst peak-to-trough of TRADING EQUITY (real wallet), NOT the rent-eroded net
   * worth — so the fictional burn can never trip the competition's 30% DQ on its own.
   */
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
  let burnUsd = 0; // all-in cost: rent + data + x402 (lifetime; the fallback + variable basis)
  let fictionalBurnUsd = 0; // rent + data only — invented costs, not real wallet spend
  let tradeCount = 0;
  // Rent ticks: running total, latest amount, and timestamps — so the burn rate can read
  // the CURRENT rent from a robust median cadence rather than a lifetime average or a
  // single fragile gap between the last two ticks.
  let rentTotalUsd = 0;
  let lastRentUsd: number | null = null;
  const rentTsMs: number[] = [];
  // Cumulative fictional burn over time — used to reconstruct real trading equity for
  // the drawdown/DQ metric (so rent can't trip the competition's 30% line).
  const ficTimeline: { tsMs: number; cum: number }[] = [];

  for (const tx of ordered) {
    const tsMs = Date.parse(tx.ts);
    cash += tx.amount;
    cashSeries.push({ tsMs, balanceUsd: cash });
    if (tx.reason === 'seed') {
      seedUsd += tx.amount;
    }
    if (tx.reason === 'rent' || tx.reason === 'data_call' || tx.reason === 'x402_fee') {
      burnUsd += -tx.amount;
    }
    if (tx.reason === 'rent') {
      rentTotalUsd += -tx.amount;
      lastRentUsd = -tx.amount;
      rentTsMs.push(tsMs);
    }
    if (tx.reason === 'rent' || tx.reason === 'data_call') {
      fictionalBurnUsd += -tx.amount;
      ficTimeline.push({ tsMs, cum: fictionalBurnUsd });
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

  // Sorted by tsMs (not just id) so the trading-equity two-pointer below is robust to
  // any id/timestamp skew — a clock step, a backfill, or a multi-source #28 replay.
  const series: BalancePoint[] = (
    orderedSnaps.length > 0
      ? orderedSnaps.map((s) => ({ tsMs: Date.parse(s.ts), balanceUsd: s.net_worth_usd }))
      : [...cashSeries]
  ).sort((a, b) => a.tsMs - b.tsMs);

  // peakUsd is the net-worth high-water mark (a narrative stat). But DRAWDOWN and the
  // DQ are measured on the REAL wallet — trading equity = net worth with the fictional
  // rent + data burn added back — so the invented burn alone can never trip the 30%
  // DQ. Reconstruct trading equity at each point by adding the cumulative fictional
  // burn as of that timestamp (two-pointer over the tsMs-sorted timeline). Drawdown is
  // vs a running peak (ratchets up only), matching the competition's permanent metric.
  ficTimeline.sort((a, b) => a.tsMs - b.tsMs);
  const tradingEquityUsd = netWorthUsd + fictionalBurnUsd;
  let peakUsd = netWorthUsd;
  let peakTradingEquityUsd = Math.max(seedUsd, tradingEquityUsd);
  let fi = 0;
  let cumFic = 0;
  // Seed the running peak at the birth equity (the seed): a loss BEFORE the first
  // snapshot still counts toward drawdown. Otherwise the DQ is measured from the first
  // snapshot and under-reports — the agent could read "safe" while the comp has DQ'd it.
  let runningPeak = seedUsd;
  let maxDrawdownFraction = 0;
  for (const point of series) {
    peakUsd = Math.max(peakUsd, point.balanceUsd);
    while (fi < ficTimeline.length && (ficTimeline[fi]?.tsMs ?? 0) <= point.tsMs) {
      cumFic = ficTimeline[fi]?.cum ?? cumFic;
      fi += 1;
    }
    const equity = point.balanceUsd + cumFic;
    peakTradingEquityUsd = Math.max(peakTradingEquityUsd, equity);
    runningPeak = Math.max(runningPeak, equity);
    if (runningPeak > 0) {
      maxDrawdownFraction = Math.max(maxDrawdownFraction, (runningPeak - equity) / runningPeak);
    }
  }

  const bornMs = agentState?.born_at
    ? Date.parse(agentState.born_at)
    : (cashSeries[0]?.tsMs ?? nowMs);
  const endMs = agentState?.died_at ? Date.parse(agentState.died_at) : nowMs;
  const elapsedMs = Math.max(endMs - bornMs, 0);
  // Burn rate the runway and the agent's desperation read from. Rent dominates and is a
  // deliberately-set recurring cost, so read its CURRENT level: the latest tick's amount
  // over the MEDIAN interval of recent ticks. Median, not the last gap, so a worker
  // restart placing two ticks seconds apart cannot annualize into an absurd rate; and not
  // a lifetime average, so a rent change shows within a tick or two. Variable costs (data
  // + x402) are sporadic, averaged over the life. Until there are enough ticks to trust
  // the cadence, fall back to the lifetime all-in average, which also keeps a newborn's
  // first few cents from annualizing into a huge $/h.
  const burnHours = Math.max(elapsedMs, HOUR_MS) / HOUR_MS;
  const recentRentTsMs = rentTsMs.slice(-21);
  const intervalsMs: number[] = [];
  for (let i = 1; i < recentRentTsMs.length; i += 1) {
    const prev = recentRentTsMs[i - 1];
    const curr = recentRentTsMs[i];
    if (prev !== undefined && curr !== undefined) intervalsMs.push(curr - prev);
  }
  let burnPerHourUsd: number;
  if (lastRentUsd !== null && intervalsMs.length >= 3) {
    const sorted = [...intervalsMs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianMs =
      sorted.length % 2 === 1
        ? (sorted[mid] ?? 0)
        : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    const rentPerHourUsd = medianMs > 0 ? lastRentUsd / (medianMs / HOUR_MS) : 0;
    const variablePerHourUsd = (burnUsd - rentTotalUsd) / burnHours;
    burnPerHourUsd = rentPerHourUsd + variablePerHourUsd;
  } else {
    burnPerHourUsd = burnUsd / burnHours;
  }
  const runway = (value: number): number =>
    burnPerHourUsd > 0 ? value / burnPerHourUsd : Number.POSITIVE_INFINITY;

  return {
    cashUsd,
    positionValueUsd,
    netWorthUsd,
    seedUsd,
    netPnlUsd: netWorthUsd - seedUsd,
    tradingPnlUsd: netWorthUsd - seedUsd + fictionalBurnUsd,
    tradingEquityUsd,
    peakUsd,
    peakTradingEquityUsd,
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
