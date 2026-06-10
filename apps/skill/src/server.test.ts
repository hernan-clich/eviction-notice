import {
  X402_VERSION,
  decodeSettlementHeader,
  encodePaymentHeader,
  paymentRequiredBodySchema,
} from 'shared';
import { describe, expect, it } from 'vitest';

import { createSkillApp, type SkillServerConfig } from './server.ts';
import { sizingDecisionSchema } from './sizing.ts';

const config: SkillServerConfig = {
  network: 'bsc',
  asset: 'USDT-BSC',
  priceAtomic: '10000000000000000',
  payTo: '0xTreasury',
};
const app = createSkillApp(config);

const validInput = {
  balanceUsd: 20,
  peakBalanceUsd: 20,
  burnRatePerHourUsd: 0.07,
  edge: 0.03,
  volatility: 0.05,
  gasPerSwapUsd: 0.15,
  mustTrade: false,
};

async function post(headers: Record<string, string>, body: unknown): Promise<Response> {
  return app.request('/size', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function payHeader(amount = config.priceAtomic, network = config.network): string {
  return encodePaymentHeader({
    x402Version: X402_VERSION,
    scheme: 'exact',
    network,
    payload: { payer: '0xPayer', amount, txHash: '0xdeadbeef', simulated: true },
  });
}

describe('x402 sizing skill', () => {
  it('demands payment (402 + requirements) when none is provided', async () => {
    const res = await post({}, validInput);
    expect(res.status).toBe(402);
    const body = paymentRequiredBodySchema.parse(await res.json());
    expect(body.accepts[0]?.network).toBe('bsc');
    expect(body.accepts[0]?.maxAmountRequired).toBe(config.priceAtomic);
  });

  it('serves a decision + settlement receipt on valid payment', async () => {
    const res = await post({ 'X-PAYMENT': payHeader() }, validInput);
    expect(res.status).toBe(200);
    const decision = sizingDecisionSchema.parse(await res.json());
    expect(['trade', 'skip']).toContain(decision.decision);
    const receipt = decodeSettlementHeader(res.headers.get('X-PAYMENT-RESPONSE') ?? '');
    expect(receipt.success).toBe(true);
    expect(receipt.payer).toBe('0xPayer');
    expect(receipt.simulated).toBe(true);
  });

  it('rejects underpayment with 402', async () => {
    const res = await post({ 'X-PAYMENT': payHeader('1') }, validInput);
    expect(res.status).toBe(402);
  });

  it('rejects a payment on the wrong network with 402', async () => {
    const res = await post({ 'X-PAYMENT': payHeader(config.priceAtomic, 'base') }, validInput);
    expect(res.status).toBe(402);
  });

  it('rejects invalid sizing input with 400 even when paid', async () => {
    const res = await post({ 'X-PAYMENT': payHeader() }, { edge: 0.01 });
    expect(res.status).toBe(400);
  });
});
