import { describe, expect, it } from 'vitest';

import { explorerAddressUrl, explorerTxUrl } from './explorer.ts';

describe('explorer urls', () => {
  it('builds mainnet tx + address links by default', () => {
    expect(explorerTxUrl('0xabc')).toBe('https://bscscan.com/tx/0xabc');
    expect(explorerAddressUrl('0xdef')).toBe('https://bscscan.com/address/0xdef');
  });

  it('targets testnet when asked', () => {
    expect(explorerTxUrl('0xabc', 'testnet')).toBe('https://testnet.bscscan.com/tx/0xabc');
  });
});
