import { paymentHandle, x402ResourceServer } from "@jamesrisberg/x402-sveltekit";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/server";
import { FileChannelStorage } from "@x402/evm/batch-settlement/server/file-storage";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { createPaywall, evmPaywall } from "@x402/paywall";
import { env } from "$env/dynamic/private";
import { privateKeyToAccount } from "viem/accounts";
import { PRICE_PER_CHARACTER, POEM_MAX_PRICE, POEM_TITLE } from "$lib/server/poem";

const NETWORK = (env.NETWORK || "eip155:84532") as `eip155:${string}`;

const evmAddress = env.EVM_ADDRESS as `0x${string}`;
if (!evmAddress) {
  throw new Error("Missing required environment variable: EVM_ADDRESS");
}

// CDP facilitator (mainnet) when API keys are present, else a plain facilitator URL
const facilitatorClient =
  env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET
    ? new HTTPFacilitatorClient(createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET))
    : new HTTPFacilitatorClient({ url: env.FACILITATOR_URL || "https://x402.org/facilitator" });

// batch-settlement requires a receiver authorizer key when the facilitator does
// not advertise one (x402.org's does not); without it the route offers exact only.
const authorizerKey = env.EVM_RECEIVER_AUTHORIZER_PRIVATE_KEY as `0x${string}` | undefined;
const batchedScheme = authorizerKey
  ? new BatchSettlementEvmScheme(evmAddress, {
      receiverAuthorizerSigner: privateKeyToAccount(authorizerKey),
      storage: new FileChannelStorage({ directory: env.STORAGE_DIR || ".channels" }),
    })
  : null;

// Claim vouchers and settle channel funds in the background. Under Vite HMR this
// module reloads with fresh scheme instances; replace the running manager so it
// never claims through a stale scheme (e.g. one created before env vars changed).
const g = globalThis as { __x402ChannelManager?: { stop: (o?: object) => Promise<void> } };
if (batchedScheme) {
  void g.__x402ChannelManager?.stop();
  const channelManager = batchedScheme.createChannelManager(facilitatorClient, NETWORK);
  g.__x402ChannelManager = channelManager;
  channelManager.start({
    claimIntervalSecs: 60,
    settleIntervalSecs: 120,
    refundIntervalSecs: 180,
    onClaim: r => console.log(`[batch] claimed ${r.vouchers} vouchers (tx: ${r.transaction})`),
    onSettle: r => console.log(`[batch] settled to ${evmAddress} (tx: ${r.transaction})`),
    onRefund: r => console.log(`[batch] refunded channel ${r.channel} (tx: ${r.transaction})`),
    onError: e => console.error("[batch] settlement error:", e),
  });
}

export const handle = paymentHandle(
  {
    "GET /api/poem/char/*": {
      accepts: [
        {
          scheme: "exact",
          price: PRICE_PER_CHARACTER,
          network: NETWORK,
          payTo: evmAddress,
        },
        ...(batchedScheme
          ? [
              {
                scheme: "batch-settlement",
                price: PRICE_PER_CHARACTER,
                network: NETWORK,
                payTo: evmAddress,
              },
            ]
          : []),
      ],
      description: `One character of ${POEM_TITLE}`,
      mimeType: "application/json",
    },
    "GET /api/poem/passage": {
      accepts: {
        scheme: "upto",
        price: POEM_MAX_PRICE,
        network: NETWORK,
        payTo: evmAddress,
      },
      description: `A passage of ${POEM_TITLE}, billed per character actually delivered`,
      mimeType: "application/json",
      // Lets the facilitator sponsor the payer's one-time Permit2 approval, so
      // upto works from a wallet holding only USDC (no gas).
      extensions: {
        ...declareEip2612GasSponsoringExtension(),
      },
    },
  },
  new x402ResourceServer(facilitatorClient)
    .register(NETWORK, new ExactEvmScheme())
    .register(NETWORK, new UptoEvmScheme())
    .register(NETWORK, batchedScheme),
  { appName: `${POEM_TITLE}, by the character` },
  createPaywall().withNetwork(evmPaywall).build(),
);
