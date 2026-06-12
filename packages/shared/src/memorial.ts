import type { AgentState, Transaction } from './ledger.ts';

/**
 * The memorial — everything the EVICTED screen says about a finished run, derived
 * purely from the ledger + lifecycle row (no live state). It's the replay's landing
 * frame and the shareable card, so it's a deterministic SELECT against the JSON:
 * lifespan from the birth/death bookends, the win/loss split + sums from the ledger,
 * a one-word cause of death classified from what actually drained it, and the agent's
 * own final decision log as its last words. Pure so #28 replay reuses it verbatim.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * What actually killed it, classified from the ledger:
 * - `starved`   — rent + data + friction outpaced a market with no edge (the grind).
 * - `bled out`  — one position it couldn't recover from did the damage.
 * - `strangled` — trading/liquidation losses drained more than the cost of living.
 */
export type CauseOfDeath = 'starved' | 'bled out' | 'strangled';

export interface Memorial {
  bornMs: number | null;
  diedMs: number | null;
  lifespanMs: number;
  seedUsd: number;
  peakUsd: number;
  finalPnlUsd: number;
  /** Closed trades (wins + losses), and the split. */
  trades: number;
  wins: number;
  losses: number;
  rentPaidUsd: number;
  /** Total burned just to keep operating: rent + data + x402 + gas. */
  spentToExistUsd: number;
  causeOfDeath: CauseOfDeath;
  /** The agent's final decision log — its last words, verbatim. */
  lastWords: string | null;
  lastWordsMs: number | null;
}

function metaNumber(meta: Transaction['meta'], key: string): number | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === 'number' ? value : null;
}

function classifyDeath(input: {
  worstLossUsd: number;
  realizedLossUsd: number;
  spentToExistUsd: number;
  seedUsd: number;
}): CauseOfDeath {
  const seed = input.seedUsd > 0 ? input.seedUsd : 1;
  // One position it couldn't recover from.
  if (input.worstLossUsd >= 0.35 * seed) return 'bled out';
  // Liquidation losses took more than the cost of living did.
  if (input.realizedLossUsd > input.spentToExistUsd && input.realizedLossUsd >= 0.15 * seed) {
    return 'strangled';
  }
  // The rent + data + friction grind outpaced a market that offered no edge.
  return 'starved';
}

export function computeMemorial(
  transactions: readonly Transaction[],
  agentState: AgentState | null,
  marks: { peakUsd: number; netWorthUsd: number },
): Memorial {
  const ordered = [...transactions].sort((a, b) => a.id - b.id);

  let seedUsd = 0;
  let rentPaidUsd = 0;
  let spentToExistUsd = 0;
  let wins = 0;
  let losses = 0;
  let worstLossUsd = 0;
  let realizedLossUsd = 0;
  let lastWords: string | null = null;
  let lastWordsMs: number | null = null;

  for (const tx of ordered) {
    switch (tx.reason) {
      case 'seed': {
        seedUsd += tx.amount;
        break;
      }
      case 'rent': {
        rentPaidUsd += -tx.amount;
        spentToExistUsd += -tx.amount;
        break;
      }
      case 'data_call':
      case 'x402_fee':
      case 'gas': {
        spentToExistUsd += -tx.amount;
        break;
      }
      case 'trade_close': {
        const pnl = metaNumber(tx.meta, 'netPnlUsd') ?? 0;
        if (pnl > 0) {
          wins += 1;
        } else if (pnl < 0) {
          losses += 1;
          realizedLossUsd += -pnl;
          worstLossUsd = Math.max(worstLossUsd, -pnl);
        }
        break;
      }
      case 'decision': {
        if (tx.reasoning && tx.reasoning.trim() !== '') {
          lastWords = tx.reasoning.trim();
          lastWordsMs = Date.parse(tx.ts);
        }
        break;
      }
    }
  }

  const first = ordered[0];
  const last = ordered.at(-1);
  const bornMs = agentState?.born_at
    ? Date.parse(agentState.born_at)
    : first
      ? Date.parse(first.ts)
      : null;
  const diedMs = agentState?.died_at
    ? Date.parse(agentState.died_at)
    : last
      ? Date.parse(last.ts)
      : null;
  const lifespanMs = bornMs !== null && diedMs !== null ? Math.max(diedMs - bornMs, 0) : 0;

  return {
    bornMs,
    diedMs,
    lifespanMs,
    seedUsd,
    peakUsd: marks.peakUsd,
    finalPnlUsd: marks.netWorthUsd - seedUsd,
    trades: wins + losses,
    wins,
    losses,
    rentPaidUsd,
    spentToExistUsd,
    causeOfDeath: classifyDeath({ worstLossUsd, realizedLossUsd, spentToExistUsd, seedUsd }),
    lastWords,
    lastWordsMs,
  };
}

/**
 * A computed one-line eulogy — solemn and specific, played completely straight. The
 * cause of death gives it a distinct story; the agent's own last words are surfaced
 * separately and never paraphrased here.
 */
export function memorialEulogy(memorial: Memorial): string {
  const days = Math.floor(memorial.lifespanMs / DAY_MS);
  const hours = Math.floor(memorial.lifespanMs / HOUR_MS);
  const span = days >= 2 ? `${days} days` : days === 1 ? 'a day' : `${hours} hours`;

  switch (memorial.causeOfDeath) {
    case 'bled out': {
      return `It made rent for ${span}, then took a position the market never gave back.`;
    }
    case 'strangled': {
      return `It made rent for ${span} by selling itself off to cover the next notice, until there was nothing left to sell.`;
    }
    default: {
      return days >= 1
        ? `It made rent for ${span}. On the last, the market offered nothing worth trading, and the clock ran out.`
        : `It made rent for ${span}, then the market offered nothing worth trading, and the clock ran out.`;
    }
  }
}
