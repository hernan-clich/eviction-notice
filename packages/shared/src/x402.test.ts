import { describe, expect, it } from 'vitest';

import {
  X402_VERSION,
  decodePaymentHeader,
  decodeSettlementHeader,
  encodePaymentHeader,
  encodeSettlementHeader,
  type PaymentPayload,
  type SettlementReceipt,
} from './x402.ts';

describe('x402 header codecs', () => {
  it('round-trips a payment payload through base64', () => {
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: 'bsc',
      payload: { payer: '0xabc', amount: '10000000000000000', txHash: '0xdead', simulated: true },
    };
    expect(decodePaymentHeader(encodePaymentHeader(payload))).toEqual(payload);
  });

  it('round-trips a settlement receipt through base64', () => {
    const receipt: SettlementReceipt = {
      success: true,
      network: 'bsc',
      payer: '0xabc',
      transaction: '0xbeef',
      simulated: true,
    };
    expect(decodeSettlementHeader(encodeSettlementHeader(receipt))).toEqual(receipt);
  });

  it('throws on a malformed payment header', () => {
    expect(() => decodePaymentHeader('not-base64-json')).toThrow();
  });
});
