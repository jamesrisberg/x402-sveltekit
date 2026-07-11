import { paymentHandle, x402ResourceServer } from "@jamesrisberg/x402-sveltekit";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createPaywall, evmPaywall } from "@x402/paywall";
import { env } from "$env/dynamic/private";

const evmAddress = env.EVM_ADDRESS as `0x${string}`;
const facilitatorUrl = env.FACILITATOR_URL;
if (!evmAddress || !facilitatorUrl) {
  throw new Error("Missing required environment variables: EVM_ADDRESS, FACILITATOR_URL");
}

export const handle = paymentHandle(
  {
    "GET /api/weather": {
      accepts: {
        scheme: "exact",
        price: "$0.001",
        network: "eip155:84532",
        payTo: evmAddress,
      },
      description: "Weather data",
      mimeType: "application/json",
    },
  },
  new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(
    "eip155:84532",
    new ExactEvmScheme(),
  ),
  { appName: "x402 SvelteKit Example" },
  createPaywall().withNetwork(evmPaywall).build(),
);
