/**
 * Shared library for Eviction Notice — the workspace seam every package imports
 * through. The append-only ledger (the source of truth: balance = SUM(amount))
 * lives here; the eligible-token universe (#24) and further schemas follow.
 */

export * from './eligible-tokens.ts';
export * from './ledger.ts';
