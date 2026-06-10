import { randomBytes } from 'node:crypto';

import {
  X402_VERSION,
  decodeSettlementHeader,
  encodePaymentHeader,
  paymentRequiredBodySchema,
  type SettlementReceipt,
} from 'shared';
import { sizingDecisionSchema, type SizingDecision, type SizingInput } from 'skill';

export interface SkillClientConfig {
  /** Base URL of the x402-gated skill, e.g. http://localhost:8788. */
  url: string;
  /** Our payer address (placeholder until #14 funds the BSC wallet). */
  payer: string;
}

export interface SkillCallResult {
  decision: SizingDecision;
  receipt: SettlementReceipt;
}

/** Simulated BSC settlement reference — replaced by a real signed authorization in #15. */
function simulatedTxHash(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

/**
 * Pay-to-think: call the x402-gated sizing skill via the real handshake
 * (request → 402 → `X-PAYMENT` → 200). #10 authorizes with a simulated BSC
 * payment; the settlement seam goes real in #15. Throws on any non-402 failure
 * so the caller can fall back rather than trade on a bad size.
 */
export async function callSizingSkill(
  input: SizingInput,
  config: SkillClientConfig,
): Promise<SkillCallResult> {
  const endpoint = `${config.url.replace(/\/$/, '')}/size`;
  const send = async (headers: Record<string, string>): Promise<Response> =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(input),
    });

  let res = await send({});
  if (res.status === 402) {
    const body = paymentRequiredBodySchema.parse(await res.json());
    const [accept] = body.accepts;
    if (!accept) {
      throw new Error('Skill returned 402 with no payment requirements.');
    }
    const header = encodePaymentHeader({
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: accept.network,
      payload: {
        payer: config.payer,
        amount: accept.maxAmountRequired,
        txHash: simulatedTxHash(),
        simulated: true,
      },
    });
    res = await send({ 'X-PAYMENT': header });
  }

  if (!res.ok) {
    throw new Error(`Skill call failed: ${res.status} ${await res.text()}`);
  }

  const decision = sizingDecisionSchema.parse(await res.json());
  const receiptHeader = res.headers.get('X-PAYMENT-RESPONSE');
  // The receipt header is always set on success; the fallback only keeps the
  // ledger row well-formed if a proxy ever strips it.
  const receipt: SettlementReceipt = receiptHeader
    ? decodeSettlementHeader(receiptHeader)
    : { success: true, network: 'unknown', payer: config.payer, transaction: '', simulated: true };
  return { decision, receipt };
}
