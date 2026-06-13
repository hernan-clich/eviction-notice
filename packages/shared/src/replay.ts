import type { Snapshot, Transaction } from './ledger.ts';
import { survivalTier } from './survival.ts';

/**
 * Replay pacing — pure math so the "highlight reel of a life" is testable and
 * deterministic. The replay re-animates the live dashboard from the recorded ledger
 * on a compressed clock; this builds the event-stepped schedule that maps real
 * playback time ↔ ledger time, lingering on the beats (trades, status drops, peak,
 * eviction) and compressing the dead air (idle holds, rent accrual) between them.
 */

/** Feed rows worth re-reading during replay — the thoughts and the trades, not the
 *  $0.01 metabolism noise (which still drives the balance, just not the feed). */
export const REPLAY_FEED_REASONS: ReadonlySet<string> = new Set([
  'seed',
  'decision',
  'trade_open',
  'trade_close',
]);

export function isReplayFeedReason(reason: string): boolean {
  return REPLAY_FEED_REASONS.has(reason);
}

export interface ReplaySchedule {
  /** Beat timestamps in ledger time, sorted, always bracketed by born + evicted. */
  keyframeMs: number[];
  /** Cumulative real playback ms at each keyframe (same length as keyframeMs). */
  realAtKeyframe: number[];
  totalRealMs: number;
  bornMs: number;
  evictedMs: number;
}

// Each ledger segment between beats plays for a real duration scaled from its span
// but clamped: short stretches still get a readable beat, long idle holds compress.
const MIN_SEGMENT_MS = 650;
const MAX_SEGMENT_MS = 4200;
const LEDGER_MS_PER_REAL_MS = 900; // before clamping: 900ms of life ≈ 1ms of playback

function seedOf(transactions: readonly Transaction[]): number {
  let seed = 0;
  for (const tx of transactions) if (tx.reason === 'seed') seed += tx.amount;
  return seed;
}

/** Collect the beats the reel should land on, as ledger timestamps. */
function beatTimes(
  transactions: readonly Transaction[],
  snapshots: readonly Snapshot[],
  bornMs: number,
  evictedMs: number,
): number[] {
  const seed = seedOf(transactions);
  const beats = new Set<number>([bornMs, evictedMs]);

  for (const tx of transactions) {
    if (tx.reason === 'trade_open' || tx.reason === 'trade_close') {
      const t = Date.parse(tx.ts);
      if (t >= bornMs && t <= evictedMs) beats.add(t);
    }
  }

  const ordered = [...snapshots].sort((a, b) => a.id - b.id);
  let prevTier: string | null = null;
  let peakValue = Number.NEGATIVE_INFINITY;
  let peakMs = bornMs;
  for (const snap of ordered) {
    const t = Date.parse(snap.ts);
    if (t < bornMs || t > evictedMs) continue;
    const tier = survivalTier(snap.net_worth_usd, seed);
    if (prevTier !== null && tier !== prevTier) beats.add(t); // a status escalation
    prevTier = tier;
    if (snap.net_worth_usd > peakValue) {
      peakValue = snap.net_worth_usd;
      peakMs = t;
    }
  }
  beats.add(peakMs);

  return [...beats].filter((t) => t >= bornMs && t <= evictedMs).sort((a, b) => a - b);
}

export function buildReplaySchedule(
  transactions: readonly Transaction[],
  snapshots: readonly Snapshot[],
  bounds: { bornMs: number; evictedMs: number },
): ReplaySchedule {
  const bornMs = bounds.bornMs;
  const evictedMs = Math.max(bounds.evictedMs, bounds.bornMs + 1);
  // beatTimes always seeds born + evicted, and evictedMs > bornMs, so this is ≥ 2.
  const keyframeMs = beatTimes(transactions, snapshots, bornMs, evictedMs);

  const realAtKeyframe = [0];
  for (let i = 1; i < keyframeMs.length; i += 1) {
    const span = (keyframeMs[i] ?? 0) - (keyframeMs[i - 1] ?? 0);
    const real = Math.min(MAX_SEGMENT_MS, Math.max(MIN_SEGMENT_MS, span / LEDGER_MS_PER_REAL_MS));
    realAtKeyframe.push((realAtKeyframe[i - 1] ?? 0) + real);
  }

  return {
    keyframeMs,
    realAtKeyframe,
    totalRealMs: realAtKeyframe.at(-1) ?? 0,
    bornMs,
    evictedMs,
  };
}

function lerpSegment(value: number, from: number[], to: number[]): number {
  if (value <= (from[0] ?? 0)) return to[0] ?? 0;
  const last = from.length - 1;
  if (value >= (from[last] ?? 0)) return to[last] ?? 0;
  for (let i = 1; i < from.length; i += 1) {
    const lo = from[i - 1] ?? 0;
    const hi = from[i] ?? 0;
    if (value <= hi) {
      const f = hi === lo ? 0 : (value - lo) / (hi - lo);
      const a = to[i - 1] ?? 0;
      const b = to[i] ?? 0;
      return a + (b - a) * f;
    }
  }
  return to[last] ?? 0;
}

/** Real playback ms → ledger ms (the clock position). */
export function ledgerAt(schedule: ReplaySchedule, realElapsedMs: number): number {
  return lerpSegment(realElapsedMs, schedule.realAtKeyframe, schedule.keyframeMs);
}

/** Ledger ms → real playback ms (for scrubbing: drop the playhead on the curve). */
export function realAt(schedule: ReplaySchedule, ledgerMs: number): number {
  return lerpSegment(ledgerMs, schedule.keyframeMs, schedule.realAtKeyframe);
}
