import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { WorkerConfig } from './config.ts';
import { log } from './log.ts';

const execFileAsync = promisify(execFile);

/**
 * On-chain swap execution. Two modes behind one seam:
 *   - paper (default): a simulated tx hash, no funds move — current behaviour.
 *   - live: a real spot swap via the Trust Wallet Agent Kit CLI (`twak`). TWAK
 *     wants BSC *contract addresses*, not CMC symbols, so we resolve each symbol
 *     via `twak search` (TWAK's own token data — no hardcoded address map), run a
 *     quote-only preflight to confirm a route exists, then execute. It signs
 *     self-custody and returns the real BSC tx hash; the password comes from the
 *     TWAK_WALLET_PASSWORD env var (never the command line).
 *
 * Live is hard-guarded: it only runs when EXECUTION_MODE=live AND a password is
 * set, so no real funds can move until both are deliberately in place.
 */
export interface SwapResult {
  txHash: string;
  simulated: boolean;
  /** Amount of the `from` token actually spent (live only; null in paper mode). */
  inAmount: number | null;
  /** Amount of the `to` token actually received (live only; null in paper mode). */
  outAmount: number | null;
}

/** Parse a `twak` leg like "2.543021879315129031 ATOM" or "5 USDT" → the number. */
export function parseLegAmount(raw: unknown, key: 'input' | 'output'): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const [head] = value.trim().split(/\s+/);
  const n = Number(head);
  return Number.isFinite(n) ? n : null;
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
  for (const key of ['result', 'data', 'receipt']) {
    const nested = extractTxHash(obj[key]);
    if (nested) return nested;
  }
  return null;
}

const searchResultSchema = z.array(
  z
    .object({
      symbol: z.string(),
      address: z.string(),
      chain: z.string(),
      decimals: z.number().optional(),
    })
    .passthrough(),
);

const bscTokenCache = new Map<string, { address: string; decimals: number }>();

/** Clear the symbol→address cache (test seam). */
export function resetBscTokenCache(): void {
  bscTokenCache.clear();
}

/** Resolve a CMC symbol to its canonical BSC contract address via `twak search`. */
export async function resolveBscToken(
  symbol: string,
  run: CommandRunner = defaultRunner,
): Promise<{ address: string; decimals: number }> {
  const key = symbol.toUpperCase();
  const cached = bscTokenCache.get(key);
  if (cached) return cached;

  const stdout = await run('twak', ['search', symbol, '--networks', 'bsc', '--json']);
  let parsed;
  try {
    parsed = searchResultSchema.parse(JSON.parse(stdout));
  } catch {
    throw new Error(`twak search ${symbol}: unexpected output: ${stdout.slice(0, 200)}`);
  }
  const match = parsed.find((r) => r.chain === 'bsc' && r.symbol.toUpperCase() === key);
  if (!match) {
    throw new Error(`No BSC token found for symbol ${symbol}.`);
  }
  const resolved = { address: match.address, decimals: match.decimals ?? 18 };
  bscTokenCache.set(key, resolved);
  return resolved;
}

export interface TwakSwapArgs {
  amount: number;
  from: string;
  to: string;
  chain: string;
  slippagePct: number;
  quoteOnly?: boolean;
}

/** Run `twak swap` and return the parsed tx hash (null for a quote-only preview) + raw JSON. */
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

/** A quote is a route iff it carries an `output` leg (vs an `{error,...}` payload). */
function hasRoute(raw: unknown): boolean {
  return Boolean(raw) && typeof raw === 'object' && 'output' in (raw as Record<string, unknown>);
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
    return { txHash: simulatedTxHash(), simulated: true, inAmount: null, outAmount: null };
  }
  if (!deps.config.TWAK_WALLET_PASSWORD) {
    throw new Error('EXECUTION_MODE=live requires TWAK_WALLET_PASSWORD to sign swaps.');
  }

  const [fromSym, toSym] =
    args.side === 'open'
      ? [deps.config.TWAK_BASE_TOKEN, args.token]
      : [args.token, deps.config.TWAK_BASE_TOKEN];
  const from = await resolveBscToken(fromSym, deps.run);
  const to = await resolveBscToken(toSym, deps.run);

  const swapArgs: TwakSwapArgs = {
    amount: args.baseAmount,
    from: from.address,
    to: to.address,
    chain: deps.config.TWAK_CHAIN,
    slippagePct: deps.config.TWAK_SLIPPAGE_PCT,
  };

  // Preflight: a quote must return a route before we spend anything.
  const preflight = await twakSwap({ ...swapArgs, quoteOnly: true }, deps.run);
  if (!hasRoute(preflight.raw)) {
    throw new Error(`swap preflight failed ${fromSym}→${toSym}: ${JSON.stringify(preflight.raw)}`);
  }

  const exec = await twakSwap(swapArgs, deps.run);
  // Capture the real result shape for #15b reconciliation (received amounts, gas).
  log.info('live swap executed', { side: args.side, token: args.token, raw: exec.raw });
  if (!exec.txHash) {
    throw new Error(`twak swap returned no tx hash: ${JSON.stringify(exec.raw)}`);
  }
  return {
    txHash: exec.txHash,
    simulated: false,
    inAmount: parseLegAmount(exec.raw, 'input'),
    outAmount: parseLegAmount(exec.raw, 'output'),
  };
}
