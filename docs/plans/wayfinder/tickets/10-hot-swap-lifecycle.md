## Question

What is the OTA hot-swap lifecycle for `bos start --watch` — how are in-flight requests handled, when are plugin scopes torn down, and how is the ESM module cache disposed?

## Resolution

**Direction locked (decision 14) — lifecycle design still needs a prototype.**

- Direction: the static container never restarts for code changes. It polls the FastKV read URL for its account's config (~5s); on change it validates the trust chain (signed on-chain config + per-remote SRI), re-imports MF remotes at new URLs (Node's ESM cache is URL-keyed — fresh URLs load fresh modules), destroys old plugin scopes, re-initializes, and rolls back to the last-good config on any failure. One generic image for every tier, parameterized only by `BOS_ACCOUNT`/`BOS_GATEWAY`.
- Open: in-flight request draining, DB pool handoff, and ESM disposal. Prototype required before implementation (beta-v2 Phase 9).
- Related: decision 11 (bundle storage — the `--watch` host caches bundles on local disk at hot-swap time, turning gateway flakiness into a one-time cold-fetch cost).
