import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchQuotes } from './cmc.ts';

const config = { apiKey: 'test-key', apiBase: 'https://pro-api.coinmarketcap.com' };

function mockFetch(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(payload) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchQuotes', () => {
  it('maps a v2 quotes response to TokenQuote[]', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: { error_code: 0, error_message: null },
        data: {
          BNB: [
            {
              id: 1839,
              symbol: 'BNB',
              quote: {
                USD: { price: 600, percent_change_24h: 1.5, volume_24h: 1000, market_cap: 9000 },
              },
            },
          ],
        },
      }),
    );

    const quotes = await fetchQuotes(config, ['BNB']);
    expect(quotes).toEqual([
      {
        cmcId: 1839,
        symbol: 'BNB',
        priceUsd: 600,
        percentChange24h: 1.5,
        volume24h: 1000,
        marketCap: 9000,
      },
    ]);
  });

  it('keeps the rank-1 coin and tolerates null-priced homonym tokens', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: { error_code: 0, error_message: null },
        data: {
          ETH: [
            {
              id: 1027,
              symbol: 'ETH',
              quote: {
                USD: { price: 1624, percent_change_24h: -2.3, volume_24h: 5, market_cap: 7 },
              },
            },
            // meme token squatting on the ticker — null price must not break parsing
            {
              id: 99_999,
              symbol: 'ETH',
              quote: {
                USD: { price: null, percent_change_24h: null, volume_24h: null, market_cap: null },
              },
            },
          ],
        },
      }),
    );

    const quotes = await fetchQuotes(config, ['ETH']);
    expect(quotes).toEqual([
      {
        cmcId: 1027,
        symbol: 'ETH',
        priceUsd: 1624,
        percentChange24h: -2.3,
        volume24h: 5,
        marketCap: 7,
      },
    ]);
  });

  it('throws on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 429));
    await expect(fetchQuotes(config, ['BNB'])).rejects.toThrow(/HTTP 429/);
  });

  it('throws on a CMC error_code', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ status: { error_code: 1001, error_message: 'Invalid API key' }, data: {} }),
    );
    await expect(fetchQuotes(config, ['BNB'])).rejects.toThrow(/Invalid API key/);
  });
});
