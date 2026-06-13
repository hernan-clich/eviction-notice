'use client';

import { useRef } from 'react';
import { survivalTier, type ReplaySchedule, type Vitals } from 'shared';

import { formatLifespanLong } from '@/lib/ui';
import type { ReplaySpeed } from '@/lib/use-replay-clock';

import { PauseIcon, PlayIcon } from './icons';

const TIER_HEX: Record<ReturnType<typeof survivalTier>, string> = {
  stable: '#4ef0a0',
  strained: '#f5c451',
  'final-notice': '#ff5468',
};
const ROSE = '#e0493e';
const W = 1000;
const H = 120;
const PADY = 16;
const SPEEDS: ReplaySpeed[] = [1, 2, 4];

/**
 * The transport IS the life: the lifetime net-worth curve doubles as the scrubber.
 * Colour traces the status history (green→amber→red, so the escalations read without
 * labels), the played portion is solid and the future ghosted, and you grab anywhere
 * to seek. The whole shape of the run — quick rise to peak, long red bleed to zero —
 * is legible at a glance.
 */
export function ReplayTransport({
  vitals,
  schedule,
  clockMs,
  playing,
  speed,
  caseNo,
  onToggle,
  onSpeed,
  onSeek,
  onExit,
}: {
  vitals: Vitals;
  schedule: ReplaySchedule;
  clockMs: number;
  playing: boolean;
  speed: ReplaySpeed;
  caseNo: number;
  onToggle: () => void;
  onSpeed: (s: ReplaySpeed) => void;
  onSeek: (ledgerMs: number) => void;
  onExit: () => void;
}) {
  const curveRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const born = schedule.bornMs;
  const span = Math.max(schedule.evictedMs - born, 1);
  const series = vitals.series.length > 0 ? vitals.series : [{ tsMs: born, balanceUsd: 0 }];
  const ceil = Math.max(vitals.seedUsd, ...series.map((p) => p.balanceUsd), 1) * 1.05;
  const hasCurve = series.length >= 2; // markers/peak are meaningless on a single point

  const xAt = (tsMs: number) => ((tsMs - born) / span) * W;
  const yAt = (bal: number) => H - PADY - (bal / ceil) * (H - 2 * PADY);
  const pts = series.map((p) => ({ x: xAt(p.tsMs), y: yAt(p.balanceUsd), p }));

  const playheadX = xAt(clockMs);
  const playheadPct = (playheadX / W) * 100;

  // Net worth at the playhead (interpolated) — for the handle dot's height.
  let headY = pts[0]?.y ?? H - PADY;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (clockMs >= a.p.tsMs && clockMs <= b.p.tsMs) {
      const f = b.p.tsMs === a.p.tsMs ? 0 : (clockMs - a.p.tsMs) / (b.p.tsMs - a.p.tsMs);
      headY = a.y + (b.y - a.y) * f;
      break;
    }
    if (clockMs > b.p.tsMs) headY = b.y;
  }

  let peak = pts[0]!;
  for (const q of pts) if (q.p.balanceUsd > peak.p.balanceUsd) peak = q;
  const finalNotice = pts.find(
    (q) => survivalTier(q.p.balanceUsd, vitals.seedUsd) === 'final-notice',
  );

  const seekFromClientX = (clientX: number) => {
    const el = curveRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(born + frac * span);
  };

  return (
    <div className="bg-bg/95 border-line shrink-0 border-t backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 sm:py-4">
        {/* It's a memory, not a revival — the badge keeps the recording honest. */}
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="font-display flex items-center gap-2 text-[11px] tracking-[0.3em]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ROSE }} />
            <span style={{ color: ROSE }}>REPLAY</span>
          </span>
          <div className="flex items-center gap-4">
            {/* The verbose title is desktop-only — on mobile it crowds the badge + Close. */}
            <span className="font-display text-muted hidden text-[11px] tracking-[0.2em] uppercase sm:inline">
              The life of Eviction Notice · No.&nbsp;{caseNo}
            </span>
            {/* Exit even when paused — a paused replay must never be a dead end. */}
            <button
              type="button"
              onClick={onExit}
              className="font-display text-muted hover:text-ink text-[11px] tracking-[0.2em] whitespace-nowrap uppercase transition-colors"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* The curve = the scrubber */}
        <div
          ref={curveRef}
          className="relative h-24 w-full touch-none cursor-pointer select-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            draggingRef.current = true;
            seekFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) seekFromClientX(e.clientX);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {/* baseline at the eviction floor */}
            <line
              x1={0}
              y1={H - PADY}
              x2={W}
              y2={H - PADY}
              stroke="#2c3936"
              strokeWidth={1}
              strokeDasharray="4 6"
            />
            {/* status-coloured segments; future of the playhead is ghosted */}
            {pts.slice(1).map((q, i) => {
              const a = pts[i]!;
              const tier = survivalTier(a.p.balanceUsd, vitals.seedUsd);
              const future = a.x > playheadX;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={q.x}
                  y2={q.y}
                  stroke={TIER_HEX[tier]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={future ? 0.28 : 1}
                />
              );
            })}
            {finalNotice ? (
              <line
                x1={finalNotice.x}
                y1={0}
                x2={finalNotice.x}
                y2={H}
                stroke={TIER_HEX['final-notice']}
                strokeWidth={1}
                strokeDasharray="3 5"
                opacity={0.5}
              />
            ) : null}
            {hasCurve ? (
              <circle
                cx={peak.x}
                cy={peak.y}
                r={3.5}
                fill={TIER_HEX.stable}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {/* playhead */}
            <line
              x1={playheadX}
              y1={0}
              x2={playheadX}
              y2={H}
              stroke="#cdd6d2"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Screen-space handle dot (a perfect circle despite the stretched SVG) */}
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={{ left: `${playheadPct}%`, top: `${(headY / H) * 100}%` }}
          />

          {/* annotations */}
          {hasCurve ? (
            <span
              className="text-muted pointer-events-none absolute top-0 -translate-x-1/2 text-[9px] tracking-wider"
              style={{ left: `${(peak.x / W) * 100}%` }}
            >
              peak
            </span>
          ) : null}
          {finalNotice ? (
            <span
              className="pointer-events-none absolute top-0 text-[9px] tracking-wider"
              style={{ left: `${(finalNotice.x / W) * 100}%`, color: TIER_HEX['final-notice'] }}
            >
              &nbsp;final notice
            </span>
          ) : null}
          <span className="text-muted pointer-events-none absolute bottom-0 left-0 text-[9px] tracking-wider">
            move in
          </span>
          <span
            className="pointer-events-none absolute right-0 bottom-0 text-[9px] tracking-wider"
            style={{ color: ROSE }}
          >
            evicted
          </span>
        </div>

        {/* controls — one row on desktop; on narrow phones the timestamp drops to its
            own line (order + basis-full) so the speed buttons never get pushed off. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="border-line text-ink hover:bg-ink/10 order-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors"
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>

          <span className="text-muted font-display order-3 basis-full text-center text-[11px] whitespace-nowrap tracking-wider tabular-nums sm:order-2 sm:basis-auto sm:text-left sm:text-xs">
            T+{formatLifespanLong(Math.max(0, clockMs - born))} / {formatLifespanLong(span)}
          </span>

          <div className="font-display order-2 flex shrink-0 gap-1.5 text-xs sm:order-3">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeed(s)}
                className={`rounded-md border px-2 py-1 tracking-wider transition-colors sm:px-2.5 ${
                  s === speed ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
