# Upstreaming plan: `@x402/sveltekit`

Goal: contribute this package to [x402-foundation/x402](https://github.com/x402-foundation/x402) as `typescript/packages/http/sveltekit`, published as `@x402/sveltekit`. No PR until every item below is done and the code has soaked in production on a real site.

## Why this should land

- Upstream ships Express, Fastify, Hono, and Next integrations; SvelteKit is the largest full-stack framework with no official adapter.
- No SvelteKit issue or PR exists upstream (checked 2026-07-11).
- This package is a line-for-line port of `@x402/hono` — same control flow, same JSDoc, same test structure, same configs — so the review diff is essentially "Hono adapter, SvelteKit request model."

Prior art to acknowledge in the PR: [xarmian/x402-sveltekit](https://github.com/xarmian/x402-sveltekit) (community package, own routing layer, pinned to core 2.2). Different design (re-implements route matching and 402 construction rather than delegating to `x402HTTPResourceServer`); credit it and explain the difference if asked.

## Where things go in the monorepo

| This repo               | Upstream                                 |
| ----------------------- | ---------------------------------------- |
| `src/`, configs, README | `typescript/packages/http/sveltekit/`    |
| — (new)                 | `examples/typescript/servers/sveltekit/` |
| — (new)                 | `e2e/servers/sveltekit/`                 |
| — (new)                 | changeset in `typescript/.changeset/`    |

Conversion notes:

- `package.json`: rename to `@x402/sveltekit`, version set by maintainers, `author: "x402 Foundation"`, deps become `"@x402/core": "workspace:~"` and `"@x402/extensions": "workspace:~"`; `@sveltejs/kit` stays a peer dep (and moves to devDeps for tests). Match `@x402/hono` field order.
- `tsconfig.json`: replace standalone options with `"extends": "../../../tsconfig.base.json"` + `include: ["src"]`.
- README: swap package name in examples; drop the standalone-only sections (Related, License).
- Delete `CLAUDE.md`, `docs/` (this file), `.github/` — the monorepo has its own CI (turbo).
- All `@jamesrisberg/x402-sveltekit` import strings in JSDoc examples → `@x402/sveltekit`.

## Their contribution requirements (from CONTRIBUTING.md)

- [ ] **AI disclosure**: the PR description must note this was largely AI-generated and human-reviewed. Their policy explicitly welcomes this when disclosed.
- [ ] **Signed commits** (`git config commit.gpgsign true`) — required for all commits.
- [ ] **Conventional commits** (`feat: add @x402/sveltekit handle hook`).
- [ ] **Changeset** (`pnpm -C typescript changeset`), minor bump, past-tense summary.
- [ ] **Example** under `examples/typescript/servers/sveltekit/`: minimal SvelteKit app (hooks.server.ts + one protected +server.ts route), `.env-local`, README with setup/run — mirror `examples/typescript/servers/hono/`.
- [ ] **E2E server** under `e2e/servers/sveltekit/`: mirror `e2e/servers/hono/` (`index.ts` server on a port, `run.sh`, `build.sh`, `install.sh`, `test.config.json`, package.json named `@x402/sveltekit-e2e`). This runs against their mock facilitator in CI — the strongest correctness signal we can offer.
- [ ] `pnpm lint:check`, `format:check`, `test`, `build` green from `typescript/` root.

## Gaps to close before opening the PR

1. **Production soak**: run this package on jamesrisberg.xyz/tollbooth (mainnet, CDP facilitator) and process at least one real settled payment end-to-end. A PR backed by "this is live and has settled real USDC" is a different conversation than "this compiles."
2. **E2E against their harness locally**: clone upstream, drop the package in, build the e2e/sveltekit server, run their suite with the mock facilitator. Do this _before_ the PR, not in review.
3. **Edge runtime question**: `Buffer.from(await response.clone().arrayBuffer())` matches Hono, but SvelteKit deploys to edge runtimes more often than Hono servers. Test on `adapter-cloudflare` (workers `nodejs_compat`) or explicitly document Node-only, and be ready for a reviewer to ask.
4. **Route pattern semantics**: core's route matching (`"GET /api/*"`) is path-based and knows nothing about SvelteKit's route ids (`/api/[slug]`). Document clearly that patterns match URL paths, not SvelteKit route ids; consider whether `event.route.id` support is worth proposing as a follow-up (do not include in the initial PR — "no unrequested features").
5. **`sequence()` interaction**: verify ordering behavior when composed with other handles (auth before payment, payment before logging) and document the recommended order.
6. **Version currency**: rebase onto the latest `@x402/core` before the PR; if their hono/index.ts changed since this port, re-port the delta (keep a pinned reference: ported from `@x402/hono@2.18.0`).

## Sequencing

1. Standalone package live (npm + GitHub) and soaking on jamesrisberg.xyz — done first, no dependency on upstream.
2. Close gaps 2–6 above in this repo.
3. Open an upstream **issue** proposing the adapter, linking the standalone package and the live tollbooth. Let a maintainer say "yes, PR welcome" — cheap way to catch objections (naming, timing, edge policy) before writing the PR.
4. Fork, convert per the table above, one signed conventional commit, changeset, example, e2e server.
5. Open the PR: short description (what, why, AI disclosure, link to live deployment and this repo), no filler.
