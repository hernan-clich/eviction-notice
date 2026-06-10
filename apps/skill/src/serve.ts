import { serve } from '@hono/node-server';

import { createSkillApp } from './server.ts';

/**
 * Boots the x402-gated sizing endpoint. Settlement lives on BSC (not Base) — we
 * own these payment requirements. Price/asset/payTo are env-driven so #14 can
 * pin the real BSC stablecoin + treasury address without code changes.
 */
const port = Number(process.env['SKILL_PORT'] ?? '8788');

const app = createSkillApp({
  network: process.env['X402_NETWORK'] ?? 'bsc',
  asset: process.env['X402_ASSET'] ?? 'USDT-BSC',
  // $0.01 at 18 decimals (BSC stablecoins are 18-decimal). Pinned for real in #14.
  priceAtomic: process.env['X402_PRICE_ATOMIC'] ?? '10000000000000000',
  payTo: process.env['X402_PAY_TO'] ?? '0x0000000000000000000000000000000000000000',
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[skill] x402 Solvency-Aware Sizing endpoint listening on :${info.port}`);
});
