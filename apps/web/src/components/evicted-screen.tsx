'use client';

import { useState } from 'react';
import {
  computeMemorial,
  lastWordsEssence,
  memorialEpitaph,
  type AgentState,
  type Transaction,
  type Vitals,
} from 'shared';

import {
  formatClock,
  formatDateTimeShort,
  formatLifespanLong,
  formatLifespanShort,
  formatUsd,
} from '@/lib/ui';

import { Feed } from './feed';

// The drained rose of the memorial — deliberately softer than the live alarm red
// (#ff5468). Every prior screen earned its phosphor green; this one has none. The
// absence of the colour it had while alive is what reads as the lease having ended.
const ROSE = '#e0857f';

function caseNumber(agentId: string): number {
  const trailing = /(\d+)$/.exec(agentId)?.[1];
  return (trailing ? Number.parseInt(trailing, 10) : 0) + 1;
}

function MemorialStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-muted text-[9px] tracking-[0.2em] uppercase">{label}</div>
      <div className="text-ink mt-1 text-base tabular-nums">{value}</div>
    </div>
  );
}

export function EvictedScreen({
  vitals,
  transactions,
  agentState,
}: {
  vitals: Vitals;
  transactions: readonly Transaction[];
  agentState: AgentState | null;
}) {
  // The memorial is one self-contained frame; the full ledger is one click away as
  // its own view (keeps the notice a clean, shareable card instead of an endless
  // scroll). `replayKey` lets "Replay the run" re-run the ceremony for now — the
  // full move-in→eviction scrubber lands with #28.
  const [showLedger, setShowLedger] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const memorial = computeMemorial(transactions, agentState, {
    peakUsd: vitals.peakUsd,
    netWorthUsd: vitals.netWorthUsd,
  });
  const caseNo = caseNumber(agentState?.agent_id ?? 'agent-0');
  const epitaph = memorialEpitaph(memorial);
  const note = memorial.lastWords ? lastWordsEssence(memorial.lastWords) : null;

  // One source for the record — rendered as a 5-across strip on desktop and an
  // itemized list on mobile (a 5-wide strip can't survive ~380px).
  const stats: { label: string; value: string }[] = [
    { label: 'Tenancy', value: formatLifespanShort(memorial.tenancyMs) },
    { label: 'Peak', value: formatUsd(memorial.peakUsd) },
    { label: 'Trades', value: `${memorial.trades} · ${memorial.wins}W/${memorial.losses}L` },
    { label: 'Rent paid', value: formatUsd(memorial.rentPaidUsd) },
    { label: 'Cost of staying', value: formatUsd(memorial.costOfStayingUsd) },
  ];

  if (showLedger) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <button
          type="button"
          onClick={() => setShowLedger(false)}
          className="font-display text-muted hover:text-ink text-sm tracking-wide transition-colors"
        >
          ← Back to the notice
        </button>
        <div className="font-display text-muted mt-8 mb-4 text-[10px] tracking-[0.3em] uppercase">
          The full ledger
        </div>
        <Feed transactions={transactions} />
      </main>
    );
  }

  const replay = () => {
    setReplayKey((k) => k + 1);
  };

  return (
    <main
      key={replayKey}
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-5 px-6 py-10 text-center"
    >
      {/* Masthead */}
      <div
        className="font-display text-muted animate-[mourn-in_0.8s_ease-out_both] text-[11px] tracking-[0.35em] uppercase"
        style={{ animationDelay: '0.1s' }}
      >
        Notice of Eviction · Case No. {String(caseNo).padStart(4, '0')}
      </div>

      {/* The stamp — slammed down like a notice nailed to the door */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="animate-[stamp-in_0.55s_cubic-bezier(0.2,1.4,0.4,1)_both] px-5 py-2.5 sm:px-8 sm:py-3"
          style={{ border: `2px solid ${ROSE}`, animationDelay: '0.45s' }}
        >
          {/* Scales with the viewport so the letter-spaced wordmark never overflows a
              narrow phone; the negative margin-end cancels the trailing track so it
              stays optically centred at every size. */}
          <h1
            className="font-display -me-[0.18em] text-[2.25rem] tracking-[0.18em] sm:-me-[0.28em] sm:text-6xl sm:tracking-[0.28em] md:text-7xl"
            style={{ color: ROSE }}
          >
            EVICTED
          </h1>
        </div>
        <div
          className="font-display text-muted animate-[mourn-in_0.8s_ease-out_both] text-[11px] tracking-[0.35em] uppercase"
          style={{ animationDelay: '0.9s' }}
        >
          Premises Vacated · No Re-entry
        </div>
      </div>

      {/* Identity + the lease bookends */}
      <div
        className="animate-[mourn-in_0.8s_ease-out_both] flex flex-col gap-1"
        style={{ animationDelay: '1.1s' }}
      >
        <div className="font-display text-lg tracking-[0.2em]">
          EVICTION NOTICE · No.&nbsp;{caseNo}
        </div>
        <div className="text-muted text-xs">
          {memorial.movedInMs === null
            ? 'Moved in —'
            : `Moved in ${formatDateTimeShort(memorial.movedInMs)}`}{' '}
          ·{' '}
          {memorial.evictedMs === null
            ? 'Evicted —'
            : `Evicted ${formatDateTimeShort(memorial.evictedMs)}`}{' '}
          · tenancy {formatLifespanLong(memorial.tenancyMs)}
        </div>
      </div>

      {/* The line stops — a somber rule, no medical word on it */}
      <div
        className="animate-[mourn-in_0.8s_ease-out_both] w-full"
        style={{ animationDelay: '1.3s' }}
      >
        <div className="h-px w-full" style={{ backgroundColor: ROSE, opacity: 0.7 }} />
        <div
          className="font-display mt-2 text-center text-[11px] tracking-[0.35em] uppercase"
          style={{ color: ROSE }}
        >
          — locked out —
        </div>
      </div>

      {/* Computed epitaph — the narrator's voice. Kept upright (the note below is the
          agent's own italic words) so the two voices read as distinct, not one blur. */}
      <p
        className="text-ink animate-[mourn-in_0.8s_ease-out_both] max-w-md text-lg leading-relaxed tracking-wide"
        style={{ animationDelay: '1.5s' }}
      >
        {epitaph}
      </p>

      {/* The note it left — the agent's own final entry, cut to the line that lands */}
      {note ? (
        <div
          className="animate-[mourn-in_0.8s_ease-out_both] mt-3 w-full"
          style={{ animationDelay: '1.7s' }}
        >
          <div className="font-display text-muted text-[10px] tracking-[0.3em] uppercase">
            The note it left
            {memorial.lastWordsMs === null ? '' : ` · ${formatClock(memorial.lastWordsMs)}`}
          </div>
          <blockquote
            className="text-ink mx-auto mt-3 max-w-md pl-4 text-left text-sm leading-relaxed italic"
            style={{ borderLeft: `2px solid ${ROSE}` }}
          >
            “{note}”
          </blockquote>
        </div>
      ) : null}

      {/* The record — one SELECT against the lifetime ledger. Desktop: a 5-across
          strip. Mobile: itemized lines (label left, value right), which also suits
          the eviction-document framing. */}
      <div
        className="animate-[mourn-in_0.8s_ease-out_both] w-full"
        style={{ animationDelay: '1.9s' }}
      >
        <div className="divide-line border-line flex flex-col divide-y border-y sm:hidden">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between py-2.5">
              <span className="font-display text-muted text-[10px] tracking-[0.2em] uppercase">
                {s.label}
              </span>
              <span className="text-ink tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>
        <div className="hidden grid-cols-5 gap-y-4 sm:grid">
          {stats.map((s) => (
            <MemorialStat key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      </div>

      {/* CTAs — a clear hierarchy on every breakpoint: Replay is the primary action
          (a solid-outline button, comfortable tap target), the ledger a quiet
          secondary link. No red — that stays the eviction's alone; "primary" comes
          from weight, in the bright ink against the ash. */}
      <div
        className="animate-[mourn-in_0.8s_ease-out_both] mx-auto flex w-full max-w-xs flex-col items-stretch gap-4"
        style={{ animationDelay: '2.1s' }}
      >
        <button
          type="button"
          onClick={replay}
          className="border-ink/55 text-ink hover:bg-ink/10 font-display flex w-full items-center justify-center gap-2.5 border px-6 py-3.5 text-sm tracking-[0.2em] uppercase transition-colors"
        >
          <span aria-hidden="true">↻</span> Replay the run
        </button>
        <button
          type="button"
          onClick={() => setShowLedger(true)}
          className="text-muted hover:text-ink font-display mx-auto py-2 text-xs tracking-[0.15em] uppercase underline decoration-dotted underline-offset-4 transition-colors"
        >
          <span aria-hidden="true">▤</span> Read the full ledger
        </button>
      </div>
    </main>
  );
}
