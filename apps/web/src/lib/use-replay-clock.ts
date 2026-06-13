'use client';

import { useEffect, useRef, useState } from 'react';
import { ledgerAt, realAt, type ReplaySchedule } from 'shared';

export type ReplaySpeed = 1 | 2 | 4;

export interface ReplayClock {
  /** Current ledger time the dashboard should render at. */
  clockMs: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** True once playback has reached eviction (natural end or scrubbed to it). */
  ended: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: ReplaySpeed) => void;
  seekToLedger: (ledgerMs: number) => void;
}

/**
 * Drives the replay: a requestAnimationFrame loop advancing a real-playback cursor
 * (scaled by speed) and mapping it through the event-stepped schedule to a ledger
 * clock. State updates are throttled to ~20Hz so re-deriving the whole dashboard
 * each frame stays cheap; the cursor itself stays frame-accurate in a ref.
 */
export function useReplayClock(schedule: ReplaySchedule): ReplayClock {
  const [clockMs, setClockMs] = useState(schedule.bornMs);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [ended, setEnded] = useState(false);

  const elapsedRef = useRef(0); // real playback ms, 0..totalRealMs
  const speedRef = useRef<ReplaySpeed>(1);
  // Mirror speed into a ref (not during render) so the rAF loop reads the latest
  // value without restarting the effect on every speed change.
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    let lastEmit = 0;

    const tick = (ts: number) => {
      if (last !== null) {
        elapsedRef.current = Math.min(
          schedule.totalRealMs,
          elapsedRef.current + (ts - last) * speedRef.current,
        );
      }
      last = ts;
      const done = elapsedRef.current >= schedule.totalRealMs;
      if (done || ts - lastEmit >= 50) {
        lastEmit = ts;
        setClockMs(ledgerAt(schedule, elapsedRef.current));
      }
      if (done) {
        setPlaying(false);
        setEnded(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, schedule]);

  const seekToLedger = (ledgerMs: number) => {
    const clamped = Math.max(schedule.bornMs, Math.min(schedule.evictedMs, ledgerMs));
    elapsedRef.current = realAt(schedule, clamped);
    setClockMs(clamped);
    setEnded(elapsedRef.current >= schedule.totalRealMs);
  };

  const play = () => {
    if (elapsedRef.current >= schedule.totalRealMs) {
      elapsedRef.current = 0; // finished → restart from move-in
      setClockMs(schedule.bornMs);
      setEnded(false);
    }
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const toggle = () => (playing ? pause() : play());

  return { clockMs, playing, speed, ended, play, pause, toggle, setSpeed, seekToLedger };
}
