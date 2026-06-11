import { serve } from '@hono/node-server';
import { CAIP2_BSC } from 'shared';

import { createSkillApp, type SkillServerConfig } from './server.ts';
import { createSettler } from './settlement.ts';

/**
 * Boots the x402-gated sizing endpoint.
 *
 * `X402_SETTLEMENT` selects the path:
 *   - `simulated` (default): the home-grown wire format, no funds move — the
 *     live paper run.
 *   - `permit2`: canonical x402, self-settled on BSC. Requires a funded settler
 *     wallet (`SETTLER_PRIVATE_KEY` + `BSC_RPC_URL`), the real USDT contract
 *     (`X402_ASSET`), and a treasury (`X402_PAY_TO`). Network is forced to BSC.
 */
const port = Number(process.env['PORT'] ?? process.env['SKILL_PORT'] ?? '8788');
const settlement = process.env['X402_SETTLEMENT'] === 'permit2' ? 'permit2' : 'simulated';
// $0.01 at 18 decimals (BSC stablecoins are 18-decimal).
const priceAtomic = process.env['X402_PRICE_ATOMIC'] ?? '10000000000000000';

let config: SkillServerConfig;

if (settlement === 'permit2') {
  const privateKey = process.env['SETTLER_PRIVATE_KEY'];
  const payTo = process.env['X402_PAY_TO'];
  const asset = process.env['X402_ASSET'];
  const rpcUrl = process.env['BSC_RPC_URL'] ?? 'https://bsc-dataseed.binance.org';

  if (!privateKey?.startsWith('0x')) {
    throw new Error('X402_SETTLEMENT=permit2 requires SETTLER_PRIVATE_KEY (0x-prefixed).');
  }
  if (!asset?.startsWith('0x')) {
    throw new Error(
      'X402_SETTLEMENT=permit2 requires X402_ASSET to be the token contract address.',
    );
  }
  if (!payTo?.startsWith('0x') || /^0x0+$/.test(payTo)) {
    throw new Error('X402_SETTLEMENT=permit2 requires a real X402_PAY_TO treasury address.');
  }

  const expect = { network: CAIP2_BSC, asset, priceAtomic, payTo };
  const { settle, address } = createSettler(
    { privateKey: privateKey as `0x${string}`, rpcUrl },
    expect,
  );
  console.log(`[skill] settlement=permit2 (BSC); settler/treasury wallet ${address}`);
  config = { network: CAIP2_BSC, asset, priceAtomic, payTo, settlement, settle };
} else {
  config = {
    network: process.env['X402_NETWORK'] ?? 'bsc',
    asset: process.env['X402_ASSET'] ?? 'USDT-BSC',
    priceAtomic,
    payTo: process.env['X402_PAY_TO'] ?? '0x0000000000000000000000000000000000000000',
    settlement: 'simulated',
  };
}

const app = createSkillApp(config);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[skill] x402 Solvency-Aware Sizing endpoint listening on :${info.port}`);
});
