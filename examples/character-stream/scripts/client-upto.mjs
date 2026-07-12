// upto-scheme client: authorizes the whole-poem max, gets billed for actual characters.
// Usage: node scripts/client-upto.mjs [from] [count]
import fs from "node:fs";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { UptoEvmScheme } from "@x402/evm/upto/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const key = fs.readFileSync(new URL("./burner.key", import.meta.url), "utf8").trim();
const account = privateKeyToAccount(key);
console.log("burner address:", account.address);

const base = process.env.BASE_URL ?? "http://localhost:5174";
const from = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 50);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const signer = toClientEvmSigner(account, publicClient);

const client = new x402Client();
client.register("eip155:*", new UptoEvmScheme(signer));
const payFetch = wrapFetchWithPayment(fetch, client);

const t0 = Date.now();
const res = await payFetch(`${base}/api/poem/passage?from=${from}&count=${count}`);
if (!res.ok) {
  console.error(`HTTP ${res.status}`, (await res.text()).slice(0, 300));
  process.exit(1);
}
const body = await res.json();
const receipt = decodePaymentResponseHeader(res.headers.get("payment-response"));
console.log(`passage [${body.from}, ${body.from + body.count}) in ${Date.now() - t0}ms`);
console.log(`settled amount: ${receipt.amount ?? "(not reported)"} atomic units`);
console.log(`tx: ${receipt.transaction}`);
console.log(JSON.stringify(body.text));
