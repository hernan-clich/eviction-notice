/** Presentation helpers for the vital-signs UI. */

export function formatUsd(value: number, decimals = 2): string {
  return `$${value.toFixed(decimals)}`;
}

export function formatSignedUsd(value: number): string {
  const sign = value < 0 ? '-' : '+';
  const abs = Math.abs(value);
  const decimals = abs > 0 && abs < 0.01 ? 6 : 2;
  return `${sign}$${abs.toFixed(decimals)}`;
}

/** Time-to-death, shown as a death clock: days when comfortable, hours when close. */
export function formatRunway(hours: number): string {
  if (!Number.isFinite(hours)) return '∞';
  return hours >= 48 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
}

export interface Vitality {
  hex: string;
  label: string;
}

interface Tier extends Vitality {
  rank: number; // higher = worse
}

const STABLE: Tier = { hex: '#4ef0a0', label: 'STABLE', rank: 0 };
const STRAINED: Tier = { hex: '#f5c451', label: 'STRAINED', rank: 1 };
const FINAL_NOTICE: Tier = { hex: '#ff5468', label: 'FINAL NOTICE', rank: 2 };

/** Net-worth depletion — how much life force is left as a fraction of the seed. */
function netWorthTier(netWorthUsd: number, seedUsd: number): Tier {
  const fraction = seedUsd > 0 ? netWorthUsd / seedUsd : 0;
  if (fraction >= 0.6) return STABLE;
  if (fraction >= 0.3) return STRAINED;
  return FINAL_NOTICE;
}

/** Cash-runway pressure — hours of liquidity before the agent is forced to sell. */
function cashTier(cashRunwayHours: number): Tier {
  if (!Number.isFinite(cashRunwayHours) || cashRunwayHours >= 72) return STABLE;
  if (cashRunwayHours >= 24) return STRAINED;
  return FINAL_NOTICE;
}

/**
 * Status tracks whichever truth is worse: net-worth depletion (it's genuinely
 * losing) or cash runway (it's about to be forced to liquidate to make rent). So a
 * cash crunch can push it to FINAL NOTICE even while net worth still looks healthy.
 */
export function vitality(vitals: {
  netWorthUsd: number;
  seedUsd: number;
  cashRunwayHours: number;
}): Vitality {
  const nw = netWorthTier(vitals.netWorthUsd, vitals.seedUsd);
  const cash = cashTier(vitals.cashRunwayHours);
  const worst = cash.rank > nw.rank ? cash : nw;
  return { hex: worst.hex, label: worst.label };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Feed timestamp relative to birth (T+2.1d), falling back to clock time if birth is unknown. */
export function formatFeedTime(tsIso: string, bornMs: number | null): string {
  if (bornMs === null) {
    return new Date(tsIso).toLocaleTimeString();
  }
  const elapsed = Math.max(Date.parse(tsIso) - bornMs, 0);
  if (elapsed >= DAY_MS) return `T+${(elapsed / DAY_MS).toFixed(1)}d`;
  if (elapsed >= HOUR_MS) return `T+${(elapsed / HOUR_MS).toFixed(1)}h`;
  return `T+${Math.round(elapsed / 60_000)}m`;
}
