import { z } from 'zod';

/** Worker configuration, validated from the environment at boot. */
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  // New-scheme secret key (sb_secret_…) — bypasses RLS so the worker can write.
  SUPABASE_SECRET_KEY: z.string().min(1),
  AGENT_ID: z.string().min(1).default('agent-0'),
  // Behaviour mode. 'survival' (default): the rent/eviction drama — optimise to
  // stay alive. 'compete': the judged-run brief — maximise total return, stay
  // deployed, never breach the drawdown cap, ≥1 trade/day. Drives the prompt +
  // sizer posture; pair with a low RENT_PER_HOUR_USD for the competition window.
  AGENT_MODE: z.enum(['survival', 'compete']).default('survival'),
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
  // CMC is free on our API key, so charging for data calls is pure fiction — it
  // muddied the P&L and littered the feed with made-up −$0.01 rows. Default to 0:
  // the data_call rows still log (informative — they show how we query the API),
  // they just cost nothing. Set > 0 only if you ever want a modeled data burn.
  CMC_DATA_COST_USD: z.coerce.number().nonnegative().default(0),
  // CMC AI Agent Hub MCP server — pre-computed RSI/MACD/Fear&Greed/trending signals
  // (auth via the same CMC_API_KEY, free tier). Scores higher + real alpha (#62).
  CMC_MCP_URL: z.string().url().default('https://mcp.coinmarketcap.com/mcp'),
  // Anthropic — optional so the heartbeat boots without it; the inner loop needs it.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  // Max model turns per tick (tool-use loop guard).
  AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(6),
  // Gas (USD/swap). Real BSC gas is ~0.1 Gwei ≈ $0.009/swap (observed live, #15) —
  // far below the old $0.15 estimate, so small trades are viable.
  GAS_PER_SWAP_USD: z.coerce.number().nonnegative().default(0.01),
  // Smallest viable position (#16). With cheap gas a $1 trade isn't pure friction.
  MIN_POSITION_USD: z.coerce.number().positive().default(1),
  // Cash the sizer keeps unspent to pay rent/data — this many hours of burn. Stops
  // the agent going all-in and starving its own metabolism (#16).
  CASH_RESERVE_HOURS: z.coerce.number().nonnegative().default(24),
  // Max-drawdown DQ gate (fraction of the net-worth high-water mark). Matches the
  // competition's ~30%. Guarded fiercely until breached; once breached the sizer
  // voids it (already disqualified → fight for survival).
  MAX_DRAWDOWN_FRACTION: z.coerce.number().positive().max(1).default(0.3),
  // Paper-trade friction: PancakeSwap V2 fee per side + expected slippage per swap.
  SWAP_FEE_RATE: z.coerce.number().nonnegative().default(0.0025),
  SLIPPAGE: z.coerce.number().nonnegative().default(0.001),
  // ≥1-trade/day floor: force a trade if none opened within this window. 0 disables.
  TRADE_FLOOR_MS: z.coerce.number().int().nonnegative().default(86_400_000),
  // Chain for explorer links on trades (BscScan). Real tx hashes land with #13.
  BSC_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  // BSC RPC for the live gas-tank (BNB) check, and the warn threshold in BNB (#16).
  BSC_RPC_URL: z.string().url().default('https://bsc-dataseed.binance.org'),
  MIN_BNB_GAS: z.coerce.number().nonnegative().default(0.0005),
  // x402-gated sizing skill (#10). Unset → the worker sizes in-process (tests, backtest).
  // When set, the agent pays its own skill to think (an `x402_fee` ledger expense).
  SKILL_URL: z.string().url().optional(),
  SKILL_CALL_COST_USD: z.coerce.number().nonnegative().default(0.01),
  // Payer address for x402 settlement. Placeholder until #14 funds the BSC wallet.
  X402_PAYER: z.string().min(1).default('0x0000000000000000000000000000000000000000'),
  // x402 settlement path. 'simulated' (default): a fabricated on-chain reference,
  // no funds move (#10). 'permit2': the agent really pays the skill over x402 via
  // the TWAK CLI (`twak x402 request`), settled on BSC by the skill (#15).
  X402_SETTLEMENT: z.enum(['simulated', 'permit2']).default('simulated'),
  // Max the agent will auto-approve per x402 call, in atomic units of the payment
  // token ($0.01 USDT @ 18dp). Must be ≥ the skill's price; caps run-away spend.
  X402_MAX_PAYMENT_ATOMIC: z.string().min(1).default('10000000000000000'),
  // Swap execution (#13). 'paper' = simulated tx hashes (default). 'live' = real
  // spot swaps via the TWAK CLI — needs a funded burner (#14) + TWAK_WALLET_PASSWORD.
  EXECUTION_MODE: z.enum(['paper', 'live']).default('paper'),
  TWAK_CHAIN: z.string().min(1).default('bsc'),
  TWAK_BASE_TOKEN: z.string().min(1).default('USDT'),
  // Live swap slippage TOLERANCE (percent) for the TWAK swap — distinct from the
  // paper SLIPPAGE cost estimate. 0.1% reverts on real AMMs; 1% is the safe default.
  TWAK_SLIPPAGE_PCT: z.coerce.number().positive().max(50).default(1),
  // TWAK reads this to sign headlessly; never passed on the command line.
  TWAK_WALLET_PASSWORD: z.string().min(1).optional(),
  // Verbose observability: log raw CMC/MCP/Claude/skill responses (truncated).
  // On by default; set LOG_RESPONSES=false to quiet it.
  LOG_RESPONSES: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
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
