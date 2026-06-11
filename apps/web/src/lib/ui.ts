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

const STABLE: Vitality = { hex: '#4ef0a0', label: 'STABLE' };
const STRAINED: Vitality = { hex: '#f5c451', label: 'STRAINED' };
const FINAL_NOTICE: Vitality = { hex: '#ff5468', label: 'FINAL NOTICE' };

/**
 * Status is the ONE life-or-death axis: net worth as a fraction of seed. Cash never
 * kills the agent directly — it can always liquidate to make rent — so cash pressure
 * is surfaced separately (the amber asset-rich/cash-poor warning + the cash-runway
 * stat), NOT promoted onto this death ladder. A 97%-net-worth agent is STABLE, even
 * if illiquid; it only trips FINAL NOTICE when net worth itself erodes (e.g. forced
 * sells whose friction eats it). One death axis, fed indirectly by the cash crunch.
 */
export function vitality(vitals: { netWorthUsd: number; seedUsd: number }): Vitality {
  const fraction = vitals.seedUsd > 0 ? vitals.netWorthUsd / vitals.seedUsd : 0;
  if (fraction >= 0.6) return STABLE;
  if (fraction >= 0.3) return STRAINED;
  return FINAL_NOTICE;
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
