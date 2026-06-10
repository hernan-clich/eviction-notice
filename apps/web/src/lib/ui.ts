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

/**
 * Vital-sign colour, driven by capital remaining — not idle burn. This agent is
 * killed by trading losses, not the rent clock, so "running out of money" is the
 * honest danger signal: how much life force is left as a fraction of its seed.
 */
export function vitality(balanceUsd: number, seedUsd: number): Vitality {
  const fraction = seedUsd > 0 ? balanceUsd / seedUsd : 0;
  if (fraction >= 0.6) return { hex: '#4ef0a0', label: 'STABLE' };
  if (fraction >= 0.3) return { hex: '#f5c451', label: 'STRAINED' };
  return { hex: '#ff5468', label: 'FINAL NOTICE' };
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
