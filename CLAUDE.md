# x402-sveltekit

This package is a SvelteKit port of `@x402/hono` from [x402-foundation/x402](https://github.com/x402-foundation/x402), built to that repo's contribution standards with the intent to upstream it as `@x402/sveltekit` (see docs/UPSTREAMING.md).

Follow the x402 AI-assisted contribution rules:

1. CONCISE OUTPUT ONLY. No filler comments, redundant docstrings, or verbose explanations.
2. NO REDUNDANCY. If logic already exists, use it — do not rewrite it.
3. VERIFY AGAINST THE SPEC. Do not invent header names, payload fields, or signing flows. If unsure whether a field or constant exists, search the codebase — do not guess.
4. MATCH EXISTING PATTERNS. This code mirrors `@x402/hono` (structure, naming, JSDoc, tests). Diverge only where SvelteKit semantics require it, and keep divergences minimal so upstream diffs stay reviewable.
5. DO NOT ADD UNREQUESTED FEATURES.
6. COMMIT MESSAGES. Conventional commits (feat:, fix:, docs:, chore:); subject under 72 characters.
7. CHAIN AND TOKEN CONSTANTS. Never hardcode chain IDs, token addresses, or decimals from memory.
8. TEST CORRECTNESS. Tests must assert meaningful behavior; derive expected values from the spec or existing fixtures.
