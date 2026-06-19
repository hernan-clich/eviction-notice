/**
 * The agent's financial pulse. For a digital creature money is blood and cash flow
 * is the heartbeat, so the only honest vital sign is the balance: a healthy agent
 * beats often and tall, and as it bleeds out the trace goes sparse, shallow, and slow
 * - approaching a flat line as it nears eviction. Driven, not decorative.
 */

// One PQRST blip as relative (dx, dyUnit) steps; dyUnit is scaled by amplitude.
// The dyUnits net to zero, so the pen always returns to the baseline.
const BLIP: readonly (readonly [number, number])[] = [
  [4, -0.18],
  [3, 0.4],
  [3, -1.7],
  [3, 2.3],
  [3, -1],
  [4, 0.18],
];
const BLIP_WIDTH = 20; // sum of the dx steps above
const TRACE_WIDTH = 120;

const clamp01 = (n: number): number => Math.max(0, Math.min(n, 1));

/** Build a trace whose beat count + amplitude scale with financial health (0..1). */
function buildTrace(health: number): string {
  const f = clamp01(health);
  const beats = Math.round(1 + 4 * f); // 1 (failing) → 5 (healthy)
  const amp = 1 + 7 * f; // a shallow flutter when sick, a tall spike when healthy
  const slot = TRACE_WIDTH / beats;
  let d = 'M0 20';
  for (let i = 0; i < beats; i += 1) {
    const start = i * slot + (slot - BLIP_WIDTH) / 2;
    d += ` H${start.toFixed(2)}`;
    for (const [dx, k] of BLIP) {
      d += ` l${dx} ${(k * amp).toFixed(2)}`;
    }
  }
  return `${d} H${TRACE_WIDTH}`;
}

function Trace({ d, color }: { d: string; color: string }) {
  return (
    <svg
      viewBox="0 0 120 40"
      preserveAspectRatio="none"
      className="h-full w-1/2 shrink-0"
      style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HeartbeatLine({
  alive,
  color,
  health = 0,
  dying = false,
  className = 'h-10',
}: {
  alive: boolean;
  color: string;
  health?: number;
  /** The death beat: one last blip scrolls off to the left, then a flat line follows
   *  it in and holds - so the pulse visibly leaves before the line goes flat. */
  dying?: boolean;
  className?: string;
}) {
  if (dying) {
    const amp = 5; // a small final beat, in the spirit of the minuscule FINAL NOTICE pulse
    let beat = 'M0 20 H64';
    for (const [dx, k] of BLIP) beat += ` l${dx} ${(k * amp).toFixed(2)}`;
    beat += ` H${TRACE_WIDTH}`;
    const flat = `M0 20 H${TRACE_WIDTH}`;
    return (
      <div className={`${className} w-full overflow-hidden`}>
        {/* [beat][flat], scrolled left ONCE (fill forwards): the blip sweeps off the
            left edge and the trailing flat line settles in and stays. */}
        <div
          className="flex h-full w-[200%]"
          style={{ animation: 'ekg-scroll 2.4s linear forwards' }}
        >
          <Trace d={beat} color={color} />
          <Trace d={flat} color={color} />
        </div>
      </div>
    );
  }
  if (!alive) {
    return (
      <div className={`${className} w-full overflow-hidden`}>
        <svg
          viewBox="0 0 120 40"
          preserveAspectRatio="none"
          className="h-full w-full animate-[alarm-flicker_2s_ease-in-out_infinite]"
          style={{ filter: 'drop-shadow(0 0 3px #ff5468)' }}
          aria-hidden="true"
        >
          <path
            d="M0 20 H120"
            fill="none"
            stroke="#ff5468"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }
  const d = buildTrace(health);
  const duration = (3.6 - 1.4 * clamp01(health)).toFixed(2); // sick beats slow, healthy beats lively
  return (
    <div className={`${className} w-full overflow-hidden`}>
      <div
        className="flex h-full w-[200%]"
        style={{ animation: `ekg-scroll ${duration}s linear infinite` }}
      >
        <Trace d={d} color={color} />
        <Trace d={d} color={color} />
      </div>
    </div>
  );
}
