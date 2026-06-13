'use client';

import { useMemo, useState } from 'react';
import {
  buildReplaySchedule,
  computeVitals,
  isReplayFeedReason,
  type AgentState,
  type Snapshot,
  type Transaction,
} from 'shared';

import { useReplayClock } from '@/lib/use-replay-clock';

import { DashboardView } from './dashboard-view';
import { DeathTransition } from './death-transition';
import { ReplayTransport } from './replay-transport';

const EVICTION_RED = '#e0493e';

function caseNumber(agentId: string): number {
  const trailing = /(\d+)$/.exec(agentId)?.[1];
  return (trailing ? Number.parseInt(trailing, 10) : 0) + 1;
}

/**
 * The replay: the live dashboard, reanimated from the recorded ledger on a compressed
 * event-stepped clock. Slice the ledger at the clock and re-derive vitals each frame —
 * balance moves, status climbs, the pulse weakens, the feed re-streams its thoughts —
 * and on reaching eviction it plays the same death transition and hands back to the
 * memorial, so memorial → replay → death → memorial loops cleanly.
 */
export function ReplayView({
  transactions,
  snapshots,
  agentState,
  onExit,
}: {
  transactions: readonly Transaction[];
  snapshots: readonly Snapshot[];
  agentState: AgentState | null;
  onExit: () => void;
}) {
  // Freeze the recording on entry: a replay plays a fixed past, so live ticks
  // arriving on the still-mounted subscription must not shift the schedule/curve
  // mid-playback. Snapshotted once, sorted, and read from here on.
  const [recording] = useState(() => ({
    transactions: [...transactions].sort((a, b) => a.id - b.id),
    snapshots: [...snapshots],
    agentState,
  }));
  const ordered = recording.transactions;

  const bornMs = recording.agentState?.born_at
    ? Date.parse(recording.agentState.born_at)
    : ordered[0]
      ? Date.parse(ordered[0].ts)
      : 0;
  const evictedMs = recording.agentState?.died_at
    ? Date.parse(recording.agentState.died_at)
    : ordered.at(-1)
      ? Date.parse(ordered.at(-1)!.ts)
      : bornMs + 1;

  const schedule = useMemo(
    () => buildReplaySchedule(ordered, recording.snapshots, { bornMs, evictedMs }),
    [ordered, recording.snapshots, bornMs, evictedMs],
  );

  // The whole life's vitals — for the transport curve (full series, peak, seed).
  const fullVitals = useMemo(
    () => computeVitals(ordered, recording.agentState, evictedMs, recording.snapshots),
    [ordered, recording.agentState, evictedMs, recording.snapshots],
  );

  const clock = useReplayClock(schedule);

  // Render the agent as alive at the replay moment (status climbs as it should);
  // computeVitals reads the clock as "now", so age + burn reflect that instant.
  const aliveState = useMemo<AgentState>(
    () => ({
      agent_id: recording.agentState?.agent_id ?? 'agent-0',
      born_at: bornMs ? new Date(bornMs).toISOString() : null,
      died_at: null,
      status: 'alive',
    }),
    [recording.agentState?.agent_id, bornMs],
  );

  const slicedTxns = ordered.filter((t) => Date.parse(t.ts) <= clock.clockMs);
  const slicedSnaps = recording.snapshots.filter((s) => Date.parse(s.ts) <= clock.clockMs);
  const replayVitals = computeVitals(slicedTxns, aliveState, clock.clockMs, slicedSnaps);
  const feed = slicedTxns.filter((t) => isReplayFeedReason(t.reason));
  const caseNo = caseNumber(aliveState.agent_id);

  return (
    <>
      <div className="pb-44 md:pb-0">
        <DashboardView vitals={replayVitals} transactions={feed} feedLabel="The feed" />
      </div>
      {clock.ended ? (
        <DeathTransition color={EVICTION_RED} onDone={onExit} />
      ) : (
        <ReplayTransport
          vitals={fullVitals}
          schedule={schedule}
          clockMs={clock.clockMs}
          playing={clock.playing}
          speed={clock.speed}
          caseNo={caseNo}
          onToggle={clock.toggle}
          onSpeed={clock.setSpeed}
          onSeek={clock.seekToLedger}
          onExit={onExit}
        />
      )}
    </>
  );
}
