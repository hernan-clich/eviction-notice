import {
  CAIP2_BSC,
  X402_EXACT_PERMIT2_PROXY,
  X402_VERSION,
  canonicalPaymentRequiredBodySchema,
  decodeSettlementHeader,
  encodeCanonicalPaymentHeader,
  encodePaymentHeader,
  paymentRequiredBodySchema,
} from 'shared';
import { describe, expect, it, vi } from 'vitest';

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

const USDT = '0x55d398326f99059fF775485246999027B3197955';
const TREASURY = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';

function permit2Header(): string {
  return encodeCanonicalPaymentHeader({
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: CAIP2_BSC,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      permit2Authorization: {
        permitted: { token: USDT, amount: '10000000000000000' },
        from: '0xEdf33971BEed3Ede63D85B7ae3dDE8D18d21BE4b',
        spender: X402_EXACT_PERMIT2_PROXY,
        nonce: '12345',
        deadline: '1781202770',
        witness: { to: TREASURY, validAfter: '1781202650' },
      },
    },
  });
}

function permit2App(settle: () => Promise<{ txHash: string }>) {
  const spy = vi.fn(settle);
  const app = createSkillApp({
    network: CAIP2_BSC,
    asset: USDT,
    priceAtomic: '10000000000000000',
    payTo: TREASURY,
    settlement: 'permit2',
    settle: spy,
  });
  return { app, spy };
}

async function postTo(
  app: ReturnType<typeof createSkillApp>,
  headers: Record<string, string>,
  body: unknown,
) {
  return app.request('/size', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('x402 sizing skill — permit2 self-settle', () => {
  it('refuses to start in permit2 mode without a settler', () => {
    expect(() =>
      createSkillApp({
        network: CAIP2_BSC,
        asset: USDT,
        priceAtomic: '10000000000000000',
        payTo: TREASURY,
        settlement: 'permit2',
      }),
    ).toThrow(/requires a settler/i);
  });

  it('demands canonical payment (CAIP-2, permit2) when none is provided', async () => {
    const { app } = permit2App(() => Promise.resolve({ txHash: '0xabc' }));
    const res = await postTo(app, {}, validInput);
    expect(res.status).toBe(402);
    const body = canonicalPaymentRequiredBodySchema.parse(await res.json());
    expect(body.accepts[0]?.network).toBe('eip155:56');
    expect(body.accepts[0]?.amount).toBe('10000000000000000');
    expect(body.accepts[0]?.extra.assetTransferMethod).toBe('permit2');
  });

  it('settles on-chain then serves a decision + real receipt', async () => {
    const txHash = `0x${'ab'.repeat(32)}`;
    const { app, spy } = permit2App(() => Promise.resolve({ txHash }));
    const res = await postTo(app, { 'X-PAYMENT': permit2Header() }, validInput);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    const raw = (await res.json()) as Record<string, unknown>;
    const decision = sizingDecisionSchema.parse(raw);
    expect(['trade', 'skip']).toContain(decision.decision);
    // The settle tx is echoed in the body (so the TWAK client / worker can read it).
    expect(raw['transactionHash']).toBe(txHash);
    const receipt = decodeSettlementHeader(res.headers.get('X-PAYMENT-RESPONSE') ?? '');
    expect(receipt.success).toBe(true);
    expect(receipt.transaction).toBe(txHash);
    expect(receipt.simulated).toBe(false);
  });

  it('returns 402 when settlement fails (no charge, no service)', async () => {
    const { app } = permit2App(() => Promise.reject(new Error('settle: underpaid')));
    const res = await postTo(app, { 'X-PAYMENT': permit2Header() }, validInput);
    expect(res.status).toBe(402);
  });

  it('rejects a malformed canonical X-PAYMENT with 402', async () => {
    const { app, spy } = permit2App(() => Promise.resolve({ txHash: '0xabc' }));
    const res = await postTo(app, { 'X-PAYMENT': 'not-base64-canonical' }, validInput);
    expect(res.status).toBe(402);
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates the body before settling — bad input never charges', async () => {
    const { app, spy } = permit2App(() => Promise.resolve({ txHash: '0xabc' }));
    const res = await postTo(app, { 'X-PAYMENT': permit2Header() }, { edge: 0.01 });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
