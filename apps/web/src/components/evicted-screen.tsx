'use client';

import { useState } from 'react';
import {
  computeMemorial,
  memorialEulogy,
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
import { HeartbeatLine } from './heartbeat-line';
import { Markdown } from './markdown';

// The drained rose of the memorial — deliberately softer than the live alarm red
// (#ff5468). Every prior screen earned its phosphor green; this one has none. The
// absence of the colour it had while alive is what reads as the life having left.
const ROSE = '#e0857f';

function caseNumber(agentId: string): number {
  const trailing = /(\d+)$/.exec(agentId)?.[1];
  return (trailing ? Number.parseInt(trailing, 10) : 0) + 1;
}

function MemorialStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-2 py-3 text-center">
      <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">{label}</div>
      <div
        className="mt-1.5 text-xl tabular-nums"
        style={accent ? { color: ROSE } : { color: '#cdd6d2' }}
      >
        {value}
      </div>
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
  // Lets the "Replay its life" CTA re-run the ceremony: bumping the key remounts the
  // block, replaying the stamp slam + staggered fade. (The full birth→death data
  // replay is #28; this replays the eviction moment.)
  const [replayKey, setReplayKey] = useState(0);

  const memorial = computeMemorial(transactions, agentState, {
    peakUsd: vitals.peakUsd,
    netWorthUsd: vitals.netWorthUsd,
  });
  const caseNo = caseNumber(agentState?.agent_id ?? 'agent-0');
  const eulogy = memorialEulogy(memorial);

  const replay = () => {
    setReplayKey((k) => k + 1);
    if (typeof globalThis !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="relative">
      <section
        key={replayKey}
        className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-9 px-6 py-20 text-center"
      >
        {/* Masthead */}
        <div
          className="font-display text-muted animate-[mourn-in_0.8s_ease-out_both] text-[11px] tracking-[0.35em] uppercase"
          style={{ animationDelay: '0.1s' }}
        >
          Notice of Eviction · Case No. {String(caseNo).padStart(4, '0')}
        </div>

        {/* The stamp — slammed down like a notice nailed to the door */}
        <div className="flex flex-col items-center gap-4">
          <div
            className="animate-[stamp-in_0.55s_cubic-bezier(0.2,1.4,0.4,1)_both] px-8 py-3"
            style={{ border: `2px solid ${ROSE}`, animationDelay: '0.45s' }}
          >
            <h1
              className="font-display text-6xl tracking-[0.28em] sm:text-7xl"
              style={{ color: ROSE, marginRight: '-0.28em' }}
            >
              EVICTED
            </h1>
          </div>
          <div
            className="font-display text-muted animate-[mourn-in_0.8s_ease-out_both] text-[11px] tracking-[0.35em] uppercase"
            style={{ animationDelay: '0.9s' }}
          >
            Premises Vacated · No Revival
          </div>
        </div>

        {/* Identity + bookends */}
        <div
          className="animate-[mourn-in_0.8s_ease-out_both] flex flex-col gap-1"
          style={{ animationDelay: '1.1s' }}
        >
          <div className="font-display text-lg tracking-[0.2em]">
            EVICTION NOTICE · No.&nbsp;{caseNo}
          </div>
          <div className="text-muted text-xs">
            {memorial.bornMs === null ? 'Born —' : `Born ${formatDateTimeShort(memorial.bornMs)}`} ·{' '}
            {memorial.diedMs === null
              ? 'Evicted —'
              : `Evicted ${formatDateTimeShort(memorial.diedMs)}`}{' '}
            · lived {formatLifespanLong(memorial.lifespanMs)}
          </div>
        </div>

        {/* Flatline */}
        <div
          className="animate-[mourn-in_0.8s_ease-out_both] w-full"
          style={{ animationDelay: '1.3s' }}
        >
          <HeartbeatLine alive={false} color={ROSE} />
          <div
            className="font-display mt-1 text-center text-[11px] tracking-[0.35em] uppercase"
            style={{ color: ROSE }}
          >
            — flatline —
          </div>
        </div>

        {/* Computed eulogy — solemn, specific, played straight */}
        <p
          className="text-ink animate-[mourn-in_0.8s_ease-out_both] max-w-md text-lg leading-relaxed italic"
          style={{ animationDelay: '1.5s' }}
        >
          {eulogy}
        </p>

        {/* Its own last words — the agent's final decision log, unedited */}
        {memorial.lastWords ? (
          <div
            className="animate-[mourn-in_0.8s_ease-out_both] w-full"
            style={{ animationDelay: '1.7s' }}
          >
            <div className="font-display text-muted text-[10px] tracking-[0.3em] uppercase">
              Its last words
              {memorial.lastWordsMs === null
                ? ''
                : ` · logged ${formatClock(memorial.lastWordsMs)}`}
            </div>
            <blockquote
              className="text-ink mx-auto mt-3 max-w-md pl-4 text-left text-sm leading-relaxed italic"
              style={{ borderLeft: `2px solid ${ROSE}` }}
            >
              <Markdown text={memorial.lastWords} />
            </blockquote>
          </div>
        ) : null}

        {/* The record — one SELECT against the lifetime ledger */}
        <div
          className="bg-line/60 animate-[mourn-in_0.8s_ease-out_both] grid w-full grid-cols-2 gap-px sm:grid-cols-3"
          style={{ animationDelay: '1.9s' }}
        >
          <div className="bg-bg">
            <MemorialStat label="Lifespan" value={formatLifespanShort(memorial.lifespanMs)} />
          </div>
          <div className="bg-bg">
            <MemorialStat label="Peak net worth" value={formatUsd(memorial.peakUsd)} />
          </div>
          <div className="bg-bg">
            <MemorialStat label="Cause of death" value={memorial.causeOfDeath} accent />
          </div>
          <div className="bg-bg">
            <MemorialStat
              label="Trades"
              value={`${memorial.trades} · ${memorial.wins}W / ${memorial.losses}L`}
            />
          </div>
          <div className="bg-bg">
            <MemorialStat label="Rent paid" value={formatUsd(memorial.rentPaidUsd)} />
          </div>
          <div className="bg-bg">
            <MemorialStat label="Spent to exist" value={formatUsd(memorial.spentToExistUsd)} />
          </div>
        </div>

        {/* CTAs */}
        <div
          className="font-display animate-[mourn-in_0.8s_ease-out_both] flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm"
          style={{ animationDelay: '2.1s' }}
        >
          <button
            type="button"
            onClick={replay}
            className="text-muted hover:text-ink underline decoration-dotted underline-offset-[6px] transition-colors"
          >
            ↻ Replay its life
          </button>
          <a
            href="#full-ledger"
            className="text-muted hover:text-ink underline decoration-dotted underline-offset-[6px] transition-colors"
          >
            ▤ Read the full ledger
          </a>
        </div>
      </section>

      {/* The full ledger — the evidence behind the memorial */}
      <section id="full-ledger" className="border-line mx-auto max-w-3xl border-t px-6 py-12">
        <div className="font-display text-muted mb-4 text-[10px] tracking-[0.3em] uppercase">
          The full ledger
        </div>
        <Feed transactions={transactions} />
      </section>
    </main>
  );
}
