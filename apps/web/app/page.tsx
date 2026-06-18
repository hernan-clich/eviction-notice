'use client';

import { useEffect, useRef, useState } from 'react';
import { computeVitals, type AgentState, type Snapshot, type Transaction } from 'shared';

import { DashboardView } from '@/components/dashboard-view';
import { DeathTransition } from '@/components/death-transition';
import { EvictedScreen } from '@/components/evicted-screen';
import { LoadingState } from '@/components/loading-state';
import { ReplayView } from '@/components/replay-view';
import { realtimeLedgerSource } from '@/lib/ledger-source';

const AGENT_ID = 'agent-0';

// The trading-window open instant (same value as the worker's TRADING_STARTS_AT).
// Set on Vercel so the stand-by screen can show the move-in date + countdown while
// the agent is armed-but-unborn. Unset/invalid → the pre-life screen falls back to
// the plain "knocking" loading beat.
const STANDBY_UNTIL_MS = (() => {
  const raw = process.env['NEXT_PUBLIC_TRADING_STARTS_AT'];
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
})();

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The first load hasn't resolved yet — show the colourless "knocking" state, never
  // the dashboard shell (empty defaults render as a false death in this app).
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 'live' → the dashboard; 'dying' → the death-beat transition (only when we
  // witness the agent cross into death); 'evicted' → the memorial.
  const [phase, setPhase] = useState<'live' | 'dying' | 'evicted' | 'replay'>('live');
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
      } finally {
        if (active) setLoaded(true);
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

  // The colourless "knocking" state covers every "no agent yet" case, never the
  // populated shell (empty defaults render as a false death — $0, EVICTED, flatline):
  //   - the first load hasn't resolved, or errored before any data arrived; and
  //   - the agent isn't born yet — the pre-birth / stand-by window, when it's armed
  //     and deployed but the trading window hasn't opened (no agent row, no ledger).
  // An evicted agent always has a non-null agentState, so this can't mask a real death.
  const noData = agentState === null && transactions.length === 0;
  if (!loaded || noData) {
    // Stand-by (vacant unit, known move-in) only once we've loaded to an empty state
    // with a future window time; otherwise it's a plain load → "knocking".
    const standbyUntilMs =
      loaded && noData && STANDBY_UNTIL_MS !== null && STANDBY_UNTIL_MS > nowMs
        ? STANDBY_UNTIL_MS
        : null;
    return (
      <LoadingState
        error={loaded ? loadError : null}
        standbyUntilMs={standbyUntilMs}
        nowMs={nowMs}
      />
    );
  }

  if (phase === 'evicted') {
    return (
      <div className="crt">
        <EvictedScreen
          vitals={vitals}
          transactions={transactions}
          agentState={agentState}
          onReplay={() => setPhase('replay')}
        />
      </div>
    );
  }

  if (phase === 'replay') {
    return (
      <div className="crt">
        <ReplayView
          transactions={transactions}
          snapshots={snapshots}
          agentState={agentState}
          onExit={() => setPhase('evicted')}
        />
      </div>
    );
  }

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

      <DashboardView vitals={vitals} transactions={transactions} banner={errorBanner} />
    </div>
  );
}
