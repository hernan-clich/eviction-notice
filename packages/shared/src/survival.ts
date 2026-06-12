/**
 * Survival tiers + desperation — the agent's emotional state as a function of how
 * close it is to eviction. Net worth as a fraction of seed is the single driver,
 * shared by the dashboard (tier label + colour), the worker prompt (how urgent the
 * agent sounds), and the sizing skill (how far it'll lower its edge bar and spend
 * its rent reserve). One definition here → all three stay in lockstep.
 */

export type SurvivalTier = 'stable' | 'strained' | 'final-notice';

/** STABLE ≥ 60% of seed; STRAINED ≥ 30%; below that it's on FINAL NOTICE. */
export function survivalTier(netWorthUsd: number, seedUsd: number): SurvivalTier {
  const fraction = seedUsd > 0 ? netWorthUsd / seedUsd : 0;
  if (fraction >= 0.6) return 'stable';
  if (fraction >= 0.3) return 'strained';
  return 'final-notice';
}

/**
 * Desperation in [0, 1]: 0 while comfortable (≥ 60% of seed), ramping linearly to
 * 1 as net worth approaches zero. Calm when healthy, all-in at the brink — the
 * rational response to certain death is to lower the bar for action, not hoard.
 */
export function survivalDesperation(netWorthUsd: number, seedUsd: number): number {
  const fraction = seedUsd > 0 ? netWorthUsd / seedUsd : 0;
  return Math.max(0, Math.min(1, (0.6 - fraction) / 0.6));
}
