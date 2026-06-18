'use client';

import { useEffect, useRef } from 'react';

import { HeartbeatLine } from './heartbeat-line';

/**
 * The death beat. By FINAL NOTICE the whole UI has already drained to red - the
 * green left gradually during the decline - so the colour drain is spent. The one
 * moment of death left is the pulse stopping, and the pulse has been the "alive"
 * instrument all along. So we don't crossfade to black (that skips the death and
 * jumps to the aftermath): the dashboard dissolves to a black monitor, the last
 * beat scrolls off to the left, the line goes flat and holds, then the memorial's
 * own staggered reveal takes over.
 *
 * Only fires when a death is witnessed live; a fresh load of an already-evicted
 * agent lands straight on the memorial.
 */
export function DeathTransition({ color, onDone }: { color: string; onDone: () => void }) {
  // The parent re-renders every second (the live clock), passing a fresh inline
  // onDone each time. Keep it in a ref so the timer below runs exactly once and
  // isn't reset on every tick (which would stop the reveal ever firing).
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    // ~2.4s for the beat to scroll off + flatten, then a short held flatline.
    const done = setTimeout(() => onDoneRef.current(), 3000);
    return () => clearTimeout(done);
  }, []);

  return (
    <div className="bg-bg animate-[fade-in_0.5s_ease-out_both] fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="w-[min(90vw,640px)]">
        <HeartbeatLine alive={false} dying color={color} className="h-28" />
      </div>
    </div>
  );
}
