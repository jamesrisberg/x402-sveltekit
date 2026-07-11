# `@jamesrisberg/x402-sveltekit`

SvelteKit integration for the [x402 Payment Protocol](https://x402.org). This package provides a [handle hook](https://svelte.dev/docs/kit/hooks#Server-hooks-handle) for adding x402 payment requirements to your SvelteKit applications, ported from the official [`@x402/hono`](https://www.npmjs.com/package/@x402/hono) middleware.

Agents and scripts that hit a protected route get a `402` with machine-readable payment requirements; browsers get a wallet paywall page. Valid payments are verified with a facilitator, settled on-chain, and receipted via the `PAYMENT-RESPONSE` header.

## Installation

```bash
npm install @jamesrisberg/x402-sveltekit @x402/core @x402/evm
```

## Quick Start

```typescript
// src/hooks.server.ts
import { paymentHandle, x402ResourceServer } from "@jamesrisberg/x402-sveltekit";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:84532",
  new ExactEvmScheme(),
);

export const handle = paymentHandle(
  {
    "GET /api/premium": {
      accepts: {
        scheme: "exact",
        price: "$0.10",
        network: "eip155:84532",
        payTo: "0xYourAddress",
      },
      description: "Access to premium content",
    },
  },
  resourceServer,
);
```

```typescript
// src/routes/api/premium/+server.ts — a plain handler; payment is enforced by the hook
import { json } from "@sveltejs/kit";

export const GET = () => json({ message: "This content is behind a paywall" });
```

To compose with other hooks, use [`sequence`](https://svelte.dev/docs/kit/@sveltejs-kit-hooks):

```typescript
import { sequence } from "@sveltejs/kit/hooks";

export const handle = sequence(paymentHandle(routes, resourceServer), myOtherHandle);
```

## Configuration

```typescript
paymentHandle(
  routes: RoutesConfig,
  server: x402ResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart?: boolean
)
```

1. **`routes`** (required): Route configurations for protected endpoints, keyed as `"METHOD /path"` (path patterns like `/api/*` are supported)
2. **`server`** (required): Pre-configured `x402ResourceServer` instance
3. **`paywallConfig`** (optional): Configuration for the built-in paywall UI
4. **`paywall`** (optional): Custom paywall provider (overrides default)
5. **`syncFacilitatorOnStart`** (optional): Whether to sync with the facilitator on startup (defaults to `true`)

Variants: `paymentHandleFromHTTPServer(httpServer, ...)` for a pre-built `x402HTTPResourceServer` with HTTP-level hooks, and `paymentHandleFromConfig(routes, facilitatorClients, schemes, ...)` to construct the resource server inline.

### Browser paywall under Vite

`@x402/core` loads `@x402/paywall` with a dynamic `require`, which Vite's SSR bundle does not support — browsers would silently get a minimal fallback page. Pass the provider explicitly:

```bash
npm install @x402/paywall
```

```typescript
import { createPaywall, evmPaywall } from "@x402/paywall";

export const handle = paymentHandle(
  routes,
  resourceServer,
  { appName: "My App" },
  createPaywall().withNetwork(evmPaywall).build(),
);
```

### Mainnet

Point the facilitator client at a production facilitator (e.g. Coinbase CDP, requires [API keys](https://portal.cdp.coinbase.com)) and use mainnet network identifiers:

```typescript
import { createFacilitatorConfig } from "@coinbase/x402";

const facilitatorClient = new HTTPFacilitatorClient(
  createFacilitatorConfig(CDP_API_KEY_ID, CDP_API_KEY_SECRET),
);
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:8453", // Base mainnet
  new ExactEvmScheme(),
);
```

### Partial settlement

```typescript
import { setSettlementOverrides } from "@jamesrisberg/x402-sveltekit";

export const GET = () => {
  const response = json({ partial: true });
  setSettlementOverrides(response, { amount: "500" });
  return response;
};
```

## Notes

- Runs on Node-based SvelteKit adapters (`adapter-node`, `adapter-vercel`, `adapter-auto` on Node runtimes). Edge runtimes without `Buffer` are untested.
- Payment is enforced in the handle hook, so protected routes stay plain SvelteKit handlers — no wrapping required.
- Seen in the wild: [jamesrisberg.xyz/tollbooth](https://www.jamesrisberg.xyz/tollbooth)

## Related

- [x402 protocol](https://github.com/x402-foundation/x402) — specification and official SDKs; this package follows the structure of the official HTTP integrations with the intent to upstream (see [docs/UPSTREAMING.md](docs/UPSTREAMING.md))

## License

Apache-2.0
