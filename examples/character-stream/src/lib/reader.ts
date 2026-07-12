import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { UptoEvmScheme } from "@x402/evm/upto/client";
import {
  BatchSettlementEvmScheme,
  type BatchSettlementClientContext,
  type ClientChannelStorage,
} from "@x402/evm/batch-settlement/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const KEY_STORAGE = "x402-character-stream-burner-key";
const CHANNEL_STORAGE_PREFIX = "x402-character-stream-channel:";

/**
 * Loads the burner account from localStorage, generating and persisting one on first use.
 *
 * @returns The burner account
 */
export function loadBurnerAccount(): PrivateKeyAccount {
  let key = localStorage.getItem(KEY_STORAGE) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, key);
  }
  return privateKeyToAccount(key);
}

/**
 * localStorage-backed channel storage so a batch-settlement payment channel
 * survives page refreshes.
 */
class LocalStorageChannelStorage implements ClientChannelStorage {
  /**
   * Returns the channel record for `key` if present.
   *
   * @param key - Channel storage key (channelId)
   * @returns Persisted context or undefined
   */
  async get(key: string): Promise<BatchSettlementClientContext | undefined> {
    const raw = localStorage.getItem(CHANNEL_STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  }

  /**
   * Stores or replaces the channel record for `key`.
   *
   * @param key - Channel storage key
   * @param context - Channel fields to persist
   */
  async set(key: string, context: BatchSettlementClientContext): Promise<void> {
    localStorage.setItem(CHANNEL_STORAGE_PREFIX + key, JSON.stringify(context));
  }

  /**
   * Removes the channel record for `key` if it exists.
   *
   * @param key - Channel storage key
   */
  async delete(key: string): Promise<void> {
    localStorage.removeItem(CHANNEL_STORAGE_PREFIX + key);
  }
}

export type PayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const CHAINS: Record<string, Chain> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
};

/**
 * Resolves a CAIP-2 network identifier to a viem chain.
 *
 * @param network - CAIP-2 network id (e.g. "eip155:8453")
 * @returns The matching viem chain
 */
export function chainForNetwork(network: string): Chain {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`Unsupported network: ${network}`);
  return chain;
}

/**
 * Creates one payment-enabled fetch per scheme, all signing with the same account.
 * Separate clients keep the scheme choice explicit per interaction: exact for
 * single letters (one on-chain tx each), batch-settlement for streaming, and
 * upto for buy-the-rest.
 *
 * @param account - The signing account used to authorize payments
 * @param chain - The chain payments settle on (from the server's 402)
 * @returns Scheme-specific fetch functions and the shared public client
 */
export function createPayFetchers(account: PrivateKeyAccount, chain: Chain) {
  const publicClient = createPublicClient({ chain, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const boundFetch = globalThis.fetch.bind(globalThis);

  const exactClient = new x402Client();
  registerExactEvmScheme(exactClient, { signer: account });

  const uptoClient = new x402Client();
  uptoClient.register("eip155:*", new UptoEvmScheme(signer));

  const batchClient = new x402Client();
  batchClient.register(
    "eip155:*",
    new BatchSettlementEvmScheme(signer, {
      depositPolicy: { depositMultiplier: 500 },
      storage: new LocalStorageChannelStorage(),
    }),
  );

  return {
    exactFetch: wrapFetchWithPayment(boundFetch, exactClient) as PayFetch,
    uptoFetch: wrapFetchWithPayment(boundFetch, uptoClient) as PayFetch,
    batchFetch: wrapFetchWithPayment(boundFetch, batchClient) as PayFetch,
    publicClient,
  };
}
