import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.ts';
import { executeSwap, extractTxHash, twakSwap, type CommandRunner } from './execution.ts';

function cfg(overrides: Record<string, string> = {}) {
  return loadConfig({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    ...overrides,
  });
}

const quoteRunner: CommandRunner = () => Promise.resolve(JSON.stringify({ price: 1.23 }));
const nonJsonRunner: CommandRunner = () => Promise.resolve('not json');

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

  it('live open swaps base → token via twak and returns the real hash', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (cmd, args) => {
      calls.push([cmd, ...args]);
      return Promise.resolve(JSON.stringify({ txHash: '0xrealhash' }));
    };
    const res = await executeSwap(
      {
        config: cfg({ EXECUTION_MODE: 'live', TWAK_WALLET_PASSWORD: 'pw', SLIPPAGE: '0.01' }),
        run,
      },
      { side: 'open', token: 'AAVE', baseAmount: 12 },
    );
    expect(res).toEqual({ txHash: '0xrealhash', simulated: false });
    expect(calls[0]).toEqual([
      'twak',
      'swap',
      '12',
      'USDT',
      'AAVE',
      '--chain',
      'bsc',
      '--slippage',
      '1',
      '--json',
    ]);
  });

  it('live close swaps token → base', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (cmd, args) => {
      calls.push([cmd, ...args]);
      return Promise.resolve(JSON.stringify({ hash: '0xclosehash' }));
    };
    const res = await executeSwap(
      { config: cfg({ EXECUTION_MODE: 'live', TWAK_WALLET_PASSWORD: 'pw' }), run },
      { side: 'close', token: 'AAVE', baseAmount: 6 },
    );
    expect(res.txHash).toBe('0xclosehash');
    expect(calls[0]?.slice(0, 5)).toEqual(['twak', 'swap', '6', 'AAVE', 'USDT']);
  });
});

describe('twakSwap', () => {
  it('adds --quote-only and returns a null hash for previews', async () => {
    const { txHash } = await twakSwap(
      { amount: 1, from: 'USDT', to: 'AAVE', chain: 'bsc', slippagePct: 1, quoteOnly: true },
      quoteRunner,
    );
    expect(txHash).toBeNull();
  });

  it('throws on non-JSON output', async () => {
    await expect(
      twakSwap(
        { amount: 1, from: 'USDT', to: 'AAVE', chain: 'bsc', slippagePct: 1 },
        nonJsonRunner,
      ),
    ).rejects.toThrow(/non-JSON/);
  });
});
