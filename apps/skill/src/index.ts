/**
 * Eviction Notice — Solvency-Aware Sizing skill (Track 2).
 *
 * Library entry: re-exports the sizing algorithm + the Agent Hub signal
 * derivation so the worker (and the #11 backtest) can import them without
 * dragging in the HTTP server's deps. The x402-gated app lives in `./server.ts`
 * (bound to a port by `./serve.ts`).
 */

export * from './sizing.ts';
export * from './signals.ts';
