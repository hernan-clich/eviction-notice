import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.ts';
import {
  executeSwap,
  extractTxHash,
  resetBscTokenCache,
  resolveBscToken,
  twakSwap,
  type CommandRunner,
} from './execution.ts';

function cfg(overrides: Record<string, string> = {}) {
  return loadConfig({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    ...overrides,
  });
}

const ADDR: Record<string, string> = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  AAVE: '0xfb6115445Bff7b52FeB98650C87f44907E58f802',
};

/** A `twak` mock that answers search/quote/swap from in-memory data. */
function mockTwak(opts: { quoteHasRoute?: boolean } = {}): {
  run: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const run: CommandRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'search') {
      const sym = (args[1] ?? '').toUpperCase();
      return Promise.resolve(
        JSON.stringify([
          { symbol: sym, address: ADDR[sym] ?? '0xUNKNOWN', chain: 'bsc', decimals: 18 },
        ]),
      );
    }
    if (args.includes('--quote-only')) {
      return Promise.resolve(
        JSON.stringify(
          opts.quoteHasRoute === false
            ? { error: 'No route', errorCode: 'NO_ROUTE' }
            : { input: '4 USDT', output: '3.05 AAVE', minReceived: '3.02 AAVE', priceImpact: '0' },
        ),
      );
    }
    return Promise.resolve(JSON.stringify({ txHash: '0xrealhash', output: '3.05 AAVE' }));
  };
  return { run, calls };
}

const quoteRunner: CommandRunner = () => Promise.resolve(JSON.stringify({ price: 1.23 }));
const nonJsonRunner: CommandRunner = () => Promise.resolve('not json');
const ethereumOnlyRunner: CommandRunner = () =>
  Promise.resolve(
    JSON.stringify([{ symbol: 'X', address: '0x1', chain: 'ethereum', decimals: 18 }]),
  );

beforeEach(() => {
  resetBscTokenCache();
});

describe('extractTxHash', () => {
  it('finds the hash across common keys + nesting, else null', () => {
    expect(extractTxHash({ txHash: '0xabc' })).toBe('0xabc');
    expect(extractTxHash({ transactionHash: '0xdef' })).toBe('0xdef');
    expect(extractTxHash({ result: { hash: '0x123' } })).toBe('0x123');
    expect(extractTxHash({ status: 'ok' })).toBeNull();
    expect(extractTxHash({ txHash: 'not-hex' })).toBeNull();
    expect(extractTxHash(null)).toBeNull();
  });
});

describe('resolveBscToken', () => {
  it('resolves a symbol to its BSC address and caches it', async () => {
    const { run, calls } = mockTwak();
    const a = await resolveBscToken('AAVE', run);
    expect(a.address).toBe(ADDR['AAVE']);
    const b = await resolveBscToken('AAVE', run);
    expect(b.address).toBe(ADDR['AAVE']);
    expect(calls.filter((c) => c[1] === 'search')).toHaveLength(1); // second call cached
  });

  it('throws when the symbol has no BSC token', async () => {
    await expect(resolveBscToken('X', ethereumOnlyRunner)).rejects.toThrow(/No BSC token/);
  });
});

describe('executeSwap', () => {
  it('paper mode returns a simulated hash without running twak', async () => {
    const run = vi.fn<CommandRunner>();
    const res = await executeSwap(
      { config: cfg(), run },
      { side: 'open', token: 'AAVE', baseAmount: 12 },
    );
    expect(res.simulated).toBe(true);
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(run).not.toHaveBeenCalled();
  });

  it('live mode requires a wallet password', async () => {
    await expect(
      executeSwap(
        { config: cfg({ EXECUTION_MODE: 'live' }) },
        { side: 'open', token: 'AAVE', baseAmount: 12 },
      ),
    ).rejects.toThrow(/TWAK_WALLET_PASSWORD/);
  });

  it('live open resolves addresses, preflights, and swaps USDT → token', async () => {
    const { run, calls } = mockTwak();
    const res = await executeSwap(
      { config: cfg({ EXECUTION_MODE: 'live', TWAK_WALLET_PASSWORD: 'pw' }), run },
      { side: 'open', token: 'AAVE', baseAmount: 4 },
    );
    expect(res).toEqual({ txHash: '0xrealhash', simulated: false });
    expect(calls.some((c) => c.includes('--quote-only'))).toBe(true); // preflight ran
    const exec = calls.find((c) => c[1] === 'swap' && !c.includes('--quote-only'));
    expect(exec?.slice(2, 5)).toEqual(['4', ADDR['USDT'], ADDR['AAVE']]); // base → token, by address
  });

  it('live close swaps token → USDT by address', async () => {
    const { run, calls } = mockTwak();
    await executeSwap(
      { config: cfg({ EXECUTION_MODE: 'live', TWAK_WALLET_PASSWORD: 'pw' }), run },
      { side: 'close', token: 'AAVE', baseAmount: 3 },
    );
    const exec = calls.find((c) => c[1] === 'swap' && !c.includes('--quote-only'));
    expect(exec?.slice(2, 5)).toEqual(['3', ADDR['AAVE'], ADDR['USDT']]);
  });

  it('aborts when the preflight quote has no route', async () => {
    const { run } = mockTwak({ quoteHasRoute: false });
    await expect(
      executeSwap(
        { config: cfg({ EXECUTION_MODE: 'live', TWAK_WALLET_PASSWORD: 'pw' }), run },
        { side: 'open', token: 'AAVE', baseAmount: 4 },
      ),
    ).rejects.toThrow(/preflight failed/);
  });
});

describe('twakSwap', () => {
  it('adds --quote-only and returns a null hash for previews', async () => {
    const { txHash } = await twakSwap(
      { amount: 1, from: 'a', to: 'b', chain: 'bsc', slippagePct: 1, quoteOnly: true },
      quoteRunner,
    );
    expect(txHash).toBeNull();
  });

  it('throws on non-JSON output', async () => {
    await expect(
      twakSwap({ amount: 1, from: 'a', to: 'b', chain: 'bsc', slippagePct: 1 }, nonJsonRunner),
    ).rejects.toThrow(/non-JSON/);
  });
});
