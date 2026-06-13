'use client';

import { useEffect, useState } from 'react';

import { HeartbeatLine } from './heartbeat-line';

/**
 * The death beat. By FINAL NOTICE the whole UI has already drained to red — the
 * green left gradually during the decline — so the colour drain is spent. The one
 * moment of death left is the pulse stopping, and the pulse has been the "alive"
 * instrument all along. So we don't crossfade to black (that skips the death and
 * jumps to the aftermath): the heartbeat flatlines first, holds, then the screen
 * settles to black and the notice staggers in (the EVICTED memorial's own reveal).
 *
 * Only fires when a death is witnessed live; a fresh load of an already-evicted
 * agent lands straight on the memorial.
 */
export function DeathTransition({ color, onDone }: { color: string; onDone: () => void }) {
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    const stop = setTimeout(() => setFlat(true), 1100); // a last beat, then the line goes flat
    const done = setTimeout(onDone, 2800); // hold the flatline, then reveal the notice
    return () => {
      clearTimeout(stop);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div className="bg-bg animate-[fade-in_0.5s_ease-out_both] fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="w-[min(90vw,640px)]">
        <HeartbeatLine alive={!flat} color={color} health={0.08} className="h-28" />
      </div>
    </div>
  );
}
