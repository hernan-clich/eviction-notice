const MS_PER_HOUR = 3_600_000;

/**
 * Rent accrued (USD, positive magnitude) over an elapsed interval. Rent scales
 * with time, so changing the tick cadence does not change the burn rate.
 */
export function rentForInterval(rentPerHourUsd: number, intervalMs: number): number {
  return (rentPerHourUsd * intervalMs) / MS_PER_HOUR;
}
