import { z } from 'zod';

/**
 * x402 wire formats shared by the skill server and worker client. Two modes
 * behind one HTTP handshake (402 → `X-PAYMENT` → 200 + `X-PAYMENT-RESPONSE`):
 *
 *   - simulated (`X402_SETTLEMENT=simulated`, the default): a well-formed but
 *     *simulated* payment whose declared network + amount satisfy the skill, with
 *     a fabricated on-chain reference. The home-grown shape below (#10).
 *   - permit2 (`X402_SETTLEMENT=permit2`): the **canonical** x402 format that the
 *     TWAK CLI speaks — CAIP-2 network, `extra.assetTransferMethod`, and a Permit2
 *     witness authorization the skill self-settles on BSC by calling the canonical
 *     `x402ExactPermit2Proxy.settle(...)`. The `Canonical*` schemas below mirror,
 *     field-for-field, what `twak x402 request` actually emits (verified live).
 *
 * Both modes keep the same outer handshake; only the payload shape + settlement
 * differ. The simulated path stays so the live paper run never breaks.
 */
export const X402_VERSION = 1;

/** CAIP-2 chain id for BNB Smart Chain (canonical x402 `network`). */
export const CAIP2_BSC = 'eip155:56';
/** Canonical Permit2 contract (same address on every chain it's deployed to). */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
/** Canonical x402 Permit2 settlement proxy — the authorized `spender` TWAK signs for. */
export const X402_EXACT_PERMIT2_PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001';

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

// ---------------------------------------------------------------------------
// Canonical x402 (permit2 mode) — what the TWAK CLI speaks. Shapes verified
// against a live `twak x402 quote`/`request` capture.
// ---------------------------------------------------------------------------

export const ASSET_TRANSFER_METHODS = ['eip3009', 'permit2', 'erc7710'] as const;

/**
 * A canonical PaymentRequirements entry (one item in a 402's `accepts`). We emit
 * both `amount` (V2) and `maxAmountRequired` (V1) so either client generation
 * resolves a route; TWAK reads `amount`.
 */
export const canonicalPaymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  /** CAIP-2, e.g. `eip155:56`. */
  network: z.string(),
  /** Price in atomic units of `asset` (V2 name). */
  amount: z.string(),
  /** V1 alias for `amount`; optional on parse, emitted for compatibility. */
  maxAmountRequired: z.string().optional(),
  /** Token contract address. */
  asset: z.string(),
  /** Address the witness pins the payment to. */
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().positive(),
  resource: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  extra: z.object({
    assetTransferMethod: z.enum(ASSET_TRANSFER_METHODS),
    name: z.string().optional(),
    version: z.string().optional(),
  }),
});
export type CanonicalPaymentRequirements = z.infer<typeof canonicalPaymentRequirementsSchema>;

export const canonicalPaymentRequiredBodySchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.string().optional(),
  accepts: z.array(canonicalPaymentRequirementsSchema).min(1),
});
export type CanonicalPaymentRequiredBody = z.infer<typeof canonicalPaymentRequiredBodySchema>;

/**
 * The Permit2 witness authorization the payer signs. `spender` is the
 * x402ExactPermit2Proxy; `witness.to` is the payee. Numeric fields are decimal
 * strings (they hold uint256 — `nonce` exceeds Number.MAX_SAFE_INTEGER).
 */
export const permit2AuthorizationSchema = z.object({
  permitted: z.object({ token: z.string(), amount: z.string() }),
  from: z.string(),
  spender: z.string(),
  nonce: z.string(),
  deadline: z.string(),
  witness: z.object({ to: z.string(), validAfter: z.string() }),
});
export type Permit2Authorization = z.infer<typeof permit2AuthorizationSchema>;

/** Decoded canonical `X-PAYMENT` header (permit2 variant). */
export const canonicalPaymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  scheme: z.literal('exact'),
  network: z.string(),
  payload: z.object({
    signature: z.string(),
    permit2Authorization: permit2AuthorizationSchema,
  }),
});
export type CanonicalPaymentPayload = z.infer<typeof canonicalPaymentPayloadSchema>;

export function decodeCanonicalPaymentHeader(header: string): CanonicalPaymentPayload {
  return canonicalPaymentPayloadSchema.parse(fromBase64(header));
}

export function encodeCanonicalPaymentHeader(payload: CanonicalPaymentPayload): string {
  return toBase64(payload);
}
