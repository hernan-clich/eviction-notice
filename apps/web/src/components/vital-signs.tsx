import type { Vitals } from 'shared';

import { formatRunway, formatSignedUsd, formatUsd, vitality } from '@/lib/ui';

import { HeartbeatLine } from './heartbeat-line';

const STATES = ['STABLE', 'STRAINED', 'FINAL NOTICE'] as const;

/** Balance as a fraction of seed, clamped to 0..1 — the agent's remaining life force. */
function lifeFractionOf(vitals: Vitals): number {
  const denom = vitals.seedUsd || vitals.balanceUsd || 1;
  return Math.max(0, Math.min(vitals.balanceUsd / denom, 1));
}

function statusLabel(vitals: Vitals, label: string): string {
  return vitals.alive ? label : 'EVICTED';
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
  valueColor?: string;
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

function LifeBar({
  fraction,
  hex,
  className,
}: {
  fraction: number;
  hex: string;
  className?: string;
}) {
  return (
    <div className={`bg-line w-full overflow-hidden ${className ?? 'h-2'}`}>
      <div
        className="h-full transition-[width] duration-500"
        style={{
          width: `${(fraction * 100).toFixed(1)}%`,
          backgroundColor: hex,
          boxShadow: `0 0 8px ${hex}`,
        }}
      />
    </div>
  );
}

function PnlRow({ vitals }: { vitals: Vitals }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
        Net P&amp;L
      </span>
      <span
        className="text-lg tabular-nums"
        style={{ color: vitals.netPnlUsd >= 0 ? '#4ef0a0' : '#ff5468' }}
      >
        {formatSignedUsd(vitals.netPnlUsd)}
      </span>
    </div>
  );
}

function StatGrid({ vitals }: { vitals: Vitals }) {
  return (
    <div className="bg-line grid grid-cols-2 gap-px">
      <Stat label="Runway" value={formatRunway(vitals.runwayHours)} sub="at idle burn" />
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
  const v = vitality(vitals.balanceUsd, vitals.seedUsd);
  const current = statusLabel(vitals, v.label);
  const lifeFraction = lifeFractionOf(vitals);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl tracking-[0.25em]">EVICTION&nbsp;NOTICE</h1>
        <div className="text-muted text-xs">autonomous agent · earning its keep</div>
      </div>

      <StatusLadder current={current} hex={v.hex} />

      <div>
        <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
          Balance · life force
        </div>
        <div
          className="text-6xl leading-none font-semibold tabular-nums"
          style={{ color: vitals.alive ? v.hex : '#ff5468' }}
        >
          {formatUsd(vitals.balanceUsd)}
        </div>
      </div>

      <PnlRow vitals={vitals} />
      <LifeBar fraction={lifeFraction} hex={v.hex} />
      <HeartbeatLine alive={vitals.alive} color={v.hex} health={lifeFraction} />
      <StatGrid vitals={vitals} />
    </section>
  );
}

/**
 * Mobile header — pinned to the top so the live feed can be the scrolling body
 * beneath it. Carries only the emotional core (balance, status, runway, life bar)
 * and escalates its top accent with the status, so a creeping red bar gives ambient
 * dread even while you're deep in the feed.
 */
export function CompactVitals({ vitals }: { vitals: Vitals }) {
  const v = vitality(vitals.balanceUsd, vitals.seedUsd);
  const current = statusLabel(vitals, v.label);
  const lifeFraction = lifeFractionOf(vitals);

  return (
    <header
      className="bg-bg/95 border-line sticky top-0 z-30 border-t-2 border-b px-5 py-3 backdrop-blur"
      style={{ borderTopColor: v.hex }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm tracking-[0.2em]">EVICTION&nbsp;NOTICE</span>
        <span className="font-display text-[11px] tracking-[0.18em]" style={{ color: v.hex }}>
          ● {current}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span
          className="text-4xl leading-none font-semibold tabular-nums"
          style={{ color: vitals.alive ? v.hex : '#ff5468' }}
        >
          {formatUsd(vitals.balanceUsd)}
        </span>
        <span className="text-right">
          <span className="font-display text-muted block text-[9px] tracking-[0.2em] uppercase">
            Runway
          </span>
          <span className="text-sm tabular-nums">{formatRunway(vitals.runwayHours)}</span>
        </span>
      </div>
      <div className="mt-2">
        <HeartbeatLine alive={vitals.alive} color={v.hex} health={lifeFraction} className="h-7" />
      </div>
      <LifeBar fraction={lifeFraction} hex={v.hex} className="mt-2 h-1.5" />
    </header>
  );
}

/** Secondary vitals demoted below the feed on mobile — the detail, not the headline. */
export function SecondaryVitals({ vitals }: { vitals: Vitals }) {
  return (
    <div className="flex flex-col gap-5">
      <PnlRow vitals={vitals} />
      <StatGrid vitals={vitals} />
    </div>
  );
}
