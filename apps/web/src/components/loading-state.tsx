/**
 * The pre-life screen - shown whenever there's no tenant in the unit yet. Two beats,
 * because the reasons differ:
 *
 *   - LOADING ("knocking on the door"): the first fetch hasn't resolved. Transient,
 *     value-less, just establishing contact.
 *   - STAND-BY (a vacant unit with a known move-in): the agent is armed and deployed
 *     but the trading window hasn't opened. We KNOW no one's home and we KNOW when
 *     they arrive, so we say so - a vacancy with a lease start date + a live countdown.
 *
 * Either way it's deliberately colourless and value-less (no green, no red, no
 * numbers-as-money, no pulse), because in this app an empty dashboard shell reads as
 * a death ($0 → broke, red → evicted, flat line → flatlined). It resolves into the
 * live dashboard or the memorial the instant real data lands.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22 Jun 2026 · 00:00 UTC" - the absolute move-in, in UTC. */
function formatMoveIn(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mon} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

/** "3d 14h 22m" - coarse on purpose (no ticking seconds); calm, not a stopwatch. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, ms);
  const d = Math.floor(total / 86_400_000);
  const h = Math.floor((total % 86_400_000) / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (d > 0 || h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

const Cursor = () => (
  <span className="bg-muted ml-0.5 inline-block h-4 w-[0.55em] animate-[blink_1.1s_step-end_infinite]" />
);

export function LoadingState({
  error,
  standbyUntilMs,
  nowMs,
}: {
  error?: string | null;
  /** Set when the unit is vacant with a known move-in (stand-by); null = plain loading. */
  standbyUntilMs?: number | null;
  nowMs?: number;
}) {
  const now = nowMs ?? 0;
  const standbyMs = standbyUntilMs != null && standbyUntilMs > now ? standbyUntilMs : null;

  return (
    <main className="crt mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="font-display text-muted text-xl tracking-[0.25em]">EVICTION&nbsp;NOTICE</h1>
        <div className="text-muted/50 mt-1 text-[10px] tracking-[0.25em] uppercase">
          autonomous agent · earning its keep
        </div>
      </div>

      <div className="font-display text-muted/70 flex w-full max-w-sm flex-col gap-2.5 text-sm tracking-wide">
        {standbyMs === null ? (
          <>
            {['establishing connection to the unit', 'pulling the case file'].map((line, i) => (
              <div
                key={line}
                className="animate-[fade-in_0.4s_ease-out_both] flex gap-2"
                style={{ animationDelay: `${i * 0.18}s` }}
              >
                <span className="text-muted/40">›</span>
                <span>{line}</span>
              </div>
            ))}
            <div
              className="animate-[fade-in_0.4s_ease-out_both] flex items-center gap-2"
              style={{ animationDelay: '0.36s' }}
            >
              <span className="text-muted/40">›</span>
              {error ? (
                <span className="text-amber/80">couldn’t reach the unit - retrying…</span>
              ) : (
                <>
                  <span className="text-ink">knocking on the door</span>
                  <Cursor />
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="animate-[fade-in_0.4s_ease-out_both] flex gap-2">
              <span className="text-muted/40">›</span>
              <span>the unit is vacant, no tenant on the premises</span>
            </div>
            <div
              className="animate-[fade-in_0.4s_ease-out_both] flex items-center gap-2"
              style={{ animationDelay: '0.18s' }}
            >
              <span className="text-muted/40">›</span>
              <span className="text-ink">tenancy begins in {formatCountdown(standbyMs - now)}</span>
              <Cursor />
            </div>
            <div
              className="text-muted/40 animate-[fade-in_0.4s_ease-out_both] pl-4 text-[11px] tracking-[0.2em] uppercase"
              style={{ animationDelay: '0.36s' }}
            >
              {formatMoveIn(standbyMs)}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
