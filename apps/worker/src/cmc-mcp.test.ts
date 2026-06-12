import { describe, expect, it } from 'vitest';

import { compactTrending, stripDefinitions } from './cmc-mcp.ts';

describe('stripDefinitions', () => {
  it('recursively removes verbose `definition` keys, keeping the data', () => {
    const raw = {
      market_size: {
        definition: 'a long human-readable blurb the model does not need',
        total_crypto_market_cap_usd: { current: '2.18 T', percent_change: { '24h': '+1.68%' } },
      },
      sentiment: { definition: 'another blurb', fear_greed: { value: 32, label: 'Fear' } },
    };
    expect(stripDefinitions(raw)).toEqual({
      market_size: {
        total_crypto_market_cap_usd: { current: '2.18 T', percent_change: { '24h': '+1.68%' } },
      },
      sentiment: { fear_greed: { value: 32, label: 'Fear' } },
    });
  });

  it('passes through primitives and arrays', () => {
    expect(stripDefinitions([{ definition: 'x', keep: 1 }, 5])).toEqual([{ keep: 1 }, 5]);
  });
});

describe('compactTrending', () => {
  const raw = {
    categoryList: {
      headers: [
        'trendingRank',
        'categoryName',
        'marketCapChangePercentage24h',
        'marketCapChangePercentage7d',
        'topCoinList',
      ],
      rows: [
        [
          1,
          'Binance Ecosystem',
          '+2.27%',
          '+4.76%',
          { headers: ['coinSymbol'], rows: [['BTC'], ['ETH'], ['BNB'], ['CAKE']] },
        ],
        [2, 'AI Agents', '+5.1%', '-1.2%', { headers: ['coinSymbol'], rows: [['FET'], ['INJ']] }],
      ],
    },
  };

  it('compacts the headers+rows table into top narratives with momentum + lead coins', () => {
    const out = compactTrending(raw, 6);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      rank: 1,
      name: 'Binance Ecosystem',
      marketCapChange24h: '+2.27%',
      marketCapChange7d: '+4.76%',
      topCoins: ['BTC', 'ETH', 'BNB'], // capped at 3
    });
    expect(out[1]?.name).toBe('AI Agents');
  });

  it('respects the limit and tolerates a missing/empty table', () => {
    expect(compactTrending(raw, 1)).toHaveLength(1);
    expect(compactTrending({}, 6)).toEqual([]);
  });
});
