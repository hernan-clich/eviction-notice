/** BscScan explorer links — single source of truth for worker + dashboard. */

export type BscNetwork = 'mainnet' | 'testnet';

const EXPLORER_BASE: Record<BscNetwork, string> = {
  mainnet: 'https://bscscan.com',
  testnet: 'https://testnet.bscscan.com',
};

export function explorerTxUrl(txHash: string, network: BscNetwork = 'mainnet'): string {
  return `${EXPLORER_BASE[network]}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string, network: BscNetwork = 'mainnet'): string {
  return `${EXPLORER_BASE[network]}/address/${address}`;
}
