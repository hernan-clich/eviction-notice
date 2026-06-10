import { z } from 'zod';

import type { WorkerConfig } from './config.ts';
import { insertTransaction, type AppSupabaseClient } from './supabase.ts';

/**
 * CoinMarketCap market-data client (REST Data API). Behind a small interface so
 * we can swap in the Agent Hub / MCP + real x402 path later (#15) without
 * touching callers. Each metered call records a `data_call` expense — the
 * agent literally pays to think.
 */

export interface CmcConfig {
  apiKey: string;
  apiBase: string;
}

/** Resolves CMC config from the worker env, throwing if the key is absent. */
export function cmcConfig(config: WorkerConfig): CmcConfig {
  if (!config.CMC_API_KEY) {
    throw new Error('CMC_API_KEY is not set — see apps/worker/.env.example.');
  }
  return { apiKey: config.CMC_API_KEY, apiBase: config.CMC_API_BASE };
}

// price/market_cap are nullable because meme tokens squat on real tickers (e.g.
// "ETH" returns several coins, most with null prices). We keep only the rank-1
// coin per symbol and skip null-priced ones.
const quoteSchema = z.object({
  price: z.number().nullable(),
  percent_change_24h: z.number().nullable(),
  volume_24h: z.number().nullable(),
  market_cap: z.number().nullable(),
});

const coinSchema = z.object({
  symbol: z.string(),
  quote: z.object({ USD: quoteSchema }),
});

// v2 quotes/latest returns an array of coins per symbol key.
const quotesResponseSchema = z.object({
  status: z.object({ error_code: z.number(), error_message: z.string().nullable() }),
  data: z.record(z.string(), z.array(coinSchema)),
});

export interface TokenQuote {
  symbol: string;
  priceUsd: number;
  percentChange24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
}

/** Fetch latest USD quotes for the given symbols. Network call, not metered. */
export async function fetchQuotes(config: CmcConfig, symbols: string[]): Promise<TokenQuote[]> {
  const url = new URL('/v2/cryptocurrency/quotes/latest', config.apiBase);
  url.searchParams.set('symbol', symbols.join(','));
  url.searchParams.set('convert', 'USD');

  const response = await fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': config.apiKey, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`CMC quotes: HTTP ${response.status}`);
  }

  const parsed = quotesResponseSchema.parse(await response.json());
  if (parsed.status.error_code !== 0) {
    throw new Error(`CMC quotes: ${parsed.status.error_message ?? 'unknown error'}`);
  }

  const quotes: TokenQuote[] = [];
  for (const coins of Object.values(parsed.data)) {
    // The first coin per symbol is the rank-1 (canonical) one; later homonyms
    // are meme tokens, often with a null price.
    const coin = coins[0];
    if (!coin) continue;
    const usd = coin.quote.USD;
    if (usd.price === null) continue;
    quotes.push({
      symbol: coin.symbol,
      priceUsd: usd.price,
      percentChange24h: usd.percent_change_24h,
      volume24h: usd.volume_24h,
      marketCap: usd.market_cap,
    });
  }
  return quotes;
}

export interface MeteredQuotesDeps {
  supabase: AppSupabaseClient;
  config: WorkerConfig;
  agentId: string;
}

/** Fetch quotes AND record the metered `data_call` expense in the same step. */
export async function meteredFetchQuotes(
  deps: MeteredQuotesDeps,
  symbols: string[],
): Promise<TokenQuote[]> {
  const quotes = await fetchQuotes(cmcConfig(deps.config), symbols);
  await insertTransaction(deps.supabase, {
    agentId: deps.agentId,
    kind: 'expense',
    amount: -deps.config.CMC_DATA_COST_USD,
    reason: 'data_call',
    reasoning: `Bought CMC quotes for ${symbols.join(', ')}.`,
    meta: { symbols, source: 'cmc/quotes' },
  });
  return quotes;
}
