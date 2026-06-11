import { decideSizing, type SizingInput } from 'skill';
import { describe, expect, it } from 'vitest';

import type { CommandRunner } from './execution.ts';
import { callSizingSkill } from './x402-client.ts';

const input: SizingInput = {
  balanceUsd: 20,
  peakBalanceUsd: 20,
  burnRatePerHourUsd: 0.07,
  edge: 0.03,
  volatility: 0.05,
  gasPerSwapUsd: 0.01,
  mustTrade: false,
};

const decision = decideSizing(input);

/** A command runner that always returns fixed stdout (no test-local closure). */
const stubRunner =
  (stdout: string): CommandRunner =>
  () =>
    Promise.resolve(stdout);

describe('callSizingSkill — permit2 (twak) path', () => {
  it('invokes `twak x402 request` and returns the decision + a real receipt', async () => {
    // The skill echoes the settle tx in the body (top-level transactionHash).
    const txHash = `0x${'cd'.repeat(32)}`;
    let captured: { cmd: string; args: string[] } | undefined;
    const run: CommandRunner = (cmd, args) => {
      captured = { cmd, args };
      return Promise.resolve(JSON.stringify({ ...decision, transactionHash: txHash }));
    };

    const result = await callSizingSkill(input, {
      url: 'https://skill.example.com',
      payer: '0xEdf33971BEed3Ede63D85B7ae3dDE8D18d21BE4b',
      settlement: 'permit2',
      maxPaymentAtomic: '10000000000000000',
      preferNetwork: 'bsc',
      run,
    });

    expect(result.decision).toEqual(decision);
    expect(result.receipt.simulated).toBe(false);
    expect(result.receipt.transaction).toBe(txHash);
    expect(result.receipt.payer).toBe('0xEdf33971BEed3Ede63D85B7ae3dDE8D18d21BE4b');

    expect(captured?.cmd).toBe('twak');
    const args = captured?.args ?? [];
    expect(args.slice(0, 3)).toEqual(['x402', 'request', 'https://skill.example.com/size']);
    expect(args).toContain('--auto-approve');
    expect(args).toContain('--json');
    expect(args[args.indexOf('--prefer-network') + 1]).toBe('bsc');
    expect(args[args.indexOf('--max-payment') + 1]).toBe('10000000000000000');
  });

  it('tolerates human log lines before the JSON and surfaces a settle tx hash', async () => {
    const txHash = `0x${'ab'.repeat(32)}`;
    const noisy = [
      'x402: paying 10000000000000000 USDT on eip155:56 (bsc)',
      'x402: payment authorization signed',
      JSON.stringify({ data: decision, transactionHash: txHash }),
    ].join('\n');
    const result = await callSizingSkill(input, {
      url: 'https://skill.example.com/',
      payer: '0xPayer',
      settlement: 'permit2',
      run: stubRunner(noisy),
    });

    expect(result.decision).toEqual(decision);
    expect(result.receipt.transaction).toBe(txHash);
  });

  it('throws when twak output carries no sizing decision', async () => {
    await expect(
      callSizingSkill(input, {
        url: 'https://skill.example.com',
        settlement: 'permit2',
        payer: '0x',
        run: stubRunner(JSON.stringify({ error: 'route not found' })),
      }),
    ).rejects.toThrow(/no sizing decision/i);
  });
});
