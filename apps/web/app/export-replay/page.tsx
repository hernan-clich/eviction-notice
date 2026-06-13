'use client';

import { useEffect, useState } from 'react';

import { realtimeLedgerSource } from '@/lib/ledger-source';

const AGENT_ID = 'agent-0';

/**
 * Dev/maintenance helper: loads the agent's full ledger (the same read the live
 * dashboard does) and downloads it as JSON. Save the file to
 * apps/web/public/replays/<agent>.json and commit it — that frozen snapshot is what
 * the shareable /replay route plays, deterministically and without the DB.
 */
export default function ExportReplay() {
  const [status, setStatus] = useState('Loading the ledger…');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await realtimeLedgerSource.load(AGENT_ID);
        if (!active) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${AGENT_ID}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setStatus(
          `Downloaded ${AGENT_ID}.json (${data.transactions.length} transactions, ${data.snapshots.length} snapshots). ` +
            `Save it to apps/web/public/replays/${AGENT_ID}.json and commit.`,
        );
      } catch (error) {
        if (active)
          setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="crt mx-auto max-w-2xl px-6 py-16 font-mono text-sm">
      <h1 className="font-display text-muted mb-4 text-xs tracking-[0.3em] uppercase">
        Export replay
      </h1>
      <p className="text-ink leading-relaxed">{status}</p>
    </main>
  );
}
