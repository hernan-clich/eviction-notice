import { z } from 'zod';

/**
 * Minimal x402 wire format (protocol v1) shared by the skill server and the
 * worker client. The handshake is real — 402 → `X-PAYMENT` → 200 with an
 * `X-PAYMENT-RESPONSE` settlement receipt — but #10 settles with a *simulated*
 * on-chain reference (mirroring our simulated swap hashes). #15 swaps the
 * settlement seam for real USDC-on-BSC settlement via an x402 facilitator;
 * the wire format does not change.
 */
export const X402_VERSION = 1;

/** What the server demands before it will serve the resource. */
export const paymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  /** Settlement network, e.g. `bsc` / `bsc-testnet`. We choose BSC, not Base. */
  network: z.string(),
  /** Price in atomic units of `asset`, as a string (avoids float drift). */
  maxAmountRequired: z.string(),
  resource: z.string(),
  description: z.string(),
  mimeType: z.string(),
  /** Address the payment settles to. */
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().positive(),
  /** Token contract (or symbol placeholder until #14 pins the BSC stablecoin). */
  asset: z.string(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;

/** Body of a 402 response: the menu of acceptable payments. */
export const paymentRequiredBodySchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.string().optional(),
  accepts: z.array(paymentRequirementsSchema).min(1),
});
export type PaymentRequiredBody = z.infer<typeof paymentRequiredBodySchema>;

/** Decoded `X-PAYMENT` header the client sends to authorize a call. */
export const paymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  scheme: z.literal('exact'),
  network: z.string(),
  payload: z.object({
    payer: z.string(),
    amount: z.string(),
    /** Simulated settlement reference until #15 carries a real signed authorization. */
    txHash: z.string(),
    simulated: z.boolean(),
  }),
});
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;

/** Decoded `X-PAYMENT-RESPONSE` header: the settlement receipt. */
export const settlementReceiptSchema = z.object({
  success: z.boolean(),
  network: z.string(),
  payer: z.string(),
  transaction: z.string(),
  simulated: z.boolean(),
});
export type SettlementReceipt = z.infer<typeof settlementReceiptSchema>;

const toBase64 = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const fromBase64 = (header: string): unknown =>
  JSON.parse(Buffer.from(header, 'base64').toString('utf8'));

export function encodePaymentHeader(payload: PaymentPayload): string {
  return toBase64(payload);
}

export function decodePaymentHeader(header: string): PaymentPayload {
  return paymentPayloadSchema.parse(fromBase64(header));
}

export function encodeSettlementHeader(receipt: SettlementReceipt): string {
  return toBase64(receipt);
}

export function decodeSettlementHeader(header: string): SettlementReceipt {
  return settlementReceiptSchema.parse(fromBase64(header));
}
