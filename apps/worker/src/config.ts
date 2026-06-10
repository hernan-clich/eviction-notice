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
