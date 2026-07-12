import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  erc20Abi,
  parseSignature,
  type Chain,
  type EIP1193Provider,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

const transferWithAuthorizationAbi = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/**
 * Returns the injected EIP-1193 provider (e.g. MetaMask), if any.
 *
 * @returns The provider or undefined
 */
export function injectedProvider(): EIP1193Provider | undefined {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum;
}

/**
 * Connects the injected wallet and ensures it is on the given chain.
 *
 * @param chain - Target chain
 * @returns Wallet client and the connected address
 */
async function connectInjected(chain: Chain) {
  const provider = injectedProvider();
  if (!provider) throw new Error("No browser wallet found — install MetaMask or similar");
  const walletClient = createWalletClient({ chain, transport: custom(provider) });
  const [address] = await walletClient.requestAddresses();
  try {
    await walletClient.switchChain({ id: chain.id });
  } catch {
    await walletClient.addChain({ chain });
    await walletClient.switchChain({ id: chain.id });
  }
  return { walletClient, address };
}

/**
 * Funds the burner from the connected wallet with a USDC transfer.
 *
 * @param chain - Chain to transact on
 * @param usdc - USDC token address (from the 402 payment requirements)
 * @param burner - Burner address to fund
 * @param amountAtomic - Amount in atomic token units
 * @returns The transaction hash
 */
export async function fundBurner(
  chain: Chain,
  usdc: `0x${string}`,
  burner: `0x${string}`,
  amountAtomic: bigint,
): Promise<`0x${string}`> {
  const { walletClient, address } = await connectInjected(chain);
  return walletClient.writeContract({
    account: address,
    address: usdc,
    abi: erc20Abi,
    functionName: "transfer",
    args: [burner, amountAtomic],
  });
}

/**
 * Sweeps the burner's full USDC balance back to the connected wallet.
 * The burner signs an EIP-3009 transferWithAuthorization; the connected wallet
 * submits it and pays the gas, so the burner never needs ETH.
 *
 * @param chain - Chain to transact on
 * @param usdc - USDC token address
 * @param tokenName - EIP-712 domain name from the 402 requirements extra (e.g. "USDC")
 * @param tokenVersion - EIP-712 domain version from the 402 requirements extra (e.g. "2")
 * @param burner - The burner account (signer)
 * @returns The transaction hash, or undefined when the balance is zero
 */
export async function sweepBurner(
  chain: Chain,
  usdc: `0x${string}`,
  tokenName: string,
  tokenVersion: string,
  burner: PrivateKeyAccount,
): Promise<`0x${string}` | undefined> {
  const publicClient = createPublicClient({ chain, transport: http() });
  const balance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [burner.address],
  });
  if (balance === 0n) return undefined;

  const { walletClient, address } = await connectInjected(chain);
  const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await burner.signTypedData({
    domain: { name: tokenName, version: tokenVersion, chainId: chain.id, verifyingContract: usdc },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: burner.address,
      to: address,
      value: balance,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  const { v, r, s } = parseSignature(signature);

  return walletClient.writeContract({
    account: address,
    address: usdc,
    abi: transferWithAuthorizationAbi,
    functionName: "transferWithAuthorization",
    args: [burner.address, address, balance, 0n, validBefore, nonce, Number(v), r, s],
  });
}
