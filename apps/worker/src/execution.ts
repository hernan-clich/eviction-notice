import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import type { WorkerConfig } from './config.ts';

const execFileAsync = promisify(execFile);

/**
 * On-chain swap execution. Two modes behind one seam:
 *   - paper (default): a simulated tx hash, no funds move — current behaviour.
 *   - live: a real spot swap via the Trust Wallet Agent Kit CLI (`twak`), which
 *     signs self-custody and returns the real BSC tx hash. TWAK reads the wallet
 *     password from the TWAK_WALLET_PASSWORD env var (never the command line), so
 *     the secret stays out of process args / shell history.
 *
 * Live is hard-guarded: it only runs when EXECUTION_MODE=live AND a password is
 * set, so no real funds can move until both are deliberately in place (#14).
 */
export interface SwapResult {
  txHash: string;
  simulated: boolean;
}

/** Injectable command runner (default = real execFile) so tests never spawn `twak`. */
export type CommandRunner = (cmd: string, args: string[]) => Promise<string>;

const defaultRunner: CommandRunner = async (cmd, args) => {
  const { stdout } = await execFileAsync(cmd, args, { timeout: 120_000 });
  return stdout;
};

function simulatedTxHash(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

/** Pull the on-chain tx hash out of `twak --json` output, tolerant of the exact key. */
export function extractTxHash(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  for (const key of ['txHash', 'transactionHash', 'hash', 'tx', 'transaction']) {
    const value = obj[key];
    if (typeof value === 'string' && value.startsWith('0x')) {
      return value;
    }
  }
  // Some CLIs nest the receipt under `result`/`data`.
  for (const key of ['result', 'data', 'receipt']) {
    const nested = extractTxHash(obj[key]);
    if (nested) return nested;
  }
  return null;
}

export interface TwakSwapArgs {
  amount: number;
  from: string;
  to: string;
  chain: string;
  slippagePct: number;
  quoteOnly?: boolean;
}

/** Run `twak swap` and return the parsed tx hash (null for a quote-only preview). */
export async function twakSwap(
  args: TwakSwapArgs,
  run: CommandRunner = defaultRunner,
): Promise<{ txHash: string | null; raw: unknown }> {
  const cli = [
    'swap',
    String(args.amount),
    args.from,
    args.to,
    '--chain',
    args.chain,
    '--slippage',
    String(args.slippagePct),
    '--json',
  ];
  if (args.quoteOnly) {
    cli.push('--quote-only');
  }

  const stdout = await run('twak', cli);
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(`twak swap: non-JSON output: ${stdout.slice(0, 200)}`);
  }
  return { txHash: args.quoteOnly ? null : extractTxHash(json), raw: json };
}

export interface SwapExecutorDeps {
  config: WorkerConfig;
  run?: CommandRunner;
}

/**
 * Execute (or simulate) a spot swap.
 * - open:  spend `baseAmount` of the base token (USDT) to buy `token`.
 * - close: sell `baseAmount` of `token` back to the base token.
 */
export async function executeSwap(
  deps: SwapExecutorDeps,
  args: { side: 'open' | 'close'; token: string; baseAmount: number },
): Promise<SwapResult> {
  if (deps.config.EXECUTION_MODE !== 'live') {
    return { txHash: simulatedTxHash(), simulated: true };
  }
  if (!deps.config.TWAK_WALLET_PASSWORD) {
    throw new Error('EXECUTION_MODE=live requires TWAK_WALLET_PASSWORD to sign swaps.');
  }
  const [from, to] =
    args.side === 'open'
      ? [deps.config.TWAK_BASE_TOKEN, args.token]
      : [args.token, deps.config.TWAK_BASE_TOKEN];
  const { txHash } = await twakSwap(
    {
      amount: args.baseAmount,
      from,
      to,
      chain: deps.config.TWAK_CHAIN,
      slippagePct: deps.config.SLIPPAGE * 100,
    },
    deps.run,
  );
  if (!txHash) {
    throw new Error('twak swap returned no tx hash.');
  }
  return { txHash, simulated: false };
}
