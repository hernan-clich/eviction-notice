import type { Vitals } from 'shared';

import { formatRunway, formatSignedUsd, formatUsd, vitality } from '@/lib/ui';

import { HeartbeatLine } from './heartbeat-line';

const STATES = ['STABLE', 'STRAINED', 'FINAL NOTICE'] as const;

const clamp01 = (n: number): number => Math.max(0, Math.min(n, 1));

function statusLabel(vitals: Vitals): string {
  return vitals.alive ? vitality(vitals).label : 'EVICTED';
}

/** Net worth as a fraction of seed, clamped — the agent's remaining life force. */
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

/** True when most of net worth is locked in positions AND cash can't outlast the burn. */
function isAssetRichCashPoor(vitals: Vitals): boolean {
  return (
    vitals.positions.length > 0 &&
    lockedFractionOf(vitals) > 0.6 &&
    Number.isFinite(vitals.cashRunwayHours) &&
    vitals.cashRunwayHours < 48
  );
}

function Stat({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string | undefined;
}) {
  return (
    <div className="bg-bg px-4 py-3">
      <div className="font-display text-muted text-[10px] tracking-[0.2em] uppercase">{label}</div>
      <div
        className="mt-1 text-lg tabular-nums"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="text-muted text-xs">{sub}</div> : null}
    </div>
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
  const hasPosition = vitals.positions.length > 0;
  return (
    <div className="text-muted flex items-center gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        {/* Match the bar's tier colour (bright cash / dim locked), not a fixed green. */}
        <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: hex }} />
        cash <span className="text-ink tabular-nums">{formatUsd(vitals.cashUsd)}</span>
      </span>
      {hasPosition ? (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: hex, opacity: 0.4 }}
          />
          in {positionLabel(vitals)}{' '}
          <span className="text-ink tabular-nums">{formatUsd(vitals.positionValueUsd)}</span>
        </span>
      ) : null}
      <span className="ml-auto tabular-nums">{formatUsd(vitals.seedUsd, 0)} seed</span>
    </div>
  );
}

function LiquidityPanel({ vitals }: { vitals: Vitals }) {
  return (
    <div className="bg-line grid grid-cols-2 gap-px">
      <Stat label="Liquid" value={formatUsd(vitals.cashUsd)} sub="to pay rent & open trades" />
      <Stat
        label="Cash runway"
        value={formatRunway(vitals.cashRunwayHours)}
        sub="before forced to sell"
        valueColor={cashRunwayColor(vitals.cashRunwayHours)}
      />
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
  return (
    <div className="text-right">
      <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
        Net P&amp;L
      </div>
      <div
        className="text-lg tabular-nums"
        style={{ color: vitals.netPnlUsd >= 0 ? '#4ef0a0' : '#ff5468' }}
      >
        {formatSignedUsd(vitals.netPnlUsd)}
      </div>
    </div>
  );
}

function StatGrid({ vitals }: { vitals: Vitals }) {
  return (
    <div className="bg-line grid grid-cols-2 gap-px">
      <Stat
        label="Runway"
        value={formatRunway(vitals.netWorthRunwayHours)}
        sub="net worth at burn"
      />
      <Stat label="Burn" value={`${formatUsd(vitals.burnPerHourUsd, 3)}/h`} sub="rent + data" />
      <Stat label="Alive" value={`${vitals.daysSurvived.toFixed(2)}d`} sub="since birth" />
      <Stat
        label="Trades"
        value={String(vitals.tradeCount)}
        sub={`peak ${formatUsd(vitals.peakUsd)}`}
      />
    </div>
  );
}

/** Full vitals panel — the desktop left rail. */
export function VitalSigns({ vitals }: { vitals: Vitals }) {
  const v = vitality(vitals);
  const current = statusLabel(vitals);
  const lifeFraction = lifeFractionOf(vitals);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl tracking-[0.25em]">EVICTION&nbsp;NOTICE</h1>
        <div className="text-muted text-xs">autonomous agent · earning its keep</div>
      </div>

      <StatusLadder current={current} hex={v.hex} />

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
            Net worth · life force
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

      <LiquidityPanel vitals={vitals} />
      <AssetRichWarning vitals={vitals} />
      <StatGrid vitals={vitals} />
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
            Cash runway
          </span>
          <span
            className="text-sm tabular-nums"
            style={{ color: cashRunwayColor(vitals.cashRunwayHours) }}
          >
            {formatRunway(vitals.cashRunwayHours)}
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
    <div className="flex flex-col gap-5">
      <LiquidityPanel vitals={vitals} />
      <StatGrid vitals={vitals} />
    </div>
  );
}
