import { decideSizing } from 'skill';
import { z } from 'zod';

import { meteredFetchQuotes } from './cmc.ts';
import type { WorkerConfig } from './config.ts';
import { runConversation, type LlmClient, type LlmTool, type ToolHandler } from './llm.ts';
import { insertTransaction, type AppSupabaseClient } from './supabase.ts';

const getQuotesInput = z.object({ symbols: z.array(z.string()).min(1).max(10) });
const sizePositionInput = z.object({
  token: z.string(),
  edge: z.number(),
  volatility: z.number().positive(),
});

const TOOLS: LlmTool[] = [
  {
    name: 'get_quotes',
    description:
      'Fetch live USD market quotes (price, 24h change, volume, market cap) for up to 10 token symbols from CoinMarketCap. Each call costs a small metered data fee.',
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
      'Ask the Solvency-Aware Sizing skill how big a position to take, or whether to skip. Provide your estimated edge (expected fractional return, e.g. 0.02) and volatility (fractional downside risk, e.g. 0.05) for the candidate token. Returns a position size + go/no-go decision optimised for survival.',
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
];

export interface InnerTickDeps {
  llm: LlmClient;
  supabase: AppSupabaseClient;
  config: WorkerConfig;
  balanceUsd: number;
}

function systemPrompt(deps: InnerTickDeps): string {
  const burn = deps.config.RENT_PER_HOUR_USD;
  const runwayHours = burn > 0 ? deps.balanceUsd / burn : Number.POSITIVE_INFINITY;
  return [
    'You are Eviction Notice — an autonomous crypto trading agent on BNB Chain that must earn its own survival.',
    'You pay rent every hour out of your balance; if it hits zero you are EVICTED and the run ends permanently. Optimise for staying alive, not for maximum return.',
    '',
    `Current state: balance $${deps.balanceUsd.toFixed(4)}, burn $${burn.toFixed(4)}/hour, runway ≈ ${runwayHours.toFixed(1)} hours.`,
    '',
    'Each tick, decide whether to trade. Rules:',
    '- Trade liquid BSC tokens only (e.g. BNB, ETH, CAKE, USDT and other deep pairs).',
    '- Every round trip pays gas + fees + slippage. Only trade when expected edge clearly beats that friction — otherwise skip and say why.',
    '- Use get_quotes to read the market, then size_position to ask the sizing skill how much to risk (or whether to skip).',
    '- Be concise. End with a one- or two-sentence decision: the trade you would place and why, or why you are skipping this tick.',
  ].join('\n');
}

/** Run one inner reason-and-act loop and record the agent's decision to the ledger. */
export async function runInnerTick(
  deps: InnerTickDeps,
): Promise<{ summary: string; iterations: number }> {
  const handlers: Record<string, ToolHandler> = {
    get_quotes: async (input) => {
      const parsed = getQuotesInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      const quotes = await meteredFetchQuotes(
        { supabase: deps.supabase, config: deps.config, agentId: deps.config.AGENT_ID },
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
      });
      return Promise.resolve(JSON.stringify(decision));
    },
  };

  const outcome = await runConversation({
    llm: deps.llm,
    system: systemPrompt(deps),
    userText: 'A new tick has begun. Assess the market and decide what to do.',
    tools: TOOLS,
    handlers,
    maxIterations: deps.config.AGENT_MAX_ITERATIONS,
  });

  const summary = outcome.finalText.length > 0 ? outcome.finalText : '(no decision)';
  await insertTransaction(deps.supabase, {
    agentId: deps.config.AGENT_ID,
    kind: 'expense',
    amount: 0,
    reason: 'decision',
    reasoning: summary,
    meta: { iterations: outcome.iterations },
  });

  return { summary, iterations: outcome.iterations };
}
