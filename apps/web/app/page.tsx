'use client';

import { useEffect, useState } from 'react';
import { computeBalance, type AgentState, type Transaction } from 'shared';

import { realtimeLedgerSource } from '@/lib/ledger-source';

const AGENT_ID = 'agent-0';

function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : '+';
  const abs = Math.abs(value);
  const decimals = abs > 0 && abs < 0.01 ? 6 : 2;
  return `${sign}$${abs.toFixed(decimals)}`;
}

function amountClass(kind: Transaction['kind']): string {
  return kind === 'income' ? 'text-green-400' : 'text-red-400';
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const snapshot = await realtimeLedgerSource.load(AGENT_ID);
        if (!active) return;
        setTransactions(snapshot.transactions);
        setAgentState(snapshot.agentState);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();

    const unsubscribe = realtimeLedgerSource.subscribe(AGENT_ID, {
      onTransaction: (tx) => {
        setTransactions((prev) => (prev.some((t) => t.id === tx.id) ? prev : [...prev, tx]));
      },
      onAgentState: (state) => {
        setAgentState(state);
      },
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const balance = computeBalance(transactions);
  const alive = agentState?.status === 'alive' && balance > 0;
  const feed = [...transactions].reverse();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">EVICTION NOTICE</h1>
        <span className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${alive ? 'animate-pulse bg-green-400' : 'bg-red-500'}`}
          />
          {agentState ? (alive ? 'ALIVE' : 'EVICTED') : '—'}
        </span>
      </header>

      <section>
        <div className="text-xs tracking-widest text-neutral-500 uppercase">Balance</div>
        <div
          className={`text-5xl font-bold tabular-nums ${alive ? 'text-neutral-100' : 'text-red-400'}`}
        >
          ${balance.toFixed(4)}
        </div>
      </section>

      {loadError ? (
        <p className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {loadError}
        </p>
      ) : null}

      <section className="flex flex-col gap-1">
        <div className="mb-2 text-xs tracking-widest text-neutral-500 uppercase">Live feed</div>
        {feed.length === 0 ? (
          <p className="text-sm text-neutral-500">Waiting for the agent to do something…</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-900">
            {feed.map((tx) => (
              <li key={tx.id} className="flex items-baseline gap-3 py-2 text-sm">
                <time className="w-20 shrink-0 text-neutral-600" dateTime={tx.ts}>
                  {new Date(tx.ts).toLocaleTimeString()}
                </time>
                <span className="w-24 shrink-0 text-neutral-400">{tx.reason}</span>
                <span className={`w-28 shrink-0 tabular-nums ${amountClass(tx.kind)}`}>
                  {formatUsd(tx.amount)}
                </span>
                {tx.reasoning ? (
                  <span className="truncate text-neutral-500 italic">{tx.reasoning}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
