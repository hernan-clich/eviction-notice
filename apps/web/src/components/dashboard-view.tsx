import type { ReactNode } from 'react';
import type { Transaction, Vitals } from 'shared';

import { vitality } from '@/lib/ui';

import { Feed } from './feed';
import { Sparkline } from './sparkline';
import { CompactVitals, SecondaryVitals, VitalSigns } from './vital-signs';

/**
 * The dashboard layout, source-agnostic: hand it derived vitals + the feed rows and
 * it renders. The live page wires Supabase Realtime to it; the replay wires a clock
 * over the recorded ledger to the very same view — so "the replay is the dashboard,
 * reanimated" is literally true, not a parallel screen.
 */
export function DashboardView({
  vitals,
  transactions,
  banner = null,
  feedLabel = 'Live feed',
  embedded = false,
}: {
  vitals: Vitals;
  transactions: readonly Transaction[];
  banner?: ReactNode;
  feedLabel?: string;
  /** Fill the parent (a bounded, scrollable frame) instead of the viewport — used by
   *  the replay, which pins a transport below and scrolls the dashboard between. */
  embedded?: boolean;
}) {
  // Live: own the viewport (min-h-screen / h-screen). Embedded: fill the scroll frame.
  const mobileWrap = embedded ? 'flex flex-col md:hidden' : 'flex min-h-screen flex-col md:hidden';
  const desktopHeight = embedded ? 'md:h-full' : 'md:h-screen';
  const sparklineColor = vitality(vitals).hex;
  const chart = (
    <div>
      <div className="font-display text-muted mb-3 text-[10px] tracking-[0.25em] uppercase">
        Net worth · lifetime
      </div>
      <Sparkline series={vitals.series} color={sparklineColor} seedUsd={vitals.seedUsd} />
    </div>
  );
  const label = (
    <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">
      {feedLabel}
    </div>
  );

  return (
    <>
      {/* Mobile: pinned compact vitals, feed as the scrolling body, detail demoted below it. */}
      <div className={mobileWrap}>
        <CompactVitals vitals={vitals} />
        <section className="flex flex-col gap-3 px-5 py-6">
          {label}
          <Feed transactions={transactions} />
        </section>
        <div className="border-line flex flex-col gap-6 border-t px-5 py-7">
          <SecondaryVitals vitals={vitals} />
          {chart}
          {banner}
        </div>
      </div>

      {/* Desktop: vitals rail beside a full-height, independently-scrolling feed. */}
      <div
        className={`mx-auto hidden max-w-7xl md:grid ${desktopHeight} md:grid-cols-[minmax(340px,440px)_1fr] md:overflow-hidden`}
      >
        <aside className="border-line pane-scroll flex animate-[reveal_0.5s_ease-out] flex-col gap-5 px-7 py-7 md:overflow-y-auto md:border-r">
          <VitalSigns vitals={vitals} />
          {chart}
          {banner}
        </aside>

        <section className="flex min-h-0 flex-col px-7 py-8 md:overflow-hidden">
          <div className="border-line shrink-0 border-b pb-3 md:pr-4">{label}</div>
          <div className="pane-scroll md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-4">
            <Feed transactions={transactions} />
          </div>
        </section>
      </div>
    </>
  );
}
