'use client';

import { useEffect, useRef, useState } from 'react';
import { computeVitals, type AgentState, type Snapshot, type Transaction } from 'shared';

import { DeathTransition } from '@/components/death-transition';
import { EvictedScreen } from '@/components/evicted-screen';
import { Feed } from '@/components/feed';
import { Sparkline } from '@/components/sparkline';
import { CompactVitals, SecondaryVitals, VitalSigns } from '@/components/vital-signs';
import { realtimeLedgerSource } from '@/lib/ledger-source';
import { vitality } from '@/lib/ui';

const AGENT_ID = 'agent-0';

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 'live' → the dashboard; 'dying' → the death-beat transition (only when we
  // witness the agent cross into death); 'evicted' → the memorial.
  const [phase, setPhase] = useState<'live' | 'dying' | 'evicted'>('live');
  const sawAliveRef = useRef(false);
  const previewRef = useRef(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    const load = async () => {
      try {
        const data = await realtimeLedgerSource.load(AGENT_ID);
        if (!active) return;
        setTransactions(data.transactions);
        setAgentState(data.agentState);
        setSnapshots(data.snapshots);
        setLoadError(null); // recovered — clear any stale error from a dropped connection
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      }
    };

    const subscribe = () => {
      unsubscribe?.();
      unsubscribe = realtimeLedgerSource.subscribe(AGENT_ID, {
        onTransaction: (tx) => {
          setTransactions((prev) => (prev.some((t) => t.id === tx.id) ? prev : [...prev, tx]));
        },
        onAgentState: (state) => {
          setAgentState(state);
        },
        onSnapshot: (snap) => {
          setSnapshots((prev) => (prev.some((s) => s.id === snap.id) ? prev : [...prev, snap]));
        },
      });
    };

    void load();
    subscribe();

    // Supabase Realtime drops its socket when the tab is backgrounded, the machine
    // sleeps, or the network changes — and it does NOT replay rows missed while
    // disconnected, so the feed silently goes stale until a manual refresh. When the
    // tab comes back to life, refetch to catch up AND rebuild the channel on a fresh
    // socket. Debounced because focus/online/visible often fire together on wake.
    let lastResync = 0;
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastResync < 1500) return;
      lastResync = now;
      void load();
      subscribe();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resync();
    };
    globalThis.addEventListener('focus', resync);
    globalThis.addEventListener('online', resync);
    document.addEventListener('visibilitychange', onVisibility);

    const ticker = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      active = false;
      unsubscribe?.();
      clearInterval(ticker);
      globalThis.removeEventListener('focus', resync);
      globalThis.removeEventListener('online', resync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const vitals = computeVitals(transactions, agentState, nowMs, snapshots);

  // `?preview=death` forces the death beat regardless of lifecycle — the only way
  // to watch it without staging a real live crossover (and handy for the demo).
  useEffect(() => {
    if (new URLSearchParams(globalThis.location.search).get('preview') === 'death') {
      previewRef.current = true;
      sawAliveRef.current = true;
      setPhase('dying');
    }
  }, []);

  // Drive the phase off the lifecycle. We only play the death beat when the agent
  // was alive in this session and then crossed over; loading an already-evicted
  // agent (never saw it alive) lands straight on the memorial.
  const status = agentState?.status;
  useEffect(() => {
    if (previewRef.current) return;
    if (status === 'alive') {
      sawAliveRef.current = true;
      setPhase('live');
    } else if (status === 'dead') {
      setPhase(sawAliveRef.current ? 'dying' : 'evicted');
    }
  }, [status]);

  if (phase === 'evicted') {
    return (
      <div className="crt">
        <EvictedScreen vitals={vitals} transactions={transactions} agentState={agentState} />
      </div>
    );
  }

  const sparklineColor = vitality(vitals).hex;
  const chart = (
    <div>
      <div className="font-display text-muted mb-3 text-[10px] tracking-[0.25em] uppercase">
        Net worth · lifetime
      </div>
      <Sparkline series={vitals.series} color={sparklineColor} seedUsd={vitals.seedUsd} />
    </div>
  );
  const feedLabel = (
    <div className="font-display text-muted text-[10px] tracking-[0.25em] uppercase">Live feed</div>
  );
  const errorBanner = loadError ? (
    <p className="border-alarm/40 bg-alarm/10 text-alarm rounded border px-3 py-2 text-sm">
      {loadError}
    </p>
  ) : null;

  return (
    <div className="crt">
      {/* The death beat plays over the final live frame, dissolving it to black before
          the memorial takes over. The eviction red matches the EVICTED stamp. */}
      {phase === 'dying' ? (
        <DeathTransition color="#e0493e" onDone={() => setPhase('evicted')} />
      ) : null}

      {/* Mobile: pinned compact vitals, feed as the scrolling body, detail demoted below it. */}
      <div className="flex min-h-screen flex-col md:hidden">
        <CompactVitals vitals={vitals} />
        <section className="flex flex-col gap-3 px-5 py-6">
          {feedLabel}
          <Feed transactions={transactions} />
        </section>
        <div className="border-line flex flex-col gap-6 border-t px-5 py-7">
          <SecondaryVitals vitals={vitals} />
          {chart}
          {errorBanner}
        </div>
      </div>

      {/* Desktop: vitals rail beside a full-height, independently-scrolling feed. */}
      <div className="mx-auto hidden max-w-7xl md:grid md:h-screen md:grid-cols-[minmax(340px,440px)_1fr] md:overflow-hidden">
        <aside className="border-line pane-scroll flex animate-[reveal_0.5s_ease-out] flex-col gap-5 px-7 py-7 md:overflow-y-auto md:border-r">
          <VitalSigns vitals={vitals} />
          {chart}
          {errorBanner}
        </aside>

        <section className="flex min-h-0 flex-col px-7 py-8 md:overflow-hidden">
          <div className="border-line shrink-0 border-b pb-3 md:pr-4">{feedLabel}</div>
          <div className="pane-scroll md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-4">
            <Feed transactions={transactions} />
          </div>
        </section>
      </div>
    </div>
  );
}
