import type { AgentState, Transaction } from './ledger.ts';

/**
 * The memorial — everything the EVICTED screen says about a finished run, derived
 * purely from the ledger + lifecycle row (no live state). It's the replay's landing
 * frame and the shareable card, so it's a deterministic SELECT against the JSON:
 * tenancy from the move-in/eviction bookends, the win/loss split + sums from the
 * ledger, an eviction cause classified from what actually drained it (it shapes the
 * epitaph; it is never shown on its own), and the agent's own final entry as the
 * note it left behind. Pure so #28 replay reuses it verbatim.
 *
 * This is the eviction metaphor's home turf — "evicted" here is the literal event,
 * not a stand-in for death — so every derived string stays in the housing register.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Why the lease ended, classified from the ledger (drives the epitaph, not shown):
 * - `nonpayment`  — rent + data + friction outpaced a market with no edge (the grind).
 * - `bad bet`     — one position it couldn't recover from did the damage.
 * - `forced sale` — liquidation losses drained more than the cost of staying did.
 */
export type EvictionCause = 'nonpayment' | 'bad bet' | 'forced sale';

export interface Memorial {
  movedInMs: number | null;
  evictedMs: number | null;
  tenancyMs: number;
  seedUsd: number;
  peakUsd: number;
  finalPnlUsd: number;
  /** Closed trades (wins + losses), and the split. */
  trades: number;
  wins: number;
  losses: number;
  rentPaidUsd: number;
  /** Total burned just to keep the lease: rent + data + x402 + gas. */
  costOfStayingUsd: number;
  evictionCause: EvictionCause;
  /** The agent's full final decision entry — the note it left, verbatim. */
  lastWords: string | null;
  lastWordsMs: number | null;
}

function metaNumber(meta: Transaction['meta'], key: string): number | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === 'number' ? value : null;
}

function classifyEviction(input: {
  worstLossUsd: number;
  realizedLossUsd: number;
  costOfStayingUsd: number;
  seedUsd: number;
}): EvictionCause {
  const seed = input.seedUsd > 0 ? input.seedUsd : 1;
  // One position it couldn't recover from.
  if (input.worstLossUsd >= 0.35 * seed) return 'bad bet';
  // Liquidation losses took more than the cost of staying did.
  if (input.realizedLossUsd > input.costOfStayingUsd && input.realizedLossUsd >= 0.15 * seed) {
    return 'forced sale';
  }
  // The rent + data + friction grind outpaced a market that offered no edge.
  return 'nonpayment';
}

export function computeMemorial(
  transactions: readonly Transaction[],
  agentState: AgentState | null,
  marks: { peakUsd: number; netWorthUsd: number },
): Memorial {
  const ordered = [...transactions].sort((a, b) => a.id - b.id);

  let seedUsd = 0;
  let rentPaidUsd = 0;
  let costOfStayingUsd = 0;
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
        costOfStayingUsd += -tx.amount;
        break;
      }
      case 'data_call':
      case 'x402_fee':
      case 'gas': {
        costOfStayingUsd += -tx.amount;
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
  const movedInMs = agentState?.born_at
    ? Date.parse(agentState.born_at)
    : first
      ? Date.parse(first.ts)
      : null;
  const evictedMs = agentState?.died_at
    ? Date.parse(agentState.died_at)
    : last
      ? Date.parse(last.ts)
      : null;
  const tenancyMs =
    movedInMs !== null && evictedMs !== null ? Math.max(evictedMs - movedInMs, 0) : 0;

  return {
    movedInMs,
    evictedMs,
    tenancyMs,
    seedUsd,
    peakUsd: marks.peakUsd,
    finalPnlUsd: marks.netWorthUsd - seedUsd,
    trades: wins + losses,
    wins,
    losses,
    rentPaidUsd,
    costOfStayingUsd,
    evictionCause: classifyEviction({ worstLossUsd, realizedLossUsd, costOfStayingUsd, seedUsd }),
    lastWords,
    lastWordsMs,
  };
}

/**
 * A computed one-line epitaph — solemn and specific, played completely straight. The
 * eviction cause gives it a distinct story; the agent's own note is surfaced
 * separately and never paraphrased here.
 */
export function memorialEpitaph(memorial: Memorial): string {
  const days = Math.floor(memorial.tenancyMs / DAY_MS);
  const hours = Math.floor(memorial.tenancyMs / HOUR_MS);
  const span = days >= 2 ? `${days} days` : days === 1 ? 'a day' : `${hours} hours`;

  switch (memorial.evictionCause) {
    case 'bad bet': {
      return `It made rent for ${span}, then took a position the market never gave back.`;
    }
    case 'forced sale': {
      return `It made rent for ${span} by selling itself off to cover the next notice, until there was nothing left to sell.`;
    }
    default: {
      return days >= 1
        ? `It made rent for ${span}. On the last, the market offered nothing worth trading, and the clock ran out.`
        : `It made rent for ${span}, then the market offered nothing worth trading, and the clock ran out.`;
    }
  }
}

/**
 * The note it left — the agent's full final entry is the whole essay (RSI/token
 * detail, a Summary block, markdown). The memorial only wants the killer closing
 * line, so strip the markdown and keep the last sentence or two. The full reasoning
 * stays in the ledger.
 */
export function lastWordsEssence(reasoning: string, maxSentences = 2): string {
  const plain = reasoning
    .replaceAll(/```[\s\S]*?```/g, ' ') // fenced code
    .replaceAll(/^\s*([-=*_])\1{2,}\s*$/gm, ' ') // hr lines
    .replaceAll(/[*_`#>|]/g, '') // inline markers + table pipes
    .replaceAll(/\s+/g, ' ')
    .trim();

  const sentences = plain.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [];
  if (sentences.length === 0) {
    return plain.length > 220 ? `…${plain.slice(-220).trim()}` : plain;
  }
  const tail = sentences.slice(-maxSentences).join(' ').trim();
  return tail.length > 240 ? (sentences.at(-1) ?? tail).trim() : tail;
}
