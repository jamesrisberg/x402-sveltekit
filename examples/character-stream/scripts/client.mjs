// Headless x402 character-stream client: buys the first N characters and prints receipts.
// Usage: node scripts/client.mjs [count]   (BASE_URL and BURNER_KEY env vars optional)
import fs from "node:fs";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const KEY_FILE = new URL("./burner.key", import.meta.url);
let key =
  process.env.BURNER_KEY ??
  (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8").trim() : null);
if (!key) {
  key = generatePrivateKey();
  fs.writeFileSync(KEY_FILE, key);
}
const account = privateKeyToAccount(key);
console.log("burner address:", account.address);

const base = process.env.BASE_URL ?? "http://localhost:5174";
const count = Number(process.argv[2] ?? 10);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payFetch = wrapFetchWithPayment(fetch, client);

const meta = await (await fetch(`${base}/api/poem`)).json();
console.log(`${meta.title} — ${meta.author}: ${meta.length} chars at ${meta.pricePerCharacter}`);

let out = "";
for (let i = 0; i < count; i++) {
  const t0 = Date.now();
  const res = await payFetch(`${base}/api/poem/char/${i}`);
  if (!res.ok) {
    console.error(`char ${i}: HTTP ${res.status}`, (await res.text()).slice(0, 200));
    process.exit(1);
  }
  const body = await res.json();
  out += body.char;
  const receipt = decodePaymentResponseHeader(res.headers.get("payment-response"));
  console.log(`#${i} ${JSON.stringify(body.char)} ${Date.now() - t0}ms tx=${receipt.transaction}`);
}
console.log("bought:", JSON.stringify(out));
