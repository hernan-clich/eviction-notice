import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { log, preview } from './log.ts';

/**
 * CoinMarketCap **AI Agent Hub** client — the MCP server (`mcp.coinmarketcap.com/mcp`)
 * that serves pre-computed trading signals the raw quotes API doesn't: RSI/MACD/MAs,
 * the Fear & Greed regime, and trending narratives. Using these scores higher in the
 * competition and is real alpha vs. eyeballing the 24h % change.
 *
 * We connect per call (a fresh streamable-HTTP session each time): the worker ticks
 * every ~30 min, so a persistent session would just go stale — a clean connect costs
 * a few hundred ms and never serves a dead socket. Auth is our existing CMC API key
 * (free tier), passed as the `X-CMC-MCP-API-KEY` header.
 */

/** Calls one Agent Hub MCP tool and returns its parsed JSON result. */
export type McpCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function createCmcMcpCaller(opts: {
  url: string;
  apiKey: string;
  logResponses?: boolean;
}): McpCaller {
  return async (name, args) => {
    const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
      requestInit: { headers: { 'X-CMC-MCP-API-KEY': opts.apiKey } },
    });
    const client = new Client({ name: 'eviction-notice', version: '1.0.0' }, { capabilities: {} });
    // The SDK transport satisfies Transport structurally; the cast sidesteps a known
    // exactOptionalPropertyTypes nit between the concrete class and the interface.
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    try {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as { text?: string }[];
      const text = content.map((c) => c.text ?? '').join('');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
      if (opts.logResponses) {
        log.info('cmc mcp response', { tool: name, args, response: preview(parsed) });
      }
      return parsed;
    } finally {
      await client.close();
    }
  };
}

/**
 * Strip the verbose human-readable `definition` strings the global-metrics tool
 * attaches to every metric — they're tokens the model doesn't need. Pure + recursive.
 */
export function stripDefinitions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => stripDefinitions(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'definition') continue;
      out[k] = stripDefinitions(v);
    }
    return out;
  }
  return value;
}

export interface TrendingNarrative {
  rank: number;
  name: string;
  marketCapChange24h: string;
  marketCapChange7d: string;
  topCoins: string[];
}

/**
 * Compact `trending_crypto_narratives` (a headers+rows table) into the top-N
 * narratives with their momentum + lead coins. Tolerant of the table shape.
 */
/** Coerce a table cell to text, ignoring non-primitive cells (avoids '[object Object]'). */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/** Pull the `rows` array out of a nested coin sub-table, tolerant of shape. */
function tableRows(value: unknown): unknown[][] {
  if (value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)) {
    return (value as { rows: unknown[][] }).rows;
  }
  return [];
}

export function compactTrending(raw: unknown, limit = 6): TrendingNarrative[] {
  const list = (raw as { categoryList?: { headers?: string[]; rows?: unknown[][] } }).categoryList;
  const headers = list?.headers ?? [];
  const rows = list?.rows ?? [];
  const col = (name: string): number => headers.indexOf(name);
  const iName = col('categoryName');
  const i24h = col('marketCapChangePercentage24h');
  const i7d = col('marketCapChangePercentage7d');
  const iRank = col('trendingRank');
  const iCoins = col('topCoinList');

  return rows.slice(0, limit).map((row, idx) => {
    const topCoins = tableRows(row[iCoins])
      .map((c) => (Array.isArray(c) ? asText(c[0]) : ''))
      .filter(Boolean)
      .slice(0, 3);
    const rank = row[iRank];
    return {
      rank: typeof rank === 'number' ? rank : idx + 1,
      name: asText(row[iName]) || 'unknown',
      marketCapChange24h: asText(row[i24h]),
      marketCapChange7d: asText(row[i7d]),
      topCoins,
    };
  });
}
