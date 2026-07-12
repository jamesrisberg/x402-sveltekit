<script lang="ts">
  import { onMount } from "svelte";
  import { erc20Abi, formatUnits, parseUnits, type Chain } from "viem";
  import type { PrivateKeyAccount } from "viem/accounts";
  import { decodePaymentResponseHeader, decodePaymentRequiredHeader } from "@x402/core/http";
  import type { PaymentRequirements } from "@x402/core/types";
  import { loadBurnerAccount, createPayFetchers, chainForNetwork, type PayFetch } from "$lib/reader";
  import { fundBurner, sweepBurner } from "$lib/wallet";

  const REVEAL_STORAGE = "x402-character-stream-reveals";
  const STREAM_DELAY_MS = 25;

  type Meta = {
    title: string;
    author: string;
    length: number;
    pricePerCharacter: string;
    lines: number[];
  };

  let address = $state<string | null>(null);
  let meta = $state<Meta | null>(null);
  let requirement = $state<PaymentRequirements | null>(null);
  let chain = $state<Chain | null>(null);
  let walletBusy = $state<string | null>(null);
  let balance = $state<bigint | null>(null);
  let decimals = $state(6);
  let revealed = $state<Record<number, string>>({});
  let pending = $state<Record<number, true>>({});
  let streaming = $state(false);
  let buyingRest = $state(false);
  let spentAtomic = $state(0n);
  let receipts = $state<{ label: string; tx: string }[]>([]);
  let errorMsg = $state<string | null>(null);

  let fetchers: ReturnType<typeof createPayFetchers>;
  let account: PrivateKeyAccount;

  // Global char index of the first character of each line (lines are separated by "\n")
  const lineStarts = $derived.by(() => {
    const starts: number[] = [];
    let i = 0;
    for (const len of meta?.lines ?? []) {
      starts.push(i);
      i += len + 1;
    }
    return starts;
  });
  const paidTotal = $derived(meta ? meta.length - (meta.lines.length - 1) : 0);
  const ownedCount = $derived(Object.keys(revealed).length);
  const done = $derived(meta !== null && ownedCount >= paidTotal);
  const ready = $derived(address !== null && meta !== null && requirement !== null);

  onMount(async () => {
    account = loadBurnerAccount();
    address = account.address;

    meta = await (await fetch("/api/poem")).json();
    revealed = JSON.parse(localStorage.getItem(REVEAL_STORAGE) ?? "{}");

    // The 402 tells us the network, asset, and price — nothing is hardcoded.
    const probe = await fetch("/api/poem/char/0");
    if (probe.status === 402) {
      const header = probe.headers.get("payment-required");
      if (header) requirement = decodePaymentRequiredHeader(header).accepts[0];
    }
    if (!requirement) {
      errorMsg = "Could not load payment requirements";
      return;
    }
    chain = chainForNetwork(requirement.network);
    fetchers = createPayFetchers(account, chain);
    await refreshBalance();
  });

  const explorerBase = $derived(chain?.blockExplorers?.default?.url ?? null);
  const isTestnet = $derived(chain?.testnet === true);

  async function fund(dollars: number) {
    if (!requirement || !address || !chain) return;
    walletBusy = "funding";
    errorMsg = null;
    try {
      await fundBurner(
        chain,
        requirement.asset as `0x${string}`,
        address as `0x${string}`,
        parseUnits(String(dollars), decimals),
      );
      await new Promise(r => setTimeout(r, 4000));
      await refreshBalance();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    } finally {
      walletBusy = null;
    }
  }

  async function sweep() {
    if (!requirement || !chain) return;
    walletBusy = "sweeping";
    errorMsg = null;
    try {
      const extra = (requirement.extra ?? {}) as { name?: string; version?: string };
      await sweepBurner(
        chain,
        requirement.asset as `0x${string}`,
        extra.name ?? "USDC",
        extra.version ?? "2",
        account,
      );
      await new Promise(r => setTimeout(r, 4000));
      await refreshBalance();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    } finally {
      walletBusy = null;
    }
  }

  async function refreshBalance() {
    if (!requirement || !address) return;
    try {
      [balance, decimals] = await Promise.all([
        fetchers.publicClient.readContract({
          address: requirement.asset as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }),
        fetchers.publicClient.readContract({
          address: requirement.asset as `0x${string}`,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
    } catch {
      // balance display is best-effort
    }
  }

  function persistReveals() {
    localStorage.setItem(REVEAL_STORAGE, JSON.stringify(revealed));
  }

  function recordReceipt(label: string, header: string | null) {
    spentAtomic += BigInt(requirement?.amount ?? 0);
    if (!header) return;
    const receipt = decodePaymentResponseHeader(header);
    if (receipt.transaction) {
      receipts = [{ label, tx: receipt.transaction }, ...receipts].slice(0, 8);
    }
  }

  async function buyChar(i: number, payFetch: PayFetch, label: string) {
    const res = await payFetch(`/api/poem/char/${i}`);
    if (!res.ok) throw new Error(`character ${i}: HTTP ${res.status}`);
    const body = await res.json();
    revealed[i] = body.char;
    recordReceipt(label, res.headers.get("payment-response"));
    persistReveals();
  }

  async function buyOne(i: number) {
    if (revealed[i] !== undefined || pending[i] || !ready) return;
    pending[i] = true;
    errorMsg = null;
    try {
      await buyChar(i, fetchers.exactFetch, `letter ${i}`);
      await refreshBalance();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    } finally {
      delete pending[i];
    }
  }

  async function stream() {
    if (streaming || !ready || !meta) return;
    streaming = true;
    errorMsg = null;
    for (let i = 0; i < meta.length && streaming; i++) {
      if (revealed[i] !== undefined || pending[i]) continue;
      pending[i] = true;
      try {
        await buyChar(i, fetchers.batchFetch, `letter ${i}`);
      } catch {
        // one retry after a beat — facilitators throw transient errors under load
        try {
          await new Promise(r => setTimeout(r, 1500));
          await buyChar(i, fetchers.batchFetch, `letter ${i}`);
        } catch (e) {
          errorMsg = e instanceof Error ? e.message : String(e);
          streaming = false;
        }
      } finally {
        delete pending[i];
      }
      await new Promise(r => setTimeout(r, STREAM_DELAY_MS));
    }
    streaming = false;
    await refreshBalance();
  }

  async function buyRest() {
    if (buyingRest || !ready || !meta) return;
    buyingRest = true;
    errorMsg = null;
    try {
      const res = await fetchers.uptoFetch(`/api/poem/passage?from=0&count=${meta.length}`);
      if (!res.ok) throw new Error(`passage: HTTP ${res.status}`);
      const body = await res.json();
      for (let i = 0; i < body.text.length; i++) {
        if (body.text[i] !== "\n") revealed[i] = body.text[i];
      }
      persistReveals();
      const header = res.headers.get("payment-response");
      if (header) {
        const receipt = decodePaymentResponseHeader(header);
        spentAtomic += BigInt(receipt.amount ?? requirement?.amount ?? 0);
        if (receipt.transaction) {
          receipts = [{ label: "the rest (upto)", tx: receipt.transaction }, ...receipts].slice(
            0,
            8,
          );
        }
      }
      await refreshBalance();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    } finally {
      buyingRest = false;
    }
  }
</script>

<svelte:head>
  <title>{meta?.title ?? "…"} — by the character</title>
</svelte:head>

<main>
  <header>
    <h1>{meta?.title ?? "…"}</h1>
    <p class="author">{meta?.author ?? ""}</p>
    <p class="conceit">
      This poem is redacted. Each character is {meta?.pricePerCharacter ?? "…"} USDC via
      <a href="https://x402.org" target="_blank" rel="noreferrer">x402</a> on Base Sepolia. Click a
      mark to buy one letter (one on-chain settlement), stream it through a payment channel, or buy
      the rest with a single metered authorization.
    </p>
  </header>

  <section class="toolbar">
    <span class="chip" title={address ?? ""}>
      ☗ {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "…"}
    </span>
    <span class="chip">
      {balance === null ? "…" : formatUnits(balance, decimals)} USDC
      {#if isTestnet}
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet</a>
      {/if}
    </span>
    <button onclick={() => fund(1)} disabled={!ready || walletBusy !== null}>
      {walletBusy === "funding" ? "Funding…" : "Fund $1 from wallet"}
    </button>
    <button onclick={sweep} disabled={!ready || walletBusy !== null || !balance}>
      {walletBusy === "sweeping" ? "Sweeping…" : "Sweep back"}
    </button>
    <span class="chip">{ownedCount} / {paidTotal} revealed</span>
    <span class="chip">spent {formatUnits(spentAtomic, decimals)}</span>
    {#if streaming}
      <button onclick={() => (streaming = false)}>Stop paying</button>
    {:else}
      <button onclick={stream} disabled={!ready || done}>Stream the poem</button>
    {/if}
    <button onclick={buyRest} disabled={!ready || done || buyingRest}>
      {buyingRest ? "Settling…" : "Buy the rest"}
    </button>
  </section>

  {#if errorMsg}
    <p class="error">{errorMsg}</p>
  {/if}

  <article class="poem">
    {#each meta?.lines ?? [] as lineLength, li (li)}
      <div class="line">
        {#each { length: lineLength } as _, ci (ci)}
          {@const i = lineStarts[li] + ci}
          {#if revealed[i] !== undefined}
            <span class="cell">{revealed[i]}</span>
          {:else}
            <button
              class="mark"
              class:pending={pending[i]}
              onclick={() => buyOne(i)}
              title="Reveal this character — {meta?.pricePerCharacter} (exact, one tx)"
              aria-label="Buy character {i}"
            ></button>
          {/if}
        {/each}
        {#if lineLength === 0}<br />{/if}
      </div>
    {/each}
  </article>

  {#if receipts.length > 0}
    <footer class="receipts">
      <h2>Settlements</h2>
      <ul>
        {#each receipts as r (r.tx)}
          <li>
            {r.label} —
            {#if explorerBase}
              <a href="{explorerBase}/tx/{r.tx}" target="_blank" rel="noreferrer">
                {r.tx.slice(0, 14)}…
              </a>
            {:else}
              <code>{r.tx.slice(0, 14)}…</code>
            {/if}
          </li>
        {/each}
      </ul>
    </footer>
  {/if}
</main>

<style>
  main {
    max-width: 44rem;
    margin: 3rem auto 4rem;
    padding: 0 1.25rem;
    font-family: Georgia, "Times New Roman", serif;
    color: #1c1a17;
    background: #faf7f2;
  }
  :global(body) {
    background: #faf7f2;
  }
  header {
    text-align: center;
    margin-bottom: 2rem;
  }
  h1 {
    font-style: italic;
    font-weight: 500;
    font-size: 2.4rem;
    margin: 0;
  }
  .author {
    margin: 0.4rem 0 1.2rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-size: 0.8rem;
    color: #6b6257;
  }
  .conceit {
    font-size: 0.9rem;
    color: #6b6257;
    max-width: 34rem;
    margin: 0 auto;
    line-height: 1.5;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: center;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    margin-bottom: 2rem;
  }
  .chip {
    background: #efe9df;
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
  }
  .toolbar button {
    font: inherit;
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    border: 1px solid #1c1a17;
    background: #1c1a17;
    color: #faf7f2;
    cursor: pointer;
  }
  .toolbar button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .error {
    text-align: center;
    color: #a03017;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
  }
  .poem {
    font-size: 1.15rem;
    line-height: 2;
    text-align: center;
  }
  .line {
    min-height: 2em;
  }
  .cell {
    animation: reveal 0.7s ease-out;
  }
  @keyframes reveal {
    from {
      background: #d8b24a;
      color: transparent;
    }
    to {
      background: transparent;
    }
  }
  .mark {
    display: inline-block;
    width: 0.52em;
    height: 1em;
    margin: 0 0.03em;
    vertical-align: baseline;
    transform: translateY(0.12em);
    background: #2b2620;
    border: none;
    border-radius: 2px;
    padding: 0;
    cursor: pointer;
    transition: background 0.15s;
  }
  .mark:hover {
    background: #b58a2e;
  }
  .mark.pending {
    animation: pulse 0.9s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      background: #d8b24a;
    }
  }
  .receipts {
    margin-top: 3rem;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: #6b6257;
  }
  .receipts h2 {
    font-size: 0.8rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    font-weight: 500;
  }
  .receipts ul {
    list-style: none;
    padding: 0;
  }
  .receipts a {
    color: inherit;
  }
</style>
