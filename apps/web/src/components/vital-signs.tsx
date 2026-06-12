import type { Vitals } from 'shared';

import {
  formatPct,
  formatRunway,
  formatSignedPct,
  formatSignedUsd,
  formatUsd,
  vitality,
} from '@/lib/ui';

import { HeartbeatLine } from './heartbeat-line';

const STATES = ['STABLE', 'STRAINED', 'FINAL NOTICE'] as const;

// The competition's hard max-drawdown DQ line (worst peak-to-trough vs the
// net-worth high-water mark). Mirrors the worker's MAX_DRAWDOWN_FRACTION.
const DRAWDOWN_CAP = 0.3;

const clamp01 = (n: number): number => Math.max(0, Math.min(n, 1));

function statusLabel(vitals: Vitals): string {
  return vitals.alive ? vitality(vitals).label : 'EVICTED';
}

/** Net worth as a fraction of seed, clamped — how far it is above the eviction floor. */
function lifeFractionOf(vitals: Vitals): number {
  return vitals.seedUsd > 0 ? clamp01(vitals.netWorthUsd / vitals.seedUsd) : 0;
}

/** Share of net worth locked in open positions (illiquid). */
function lockedFractionOf(vitals: Vitals): number {
  return vitals.netWorthUsd > 0 ? vitals.positionValueUsd / vitals.netWorthUsd : 0;
}

function positionLabel(vitals: Vitals): string {
  const [first] = vitals.positions;
  if (vitals.positions.length === 1 && first) return first.token;
  return `${vitals.positions.length} positions`;
}

/** Amber once the cash runway shortens, red when a forced sale is imminent. */
function cashRunwayColor(hours: number): string | undefined {
  if (!Number.isFinite(hours) || hours >= 72) return undefined;
  if (hours >= 24) return '#f5c451';
  return '#ff5468';
}

/** Neutral with headroom, amber nearing the DQ line, red once the cap is breached. */
function drawdownColor(fraction: number): string | undefined {
  if (fraction >= DRAWDOWN_CAP) return '#ff5468';
  if (fraction >= DRAWDOWN_CAP * 0.67) return '#f5c451';
  return undefined;
}

/** True when most of net worth is locked in positions AND cash can't outlast the burn. */
function isAssetRichCashPoor(vitals: Vitals): boolean {
  return (
    vitals.positions.length > 0 &&
    lockedFractionOf(vitals) > 0.6 &&
    Number.isFinite(vitals.cashRunwayHours) &&
    vitals.cashRunwayHours < 48
  );
}

function StatusLadder({ current, hex }: { current: string; hex: string }) {
  return (
    <div className="font-display flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tracking-[0.18em]">
      {STATES.map((state, index) => {
        const active = state === current;
        return (
          <span key={state} className="flex items-center gap-2">
            <span
              className={active ? '' : 'text-muted/40'}
              style={active ? { color: hex } : undefined}
            >
              {active ? '● ' : ''}
              {state}
            </span>
            {index < STATES.length - 1 ? <span className="text-muted/30">·</span> : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Net worth split into liquid cash (bright) and value locked in positions (dim),
 * scaled against the seed. Deploying cash shrinks the bright segment and grows the
 * dim one — the total doesn't move. It only moves when P&L or burn changes net worth.
 */
function SplitBar({ vitals, hex, className }: { vitals: Vitals; hex: string; className?: string }) {
  const denom = Math.max(vitals.seedUsd, vitals.netWorthUsd, 1);
  const cashPct = clamp01(Math.max(0, vitals.cashUsd) / denom) * 100;
  const posPct = clamp01(Math.max(0, vitals.positionValueUsd) / denom) * 100;
  const seedPct = clamp01(vitals.seedUsd / denom) * 100;
  return (
    <div className={`bg-line relative w-full overflow-hidden rounded-sm ${className ?? 'h-2'}`}>
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{ width: `${cashPct}%`, backgroundColor: hex, boxShadow: `0 0 8px ${hex}` }}
      />
      <div
        className="absolute inset-y-0 transition-all duration-500"
        style={{ left: `${cashPct}%`, width: `${posPct}%`, backgroundColor: hex, opacity: 0.32 }}
      />
      <div
        className="absolute inset-y-0 w-px bg-white/30"
        style={{ left: `calc(${seedPct}% - 0.5px)` }}
      />
    </div>
  );
}

function SplitLegend({ vitals, hex }: { vitals: Vitals; hex: string }) {
  const holding = vitals.positions.length > 0;
  const deployed = vitals.netWorthUsd > 0 ? vitals.positionValueUsd / vitals.netWorthUsd : 0;
  return (
    <div className="text-muted flex items-center gap-x-2 text-xs">
      <span className="flex items-center gap-1.5">
        {/* Match the bar's tier colour (bright cash / dim locked), not a fixed green. */}
        <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: hex }} />
        cash <span className="text-ink tabular-nums">{formatUsd(vitals.cashUsd)}</span>
      </span>
      <span className="text-muted/40">·</span>
      <span className="tabular-nums">
        {formatPct(deployed, 0)} deployed
        {holding ? <span className="not-tabular-nums"> in {positionLabel(vitals)}</span> : null}
      </span>
      <span className="ml-auto tabular-nums">{formatUsd(vitals.seedUsd, 0)} seed</span>
    </div>
  );
}

/**
 * The runway clock — the moving headline of the slow part. Runway is derived from
 * burn (net worth ÷ burn), so they're one idea: runway is the number, burn its
 * sub-line, not two separate cells.
 */
function RunwayBlock({ vitals }: { vitals: Vitals }) {
  return (
    <div>
      <div className="font-display text-muted text-[10px] tracking-[0.2em] uppercase">
        Runway · until eviction
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="text-3xl leading-none font-semibold tabular-nums"
          style={{ color: cashRunwayColor(vitals.netWorthRunwayHours) }}
        >
          {formatRunway(vitals.netWorthRunwayHours)}
        </span>
        <span className="text-muted text-sm tabular-nums">
          · {formatUsd(vitals.burnPerHourUsd, 3)}/h burn
        </span>
      </div>
    </div>
  );
}

function ScoreItem({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string | undefined;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span>{label}</span>
      <span
        className={`tabular-nums ${valueColor ? '' : 'text-ink'}`}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * The box score — slow-changing record (peak, drawdown, age, trades) collapsed into
 * one dense strip of label·value pairs, like the stat line under an athlete's name.
 * It recedes so the eye lands on net worth + the runway clock above.
 */
function BoxScore({ vitals }: { vitals: Vitals }) {
  return (
    <div className="text-muted flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
      <ScoreItem label="peak" value={formatUsd(vitals.peakUsd)} />
      <span className="flex items-baseline gap-1.5">
        <span>drawdown</span>
        <span
          className={`tabular-nums ${drawdownColor(vitals.maxDrawdownFraction) ? '' : 'text-ink'}`}
          style={
            drawdownColor(vitals.maxDrawdownFraction)
              ? { color: drawdownColor(vitals.maxDrawdownFraction) }
              : undefined
          }
        >
          {formatPct(vitals.maxDrawdownFraction)}
        </span>
        <span className="text-muted/50 text-[10px]" title="Hackathon disqualification threshold">
          DQ&nbsp;{formatPct(DRAWDOWN_CAP, 0)}
        </span>
      </span>
      <ScoreItem label="alive" value={`${vitals.daysSurvived.toFixed(2)}d`} />
      <ScoreItem label="trades" value={String(vitals.tradeCount)} />
    </div>
  );
}

function AssetRichWarning({ vitals }: { vitals: Vitals }) {
  if (!isAssetRichCashPoor(vitals)) return null;
  const pct = Math.round(lockedFractionOf(vitals) * 100);
  return (
    <p className="border-amber/40 bg-amber/10 text-amber rounded border px-3 py-2 text-xs leading-snug">
      ⚠ Asset-rich, cash-poor — {pct}% locked in {positionLabel(vitals)}; may be forced to liquidate
      to make rent.
    </p>
  );
}

function PnlRow({ vitals }: { vitals: Vitals }) {
  const returnFraction = vitals.seedUsd > 0 ? vitals.netPnlUsd / vitals.seedUsd : 0;
  const color = vitals.netPnlUsd > 0 ? '#4ef0a0' : vitals.netPnlUsd < 0 ? '#ff5468' : '#6a7570';
  return (
    <div className="text-right">
      <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
        Net P&amp;L
      </div>
      <div className="text-lg tabular-nums" style={{ color }}>
        {formatSignedPct(returnFraction)}
      </div>
      <div className="text-muted text-xs tabular-nums">{formatSignedUsd(vitals.netPnlUsd)}</div>
    </div>
  );
}

/** Full vitals panel — the desktop left rail. */
export function VitalSigns({ vitals }: { vitals: Vitals }) {
  const v = vitality(vitals);
  const current = statusLabel(vitals);
  const lifeFraction = lifeFractionOf(vitals);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl tracking-[0.25em]">EVICTION&nbsp;NOTICE</h1>
        <div className="text-muted text-xs">autonomous agent · earning its keep</div>
      </div>

      <StatusLadder current={current} hex={v.hex} />

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
            Net worth
          </div>
          <div
            className="text-6xl leading-none font-semibold tabular-nums"
            style={{ color: vitals.alive ? v.hex : '#ff5468' }}
          >
            {formatUsd(vitals.netWorthUsd)}
          </div>
        </div>
        <PnlRow vitals={vitals} />
      </div>

      <div className="flex flex-col gap-2">
        <SplitBar vitals={vitals} hex={v.hex} />
        <SplitLegend vitals={vitals} hex={v.hex} />
      </div>

      <HeartbeatLine alive={vitals.alive} color={v.hex} health={lifeFraction} />

      <AssetRichWarning vitals={vitals} />

      {/* Box score: the slow-changing record, demoted below a divider so the live
          vitals above carry the eye. */}
      <div className="border-line flex flex-col gap-3 border-t pt-4">
        <RunwayBlock vitals={vitals} />
        <BoxScore vitals={vitals} />
      </div>
    </section>
  );
}

/**
 * Mobile header — pinned to the top so the live feed can be the scrolling body
 * beneath it. Carries the emotional core (net worth, status, split bar, pulse) and
 * escalates its top accent with status for ambient dread while you're in the feed.
 */
export function CompactVitals({ vitals }: { vitals: Vitals }) {
  const v = vitality(vitals);
  const current = statusLabel(vitals);
  const lifeFraction = lifeFractionOf(vitals);

  return (
    <header
      className="bg-bg/95 border-line sticky top-0 z-30 flex flex-col gap-2 border-t-2 border-b px-5 py-3 backdrop-blur"
      style={{ borderTopColor: v.hex }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm tracking-[0.2em]">EVICTION&nbsp;NOTICE</span>
        <span className="font-display text-[11px] tracking-[0.18em]" style={{ color: v.hex }}>
          ● {current}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <span
          className="text-4xl leading-none font-semibold tabular-nums"
          style={{ color: vitals.alive ? v.hex : '#ff5468' }}
        >
          {formatUsd(vitals.netWorthUsd)}
        </span>
        <span className="text-right">
          <span className="font-display text-muted block text-[9px] tracking-[0.2em] uppercase">
            Runway
          </span>
          <span
            className="text-sm tabular-nums"
            style={{ color: cashRunwayColor(vitals.netWorthRunwayHours) }}
          >
            {formatRunway(vitals.netWorthRunwayHours)}
          </span>
        </span>
      </div>
      <SplitBar vitals={vitals} hex={v.hex} className="h-1.5" />
      <SplitLegend vitals={vitals} hex={v.hex} />
      <HeartbeatLine alive={vitals.alive} color={v.hex} health={lifeFraction} className="h-7" />
      <AssetRichWarning vitals={vitals} />
    </header>
  );
}

/** Secondary vitals demoted below the feed on mobile — the detail, not the headline. */
export function SecondaryVitals({ vitals }: { vitals: Vitals }) {
  return (
    <div className="flex flex-col gap-3">
      <RunwayBlock vitals={vitals} />
      <BoxScore vitals={vitals} />
    </div>
  );
}
