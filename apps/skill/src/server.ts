import { Hono } from 'hono';
import {
  X402_VERSION,
  decodePaymentHeader,
  encodeSettlementHeader,
  paymentRequiredBodySchema,
  type PaymentRequirements,
  type SettlementReceipt,
} from 'shared';

import { decideSizing, sizingInputSchema } from './sizing.ts';

export interface SkillServerConfig {
  /** Settlement network we demand payment on — BSC, not Base. */
  network: string;
  /** Token contract or symbol placeholder until #14 pins the BSC stablecoin. */
  asset: string;
  /** Price per call in atomic units of `asset`, as a string. */
  priceAtomic: string;
  /** Address the payment settles to. */
  payTo: string;
  maxTimeoutSeconds?: number;
}

function requirementsFor(config: SkillServerConfig): PaymentRequirements {
  return {
    scheme: 'exact',
    network: config.network,
    maxAmountRequired: config.priceAtomic,
    resource: '/size',
    description: 'Solvency-Aware Sizing — one survival-optimal position-sizing decision.',
    mimeType: 'application/json',
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    asset: config.asset,
  };
}

type Verification = { ok: true; receipt: SettlementReceipt } | { ok: false; error: string };

/**
 * Verify the `X-PAYMENT` header. #10 accepts a well-formed simulated payment whose
 * declared network + amount satisfy our requirements; the real on-chain settlement
 * check (facilitator verify/settle on BSC) replaces this seam in #15. The wire
 * format does not change between the two.
 */
function verifyPayment(header: string, config: SkillServerConfig): Verification {
  let payment;
  try {
    payment = decodePaymentHeader(header);
  } catch {
    return { ok: false, error: 'Malformed X-PAYMENT header.' };
  }
  if (payment.network !== config.network) {
    return { ok: false, error: `Wrong settlement network: expected ${config.network}.` };
  }
  if (BigInt(payment.payload.amount) < BigInt(config.priceAtomic)) {
    return { ok: false, error: 'Underpaid for this resource.' };
  }
  return {
    ok: true,
    receipt: {
      success: true,
      network: config.network,
      payer: payment.payload.payer,
      transaction: payment.payload.txHash,
      simulated: payment.payload.simulated,
    },
  };
}

function paymentRequired(config: SkillServerConfig, error: string) {
  return paymentRequiredBodySchema.parse({
    x402Version: X402_VERSION,
    error,
    accepts: [requirementsFor(config)],
  });
}

/** The x402-gated Solvency-Aware Sizing skill as a Hono app (no network binding). */
export function createSkillApp(config: SkillServerConfig): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/size', async (c) => {
    const header = c.req.header('X-PAYMENT');
    if (!header) {
      return c.json(paymentRequired(config, 'Payment required to call this skill.'), 402);
    }
    const verified = verifyPayment(header, config);
    if (!verified.ok) {
      return c.json(paymentRequired(config, verified.error), 402);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body.' }, 400);
    }
    const parsed = sizingInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    c.header('X-PAYMENT-RESPONSE', encodeSettlementHeader(verified.receipt));
    return c.json(decideSizing(parsed.data));
  });

  return app;
}
