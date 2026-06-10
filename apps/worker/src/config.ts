import { z } from 'zod';

/** Worker configuration, validated from the environment at boot. */
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  // New-scheme secret key (sb_secret_…) — bypasses RLS so the worker can write.
  SUPABASE_SECRET_KEY: z.string().min(1),
  AGENT_ID: z.string().min(1).default('agent-0'),
  SEED_USD: z.coerce.number().positive().default(20),
  RENT_PER_HOUR_USD: z.coerce.number().nonnegative().default(0.07),
  // 30 minutes by default (≈ 48 ticks/day). Lower for local testing.
  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(1_800_000),
  // 0 = run forever. > 0 stops after N ticks (local verification).
  MAX_TICKS: z.coerce.number().int().nonnegative().default(0),
  // CoinMarketCap — optional so the heartbeat boots without it; the data client
  // requires it at point of use. Cost is the simulated per-call data burn ($/think).
  CMC_API_KEY: z.string().min(1).optional(),
  CMC_API_BASE: z.string().url().default('https://pro-api.coinmarketcap.com'),
  CMC_DATA_COST_USD: z.coerce.number().nonnegative().default(0.01),
  // Anthropic — optional so the heartbeat boots without it; the inner loop needs it.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  // Max model turns per tick (tool-use loop guard).
  AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(6),
  // Gas estimate (USD/swap) fed to the sizing skill until live gas reads land (#14).
  GAS_PER_SWAP_USD: z.coerce.number().nonnegative().default(0.15),
  // Paper-trade friction: PancakeSwap V2 fee per side + expected slippage per swap.
  SWAP_FEE_RATE: z.coerce.number().nonnegative().default(0.0025),
  SLIPPAGE: z.coerce.number().nonnegative().default(0.001),
  // ≥1-trade/day floor: force a trade if none opened within this window. 0 disables.
  TRADE_FLOOR_MS: z.coerce.number().int().nonnegative().default(86_400_000),
  // Chain for explorer links on trades (BscScan). Real tx hashes land with #13.
  BSC_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  // x402-gated sizing skill (#10). Unset → the worker sizes in-process (tests, backtest).
  // When set, the agent pays its own skill to think (an `x402_fee` ledger expense).
  SKILL_URL: z.string().url().optional(),
  SKILL_CALL_COST_USD: z.coerce.number().nonnegative().default(0.01),
  // Payer address for x402 settlement. Placeholder until #14 funds the BSC wallet.
  X402_PAYER: z.string().min(1).default('0x0000000000000000000000000000000000000000'),
  // Swap execution (#13). 'paper' = simulated tx hashes (default). 'live' = real
  // spot swaps via the TWAK CLI — needs a funded burner (#14) + TWAK_WALLET_PASSWORD.
  EXECUTION_MODE: z.enum(['paper', 'live']).default('paper'),
  TWAK_CHAIN: z.string().min(1).default('bsc'),
  TWAK_BASE_TOKEN: z.string().min(1).default('USDT'),
  // TWAK reads this to sign headlessly; never passed on the command line.
  TWAK_WALLET_PASSWORD: z.string().min(1).optional(),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid worker configuration:\n  ${issues.join('\n  ')}`);
  }
  return parsed.data;
}
