import { X402_EXACT_PERMIT2_PROXY, type CanonicalPaymentPayload } from 'shared';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

/**
 * Real x402 settlement on BSC. The payer (TWAK) signs a Permit2 *witness*
 * authorization naming the canonical `x402ExactPermit2Proxy` as spender; we
 * settle it by calling `proxy.settle(...)` from our own funded wallet, which
 * pulls the agreed USDT from the payer to `witness.to` via Permit2.
 *
 * We don't re-derive the EIP-712 signature ourselves — Permit2 + the proxy
 * enforce it on-chain, so a `simulateContract` dry-run is the honest verify:
 * it reverts on a bad signature, expiry, insufficient balance, or missing
 * Permit2 allowance. We add cheap field checks first so a payment that doesn't
 * actually pay *our* treasury is rejected before we ever touch the chain.
 */

/** Minimal ABI for x402ExactPermit2Proxy.settle (see specs/schemes/exact). */
const PROXY_ABI = [
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'permit',
        type: 'tuple',
        components: [
          {
            name: 'permitted',
            type: 'tuple',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { name: 'owner', type: 'address' },
      {
        name: 'witness',
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'validAfter', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export interface SettlerConfig {
  /** 0x-prefixed private key of the settler/treasury wallet (holds BNB for gas). */
  privateKey: Hex;
  /** BSC JSON-RPC endpoint. */
  rpcUrl: string;
}

/** What the skill demands the payment satisfy before it will settle + serve. */
export interface SettleExpectations {
  /** CAIP-2 network we settle on, e.g. `eip155:56`. */
  network: string;
  /** Token contract the payment must be denominated in. */
  asset: string;
  /** Minimum atomic amount (the price). */
  priceAtomic: string;
  /** Treasury the witness must pay (else we'd serve without being paid). */
  payTo: string;
}

export interface SettleResult {
  txHash: string;
}

/** A settle function the server can call (real impl, or a stub in tests). */
export type Settler = (payload: CanonicalPaymentPayload) => Promise<SettleResult>;

/**
 * Build a real on-chain settler. Returns a `Settler` closure plus the settler
 * address (so callers can log/fund it). Throws if the key is malformed.
 */
export function createSettler(
  config: SettlerConfig,
  expect: SettleExpectations,
): { settle: Settler; address: Address } {
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: bsc, transport });
  const walletClient = createWalletClient({ account, chain: bsc, transport });

  const settle: Settler = async (payment) => {
    const { permit2Authorization: auth } = payment.payload;

    // Cheap field checks before spending gas — reject anything that wouldn't
    // actually pay our treasury, in our asset, on our chain, for the price.
    if (payment.network !== expect.network) {
      throw new Error(`settle: wrong network ${payment.network} (want ${expect.network})`);
    }
    if (getAddress(auth.permitted.token) !== getAddress(expect.asset)) {
      throw new Error('settle: wrong asset');
    }
    if (BigInt(auth.permitted.amount) < BigInt(expect.priceAtomic)) {
      throw new Error('settle: underpaid');
    }
    if (getAddress(auth.witness.to) !== getAddress(expect.payTo)) {
      throw new Error('settle: witness.to is not our treasury');
    }

    const args = [
      {
        permitted: {
          token: getAddress(auth.permitted.token),
          amount: BigInt(auth.permitted.amount),
        },
        nonce: BigInt(auth.nonce),
        deadline: BigInt(auth.deadline),
      },
      getAddress(auth.from),
      { to: getAddress(auth.witness.to), validAfter: BigInt(auth.witness.validAfter) },
      payment.payload.signature as Hex,
    ] as const;

    // Verify: dry-run reverts on bad sig / expiry / balance / allowance.
    const { request } = await publicClient.simulateContract({
      account,
      address: X402_EXACT_PERMIT2_PROXY,
      abi: PROXY_ABI,
      functionName: 'settle',
      args,
    });
    // Settle: broadcast and confirm before the caller serves the resource.
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') {
      throw new Error(`settle: tx reverted ${hash}`);
    }
    return { txHash: hash };
  };

  return { settle, address: account.address };
}
