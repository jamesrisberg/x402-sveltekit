# x402 SvelteKit Example Server

SvelteKit app demonstrating how to protect routes with a paywall using the `@jamesrisberg/x402-sveltekit` handle hook.

```typescript
// src/hooks.server.ts
import { paymentHandle, x402ResourceServer } from "@jamesrisberg/x402-sveltekit";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export const handle = paymentHandle(
  {
    "GET /api/weather": {
      accepts: { scheme: "exact", price: "$0.001", network: "eip155:84532", payTo: evmAddress },
      description: "Weather data",
      mimeType: "application/json",
    },
  },
  new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(
    "eip155:84532",
    new ExactEvmScheme(),
  ),
);
```

```typescript
// src/routes/api/weather/+server.ts — a plain handler; payment is enforced by the hook
import { json } from "@sveltejs/kit";

export const GET = () => json({ report: { weather: "sunny", temperature: 70 } });
```

## Prerequisites

- Node.js v20+
- A valid EVM address for receiving payments
- URL of a facilitator supporting the desired payment network, see [facilitator list](https://www.x402.org/ecosystem?category=facilitators) (the default `.env-local` uses the x402.org testnet facilitator)

## Setup

1. Build the package from the repository root:

```bash
cd ../..
npm install && npm run build
cd examples/sveltekit
```

2. Copy `.env-local` to `.env` and fill in the required environment variables:

```bash
cp .env-local .env
```

- `EVM_ADDRESS` - Ethereum address to receive payments
- `FACILITATOR_URL` - Facilitator endpoint URL

3. Install and run the server:

```bash
npm install
npm run dev
```

## Testing the Server

Request the protected route without payment to get the payment requirements:

```bash
curl -i http://localhost:5173/api/weather
```

Request it with browser `Accept` and `User-Agent` headers (both are required for browser detection) to get the wallet paywall page:

```bash
curl -i -H "Accept: text/html" -H "User-Agent: Mozilla/5.0" http://localhost:5173/api/weather
```

To complete a payment end-to-end, use an x402 client such as [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) with a wallet funded with Base Sepolia USDC.

## Response Format

### Payment Required (402)

```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: <base64-encoded JSON>
```

The `PAYMENT-REQUIRED` header contains base64-encoded JSON with the payment requirements. Note: `amount` is in atomic units (e.g., 1000 = 0.001 USDC, since USDC has 6 decimals).

### Successful Response

```
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: <base64-encoded JSON>

{"report":{"weather":"sunny","temperature":70}}
```

The `PAYMENT-RESPONSE` header contains base64-encoded JSON with the settlement details, including the on-chain transaction hash.

## Notes

- Route patterns (`"GET /api/weather"`, `"GET /api/*"`) match URL paths, not SvelteKit route ids like `/api/[slug]`.
- The paywall provider is passed explicitly because `@x402/core` loads `@x402/paywall` with a dynamic `require`, which Vite's SSR bundle does not support — see the package README.
- **Network identifiers** use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format, e.g. `eip155:84532` (Base Sepolia), `eip155:8453` (Base Mainnet).
