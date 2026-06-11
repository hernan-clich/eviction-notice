import { randomBytes } from 'node:crypto';

import {
  X402_VERSION,
  decodeSettlementHeader,
  encodePaymentHeader,
  paymentRequiredBodySchema,
  type SettlementReceipt,
} from 'shared';
import { sizingDecisionSchema, type SizingDecision, type SizingInput } from 'skill';

import { defaultRunner, extractTxHash, type CommandRunner } from './execution.ts';
import { log } from './log.ts';

export interface SkillClientConfig {
  /** Base URL of the x402-gated skill, e.g. http://localhost:8788. */
  url: string;
  /** Our payer address (the funded BSC burner). */
  payer: string;
  /** Settlement path. 'simulated' (default) or real 'permit2' via the TWAK CLI. */
  settlement?: 'simulated' | 'permit2';
  /** permit2: `--max-payment` cap, atomic units of the payment token. */
  maxPaymentAtomic?: string;
  /** permit2: chain to restrict the route to (e.g. `bsc`). */
  preferNetwork?: string;
  /** permit2: injectable command runner (default = real `twak` via execFile). */
  run?: CommandRunner;
}

export interface SkillCallResult {
  decision: SizingDecision;
  receipt: SettlementReceipt;
}

/** Simulated BSC settlement reference (simulated mode only). */
function simulatedTxHash(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

/**
 * Pay-to-think: call the x402-gated sizing skill.
 *   - simulated: the real handshake (request → 402 → `X-PAYMENT` → 200) with a
 *     well-formed *simulated* authorization. No funds move (#10).
 *   - permit2: the agent really pays over x402 — `twak x402 request` signs a
 *     Permit2 authorization and the skill self-settles it on BSC (#15).
 * Throws on any failure so the caller falls back rather than trading on a bad size.
 */
export async function callSizingSkill(
  input: SizingInput,
  config: SkillClientConfig,
): Promise<SkillCallResult> {
  if ((config.settlement ?? 'simulated') === 'permit2') {
    return callViaTwak(input, config);
  }
  return callViaSimulated(input, config);
}

// ---- permit2: real payment via the TWAK x402 client -------------------------

async function callViaTwak(
  input: SizingInput,
  config: SkillClientConfig,
): Promise<SkillCallResult> {
  const run = config.run ?? defaultRunner;
  const network = config.preferNetwork ?? 'bsc';
  const endpoint = `${config.url.replace(/\/$/, '')}/size`;
  const args = [
    'x402',
    'request',
    endpoint,
    '--method',
    'POST',
    '--body',
    JSON.stringify(input),
    '--prefer-network',
    network,
    '--max-payment',
    config.maxPaymentAtomic ?? '10000000000000000',
    // Non-interactive: pay up to --max-payment and broadcast the one-time
    // Permit2 approval if this token hasn't been approved on this chain yet.
    '--yes',
    '--auto-approve',
    '--json',
  ];

  const stdout = await run('twak', args);
  const json = parseTwakJson(stdout);
  // Capture the real shape for diagnosis on the first live call.
  log.info('x402 paid via twak', { raw: json });

  const decision = extractDecision(json);
  // The skill self-settles and returns the tx in X-PAYMENT-RESPONSE; surface it
  // if twak echoes it, else leave empty (the payment still happened).
  const transaction = extractTxHash(json) ?? '';
  return {
    decision,
    receipt: { success: true, network, payer: config.payer, transaction, simulated: false },
  };
}

/** Parse twak's `--json` stdout, tolerating any human log lines printed alongside. */
function parseTwakJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to a best-effort slice */
  }
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new Error(`twak x402 request: could not parse JSON output: ${trimmed.slice(0, 200)}`);
}

/** Pull the sizing decision out of twak's output (direct body or a common wrapper). */
function extractDecision(json: unknown): SizingDecision {
  const direct = sizingDecisionSchema.safeParse(json);
  if (direct.success) return direct.data;
  if (json && typeof json === 'object') {
    for (const key of ['data', 'body', 'response', 'result', 'json']) {
      const nested = sizingDecisionSchema.safeParse((json as Record<string, unknown>)[key]);
      if (nested.success) return nested.data;
    }
  }
  throw new Error(
    `twak x402 request: no sizing decision in output: ${JSON.stringify(json).slice(0, 200)}`,
  );
}

// ---- simulated: the home-grown handshake (#10) ------------------------------

async function callViaSimulated(
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
  const receipt: SettlementReceipt = receiptHeader
    ? decodeSettlementHeader(receiptHeader)
    : { success: true, network: 'unknown', payer: config.payer, transaction: '', simulated: true };
  return { decision, receipt };
}
