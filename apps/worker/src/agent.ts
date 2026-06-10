import { randomBytes } from 'node:crypto';

import { isEligibleToken, LIQUID_TOKENS } from 'shared';
import { decideSizing } from 'skill';
import { z } from 'zod';

import { cmcConfig, fetchQuotes, meteredFetchQuotes } from './cmc.ts';
import type { WorkerConfig } from './config.ts';
import { runConversation, type LlmClient, type LlmTool, type ToolHandler } from './llm.ts';
import { closeProceedsUsd, swapFrictionUsd, type FrictionParams } from './paper-trade.ts';
import {
  closePosition,
  fetchOpenPositions,
  insertTransaction,
  openPosition,
  type AppSupabaseClient,
  type OpenPosition,
} from './supabase.ts';

const getQuotesInput = z.object({ symbols: z.array(z.string()).min(1).max(10) });
const sizePositionInput = z.object({
  token: z.string(),
  edge: z.number(),
  volatility: z.number().positive(),
});
const openPositionInput = z.object({ token: z.string(), sizeUsd: z.number().positive() });
const closePositionInput = z.object({ positionId: z.number().int() });

const TOOLS: LlmTool[] = [
  {
    name: 'get_quotes',
    description:
      'Fetch live USD market quotes (price, 24h change, volume, market cap) for up to 10 token symbols from CoinMarketCap. Each call costs a small metered data fee. Use it to read the market and to mark open positions to market before closing.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Token symbols, e.g. ["BNB","CAKE"]',
        },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'size_position',
    description:
      'Ask the Solvency-Aware Sizing skill how big a position to take, or whether to skip. Provide your estimated edge (expected fractional return, e.g. 0.02) and volatility (fractional downside risk, e.g. 0.05). Returns a position size + go/no-go decision optimised for survival.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        edge: { type: 'number', description: 'Expected fractional return, e.g. 0.02 for +2%' },
        volatility: { type: 'number', description: 'Fractional downside risk, e.g. 0.05 for 5%' },
      },
      required: ['token', 'edge', 'volatility'],
    },
  },
  {
    name: 'open_position',
    description:
      'Open a paper long position: spend sizeUsd of cash to buy the token at the live price (paying gas + fees + slippage). Use the size the sizing skill recommended. Only call this when you have decided to trade.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        sizeUsd: { type: 'number', description: 'Cash to deploy, e.g. 12' },
      },
      required: ['token', 'sizeUsd'],
    },
  },
  {
    name: 'close_position',
    description:
      'Close an open position by id: sell back to cash at the live price (paying gas + fees + slippage), realising the P&L. Close winners to bank gains or losers to cut risk.',
    inputSchema: {
      type: 'object',
      properties: { positionId: { type: 'number' } },
      required: ['positionId'],
    },
  },
];

export interface InnerTickDeps {
  llm: LlmClient;
  supabase: AppSupabaseClient;
  config: WorkerConfig;
  balanceUsd: number;
  mustTrade: boolean;
}

function frictionParams(config: WorkerConfig): FrictionParams {
  return {
    gasPerSwapUsd: config.GAS_PER_SWAP_USD,
    swapFeeRate: config.SWAP_FEE_RATE,
    slippage: config.SLIPPAGE,
  };
}

/**
 * A swap is never recorded without a tx reference. Paper swaps get a flagged
 * simulated hash so the dashboard can always link to the explorer; #13 replaces
 * this with the real on-chain hash returned by the TWAK swap.
 */
function simulatedTxHash(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

/** Human-readable price: 2 decimals for dollar-scale tokens, more precision for sub-dollar. */
function fmtPrice(price: number): string {
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toPrecision(3);
}

function systemPrompt(deps: InnerTickDeps, openPositions: OpenPosition[]): string {
  const burn = deps.config.RENT_PER_HOUR_USD;
  const runwayHours = burn > 0 ? deps.balanceUsd / burn : Number.POSITIVE_INFINITY;
  const positionsLine =
    openPositions.length > 0
      ? openPositions
          .map((p) => `#${p.id} ${p.token} $${p.sizeUsd.toFixed(2)} @ $${p.entryPx}`)
          .join('; ')
      : 'none';

  const lines = [
    'You are Eviction Notice — an autonomous crypto trading agent on BNB Chain that must earn its own survival.',
    'You pay rent every hour out of your cash balance; if it hits zero you are EVICTED and the run ends permanently. Optimise for staying alive, not for maximum return.',
    '',
    `Cash balance: $${deps.balanceUsd.toFixed(4)} | burn $${burn.toFixed(4)}/hour | runway ≈ ${runwayHours.toFixed(1)} hours.`,
    `Open positions: ${positionsLine}.`,
    '',
    'Each tick:',
    '- get_quotes to read the market and to mark any open positions to market.',
    '- For open positions, decide whether to close_position (bank a gain or cut a loss) — they only realise P&L when closed.',
    '- To enter: estimate edge + volatility, call size_position, and if it says trade, call open_position with the recommended size.',
    '- Every swap pays gas + fees + slippage. Only trade when expected edge clearly beats that friction.',
    `- Trade ONLY eligible tokens — trades outside the list do not count toward your P&L. Focus on the deepest, most-liquid ones: ${LIQUID_TOKENS.join(', ')}.`,
  ];
  if (deps.mustTrade) {
    lines.push(
      '- ⚠️ You have not traded within the required window. You MUST open at least one qualifying position this tick or risk disqualification — take the least-bad viable trade.',
    );
  }
  lines.push('- Be concise. End with a one- or two-sentence summary of what you did and why.');
  return lines.join('\n');
}

/** Run one inner reason-and-act loop: think, (maybe) trade, record the decision. */
export async function runInnerTick(
  deps: InnerTickDeps,
): Promise<{ summary: string; iterations: number }> {
  const agentId = deps.config.AGENT_ID;
  const openPositions = await fetchOpenPositions(deps.supabase, agentId);

  const handlers: Record<string, ToolHandler> = {
    get_quotes: async (input) => {
      const parsed = getQuotesInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      const quotes = await meteredFetchQuotes(
        { supabase: deps.supabase, config: deps.config, agentId },
        parsed.data.symbols,
      );
      return JSON.stringify(quotes);
    },

    size_position: (input) => {
      const parsed = sizePositionInput.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(`Invalid input: ${parsed.error.message}`);
      }
      const decision = decideSizing({
        balanceUsd: deps.balanceUsd,
        peakBalanceUsd: Math.max(deps.balanceUsd, deps.config.SEED_USD),
        burnRatePerHourUsd: deps.config.RENT_PER_HOUR_USD,
        edge: parsed.data.edge,
        volatility: parsed.data.volatility,
        gasPerSwapUsd: deps.config.GAS_PER_SWAP_USD,
        mustTrade: deps.mustTrade,
      });
      return Promise.resolve(JSON.stringify(decision));
    },

    open_position: async (input) => {
      const parsed = openPositionInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      if (!isEligibleToken(parsed.data.token)) {
        return `${parsed.data.token} is not in the eligible universe — trades outside it don't count toward P&L. Choose an eligible token.`;
      }
      const [quote] = await fetchQuotes(cmcConfig(deps.config), [parsed.data.token]);
      if (!quote) {
        return `No live price for ${parsed.data.token}; cannot open.`;
      }
      const friction = swapFrictionUsd(parsed.data.sizeUsd, frictionParams(deps.config));
      const txHash = simulatedTxHash();
      const id = await openPosition(deps.supabase, {
        agentId,
        token: quote.symbol,
        sizeUsd: parsed.data.sizeUsd,
        entryPx: quote.priceUsd,
      });
      await insertTransaction(deps.supabase, {
        agentId,
        kind: 'expense',
        amount: -(parsed.data.sizeUsd + friction),
        reason: 'trade_open',
        reasoning: `Opened #${id}: $${parsed.data.sizeUsd.toFixed(2)} ${quote.symbol} @ $${fmtPrice(quote.priceUsd)}.`,
        meta: {
          positionId: id,
          token: quote.symbol,
          sizeUsd: parsed.data.sizeUsd,
          entryPx: quote.priceUsd,
          frictionUsd: friction,
          txHash,
          network: deps.config.BSC_NETWORK,
          simulated: true,
        },
      });
      return JSON.stringify({
        positionId: id,
        token: quote.symbol,
        entryPx: quote.priceUsd,
        frictionUsd: friction,
      });
    },

    close_position: async (input) => {
      const parsed = closePositionInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      const position = openPositions.find((p) => p.id === parsed.data.positionId);
      if (!position) {
        return `No open position #${parsed.data.positionId}.`;
      }
      const [quote] = await fetchQuotes(cmcConfig(deps.config), [position.token]);
      if (!quote) {
        return `No live price for ${position.token}; cannot close.`;
      }
      const proceeds = closeProceedsUsd(
        position.sizeUsd,
        position.entryPx,
        quote.priceUsd,
        frictionParams(deps.config),
      );
      const openCost =
        position.sizeUsd + swapFrictionUsd(position.sizeUsd, frictionParams(deps.config));
      const netPnl = proceeds - openCost;
      const txHash = simulatedTxHash();
      await closePosition(deps.supabase, {
        id: position.id,
        exitPx: quote.priceUsd,
        pnlUsd: netPnl,
      });
      await insertTransaction(deps.supabase, {
        agentId,
        kind: 'income',
        amount: proceeds,
        reason: 'trade_close',
        reasoning: `Closed #${position.id} ${position.token} @ $${fmtPrice(quote.priceUsd)}: net P&L $${netPnl.toFixed(2)}.`,
        meta: {
          positionId: position.id,
          exitPx: quote.priceUsd,
          netPnlUsd: netPnl,
          txHash,
          network: deps.config.BSC_NETWORK,
          simulated: true,
        },
      });
      return JSON.stringify({ positionId: position.id, exitPx: quote.priceUsd, netPnlUsd: netPnl });
    },
  };

  const outcome = await runConversation({
    llm: deps.llm,
    system: systemPrompt(deps, openPositions),
    userText:
      'A new tick has begun. Assess the market, manage any open positions, and decide what to do.',
    tools: TOOLS,
    handlers,
    maxIterations: deps.config.AGENT_MAX_ITERATIONS,
  });

  const summary = outcome.finalText.length > 0 ? outcome.finalText : '(no decision)';
  await insertTransaction(deps.supabase, {
    agentId,
    kind: 'expense',
    amount: 0,
    reason: 'decision',
    reasoning: summary,
    meta: { iterations: outcome.iterations },
  });

  return { summary, iterations: outcome.iterations };
}
