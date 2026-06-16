/**
 * The "knocking on the door" beat — what we show while the first load resolves (or
 * any transient unknown before data + colour arrive). In Eviction Notice an empty
 * shell always reads as a death (zeros → broke, red → evicted, a flat line →
 * flatlined), so loading must NOT reuse the dashboard. This is deliberately
 * colourless and value-less: no numbers, no green, no red, no pulse — just a neutral
 * terminal establishing contact, in the eviction voice. It resolves into the real
 * state (the live dashboard or the memorial) the instant data lands.
 */
export function LoadingState({ error }: { error?: string | null }) {
  const lines = ['establishing connection to the unit', 'pulling the case file'];

  return (
    <main className="crt mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="font-display text-muted text-xl tracking-[0.25em]">EVICTION&nbsp;NOTICE</h1>
        <div className="text-muted/50 mt-1 text-[10px] tracking-[0.25em] uppercase">
          autonomous agent · earning its keep
        </div>
      </div>

      <div className="font-display text-muted/70 flex w-full max-w-sm flex-col gap-2.5 text-sm tracking-wide">
        {lines.map((line, i) => (
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
            <span className="text-amber/80">couldn’t reach the unit — retrying…</span>
          ) : (
            <>
              <span className="text-ink">knocking on the door</span>
              <span className="bg-muted ml-0.5 inline-block h-4 w-[0.55em] animate-[blink_1.1s_step-end_infinite]" />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
