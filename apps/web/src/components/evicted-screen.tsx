import type { Vitals } from 'shared';

import { formatSignedUsd, formatUsd } from '@/lib/ui';

import { HeartbeatLine } from './heartbeat-line';

function FinalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg px-5 py-4 text-center">
      <div className="font-display text-muted text-[10px] tracking-[0.2em] uppercase">{label}</div>
      <div className="mt-1 text-xl tabular-nums">{value}</div>
    </div>
  );
}

export function EvictedScreen({ vitals }: { vitals: Vitals }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6">
      <div className="w-full max-w-md opacity-70">
        <HeartbeatLine alive={false} color="#ff5468" />
      </div>

      <div className="text-center">
        <h1 className="text-alarm font-display animate-[alarm-flicker_3s_ease-in-out_infinite] text-7xl tracking-[0.3em]">
          EVICTED
        </h1>
        <p className="text-muted mt-4 text-sm">
          The agent ran out of runway. The run is over — no revivals.
        </p>
      </div>

      <div className="bg-line grid w-full max-w-md grid-cols-2 gap-px">
        <FinalStat label="Days survived" value={vitals.daysSurvived.toFixed(2)} />
        <FinalStat label="Peak net worth" value={formatUsd(vitals.peakUsd)} />
        <FinalStat label="Final P&L" value={formatSignedUsd(vitals.netPnlUsd)} />
        <FinalStat label="Trades" value={String(vitals.tradeCount)} />
      </div>
    </main>
  );
}
