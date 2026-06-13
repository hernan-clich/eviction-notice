'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ReplayView } from '@/components/replay-view';
import { staticReplaySource, type LedgerData } from '@/lib/ledger-source';

// The committed, frozen recording. Deterministic + DB-independent — the shareable
// life. (Parameterize by agent later; one canonical run is enough for now.)
const REPLAY_URL = '/replays/agent-0.json';

export default function ReplayPage() {
  const router = useRouter();
  const [data, setData] = useState<LedgerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await staticReplaySource(REPLAY_URL).load('agent-0');
        if (active) setData(loaded);
      } catch (error_) {
        if (active) setError(error_ instanceof Error ? error_.message : String(error_));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <main className="crt mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-muted text-sm leading-relaxed">
          No recording found. Generate one at <code className="text-ink">/export-replay</code> and
          commit the JSON to <code className="text-ink">public/replays/</code>.
        </p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="font-display text-muted hover:text-ink text-xs tracking-[0.2em] uppercase transition-colors"
        >
          ← Back
        </button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="crt flex min-h-dvh items-center justify-center">
        <span className="text-muted font-display text-xs tracking-[0.2em] uppercase">
          Loading the recording…
        </span>
      </main>
    );
  }

  return (
    <div className="crt">
      <ReplayView
        transactions={data.transactions}
        snapshots={data.snapshots}
        agentState={data.agentState}
        onExit={() => router.push('/')}
      />
    </div>
  );
}
