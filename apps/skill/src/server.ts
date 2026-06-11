import { Hono } from 'hono';
import {
  X402_VERSION,
  decodeCanonicalPaymentHeader,
  decodePaymentHeader,
  encodeSettlementHeader,
  paymentRequiredBodySchema,
  type CanonicalPaymentRequirements,
  type PaymentRequirements,
  type SettlementReceipt,
} from 'shared';

import type { Settler } from './settlement.ts';
import { decideSizing, sizingInputSchema } from './sizing.ts';

export type SettlementMode = 'simulated' | 'permit2';

export interface SkillServerConfig {
  /** Settlement network. simulated: a label like `bsc`; permit2: CAIP-2 `eip155:56`. */
  network: string;
  /** simulated: a symbol placeholder; permit2: the real token contract. */
  asset: string;
  /** Price per call in atomic units of `asset`, as a string. */
  priceAtomic: string;
  /** Address the payment settles to (the treasury). */
  payTo: string;
  maxTimeoutSeconds?: number;
  /** Which settlement path to run. Defaults to `simulated` (the live paper run). */
  settlement?: SettlementMode;
  /** Real on-chain settler — required iff `settlement === 'permit2'`. */
  settle?: Settler;
}

// ---- simulated mode (the home-grown wire format, #10) -----------------------

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

function verifySimulatedPayment(header: string, config: SkillServerConfig): Verification {
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

function simulatedPaymentRequired(config: SkillServerConfig, error: string) {
  return paymentRequiredBodySchema.parse({
    x402Version: X402_VERSION,
    error,
    accepts: [requirementsFor(config)],
  });
}

// ---- permit2 mode (canonical x402, self-settled on BSC, #15) ----------------

function canonicalRequirementsFor(
  config: SkillServerConfig,
  resource: string,
): CanonicalPaymentRequirements {
  return {
    scheme: 'exact',
    network: config.network,
    // Emit both V2 (`amount`) and V1 (`maxAmountRequired`) names; TWAK reads `amount`.
    amount: config.priceAtomic,
    maxAmountRequired: config.priceAtomic,
    asset: config.asset,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    resource,
    description: 'Solvency-Aware Sizing — one survival-optimal position-sizing decision.',
    mimeType: 'application/json',
    extra: { assetTransferMethod: 'permit2', name: 'USDT', version: '1' },
  };
}

function canonicalPaymentRequired(config: SkillServerConfig, resource: string, error: string) {
  return {
    x402Version: X402_VERSION,
    error,
    accepts: [canonicalRequirementsFor(config, resource)],
  };
}

/** The x402-gated Solvency-Aware Sizing skill as a Hono app (no network binding). */
export function createSkillApp(config: SkillServerConfig): Hono {
  const mode: SettlementMode = config.settlement ?? 'simulated';
  if (mode === 'permit2' && !config.settle) {
    throw new Error(
      'X402_SETTLEMENT=permit2 requires a settler (SETTLER_PRIVATE_KEY + BSC_RPC_URL).',
    );
  }

  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/size', async (c) => {
    const header = c.req.header('X-PAYMENT');

    if (mode === 'permit2') {
      if (!header) {
        return c.json(canonicalPaymentRequired(config, c.req.url, 'Payment required.'), 402);
      }
      let payment;
      try {
        payment = decodeCanonicalPaymentHeader(header);
      } catch {
        return c.json(
          canonicalPaymentRequired(config, c.req.url, 'Malformed X-PAYMENT header.'),
          402,
        );
      }
      // Validate the request body before charging — never settle for a bad request.
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
      // Settle on-chain (verify-by-simulate then broadcast) before serving.
      let result;
      try {
        result = await config.settle!(payment);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'settlement failed';
        return c.json(canonicalPaymentRequired(config, c.req.url, message), 402);
      }
      const receipt: SettlementReceipt = {
        success: true,
        network: config.network,
        payer: payment.payload.permit2Authorization.from,
        transaction: result.txHash,
        simulated: false,
      };
      c.header('X-PAYMENT-RESPONSE', encodeSettlementHeader(receipt));
      // The TWAK client surfaces only the response body (not headers), so echo the
      // settle tx in the body too — the worker reads `transactionHash` to link the
      // on-chain proof in the feed. The decision schema ignores the extra field.
      return c.json({ ...decideSizing(parsed.data), transactionHash: result.txHash });
    }

    // simulated mode
    if (!header) {
      return c.json(simulatedPaymentRequired(config, 'Payment required to call this skill.'), 402);
    }
    const verified = verifySimulatedPayment(header, config);
    if (!verified.ok) {
      return c.json(simulatedPaymentRequired(config, verified.error), 402);
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
