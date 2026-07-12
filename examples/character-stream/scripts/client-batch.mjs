// batch-settlement client: opens a payment channel, then buys N characters as
// off-chain vouchers; the server claims and settles them in batches.
// Usage: node scripts/client-batch.mjs [start] [count]
import fs from "node:fs";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/client";
import { FileClientChannelStorage } from "@x402/evm/batch-settlement/client/file-storage";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const key = fs.readFileSync(new URL("./burner.key", import.meta.url), "utf8").trim();
const account = privateKeyToAccount(key);
console.log("burner address:", account.address);

const base = process.env.BASE_URL ?? "http://localhost:5174";
const start = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 20);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const signer = toClientEvmSigner(account, publicClient);

const batchedScheme = new BatchSettlementEvmScheme(signer, {
  depositPolicy: { depositMultiplier: 50 },
  storage: new FileClientChannelStorage({
    directory: new URL("./.client-channels", import.meta.url).pathname,
  }),
});

const client = new x402Client();
client.register("eip155:*", batchedScheme);
const payFetch = wrapFetchWithPayment(fetch, client);

let out = "";
for (let i = start; i < start + count; i++) {
  const t0 = Date.now();
  const res = await payFetch(`${base}/api/poem/char/${i}`);
  if (!res.ok) {
    console.error(`char ${i}: HTTP ${res.status}`, (await res.text()).slice(0, 200));
    process.exit(1);
  }
  const body = await res.json();
  out += body.char;
  console.log(`#${i} ${JSON.stringify(body.char)} ${Date.now() - t0}ms`);
}
console.log("bought:", JSON.stringify(out));
console.log("(vouchers accumulate in the channel; the server claims/settles on its interval)");
