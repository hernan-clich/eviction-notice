/** Presentation helpers for the vital-signs UI. */

import { survivalTier, type SurvivalTier } from 'shared';

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

const TIERS: Record<SurvivalTier, Vitality> = {
  stable: { hex: '#4ef0a0', label: 'STABLE' },
  strained: { hex: '#f5c451', label: 'STRAINED' },
  'final-notice': { hex: '#ff5468', label: 'FINAL NOTICE' },
};

/**
 * Status is the ONE life-or-death axis: net worth as a fraction of seed (the shared
 * `survivalTier`, the same driver the agent's desperation reads). Cash never kills
 * the agent directly — it can always liquidate to make rent — so cash pressure is
 * surfaced separately (the amber asset-rich/cash-poor warning + the cash-runway
 * stat), NOT promoted onto this death ladder.
 */
export function vitality(vitals: { netWorthUsd: number; seedUsd: number }): Vitality {
  return TIERS[survivalTier(vitals.netWorthUsd, vitals.seedUsd)];
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Absolute feed timestamp, split into an unambiguous date + local clock time. The
 * agent pays rent across days, so each row needs the date — and `DD-Mon-YYYY`
 * (e.g. `12-Jun-2026`) reads the same everywhere, dodging the MM/DD vs DD/MM trap.
 */
export function formatFeedTimestamp(tsIso: string): { date: string; time: string } {
  const d = new Date(tsIso);
  const date = `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return { date, time };
}
