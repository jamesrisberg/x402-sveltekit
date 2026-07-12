# Ozymandias, by the character

A proof-of-concept SvelteKit app that streams a poem one character at a time, with every single character behind its own x402 micropayment. Stop paying and the poem stops mid-word.

The text is Shelley's _Ozymandias_ (1818 first printing, public domain) — a fittingly monumental subject, rendered in per-fragment micropayments in the spirit of Ted Nelson's Xanadu.

## How it works

- `GET /api/poem` is free and returns metadata (title, length, price per character).
- `GET /api/poem/char/[i]` returns character `i` and is protected by the `@jamesrisberg/x402-sveltekit` handle at $0.0001 USDC per request on Base Sepolia (`"GET /api/poem/char/*"` route pattern).
- The reader page generates a burner wallet in the browser (persisted in localStorage), wraps `fetch` with [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch), and buys characters in a small concurrent pipeline. Each response's `PAYMENT-RESPONSE` header carries the on-chain settlement receipt, shown as BaseScan links.
- Nothing on-chain is hardcoded: the client learns the USDC asset address and atomic price from the `PAYMENT-REQUIRED` header of an unpaid probe request.

## Three payment schemes, one poem

| Route | Scheme(s) | Model | Measured latency |
| --- | --- | --- | --- |
| `GET /api/poem/char/[i]` | `exact` | one payment, one on-chain settlement per character | ~1–8s/char |
| `GET /api/poem/char/[i]` | `batch-settlement` | payment channel: on-chain deposit once, then off-chain vouchers per character, claimed/settled in batches | ~5s once, then ~10–20ms/char |
| `GET /api/poem/passage?from=&count=` | `upto` | authorize the whole-poem max once (Permit2), settle only for characters delivered via `setSettlementOverrides` | one request, ~3s |

Headless clients for each: `scripts/client.mjs` (exact), `scripts/client-batch.mjs` (batch-settlement), `scripts/client-upto.mjs` (upto). All use the same burner key in `scripts/burner.key`.

Notes:

- The char route advertises `exact` and `batch-settlement` together in one 402; the client picks whichever scheme it has registered.
- `upto` needs no gas on the payer side either: the route declares the `eip2612GasSponsoring` extension, so the facilitator sponsors the payer's one-time Permit2 approval.
- batch-settlement requires `EVM_RECEIVER_AUTHORIZER_PRIVATE_KEY` (any fresh key) because the x402.org facilitator does not provide a receiver authorizer; the server's channel manager signs claims with it and runs claim/settle/refund on intervals (see `hooks.server.ts`).

## Setup

1. Build the package from the repository root:

```bash
cd ../..
npm install && npm run build
cd examples/character-stream
```

2. Copy `.env-local` to `.env`, set `EVM_ADDRESS` to the address that should receive the payments, and set `EVM_RECEIVER_AUTHORIZER_PRIVATE_KEY` to a fresh private key (enables batch-settlement; leave empty to serve `exact`/`upto` only).

3. Install and run:

```bash
npm install
npm run dev
```

4. Open the page, copy the burner wallet address, and fund it with Base Sepolia USDC from the [Circle faucet](https://faucet.circle.com) (no gas ETH needed — the facilitator relays settlement).

5. Press **Start paying**.

## Notes

- Full poem is ~630 characters ≈ $0.07 of testnet USDC.
- Throughput is bounded by facilitator verify+settle latency; the pipeline keeps a few requests in flight so the text arrives at typewriter speed.
- If the x402.org testnet facilitator rate-limits, lower `CONCURRENCY` in `src/routes/+page.svelte`.
