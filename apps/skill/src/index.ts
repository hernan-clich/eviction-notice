/**
 * Eviction Notice — Solvency-Aware Sizing skill (Track 2).
 *
 * Library entry: re-exports the sizing algorithm so the worker (and the #11
 * backtest) can call it directly. The x402-gated HTTP server (#10) will be added
 * here on top of the same algorithm.
 */

export * from './sizing.ts';
