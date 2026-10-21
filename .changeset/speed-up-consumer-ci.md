---
"everything-dev": patch
---

Speed up consumer CI: the reusable `consumer-ci.yml` now runs lint, typecheck, and test in parallel jobs (instead of one serial job), caches the pnpm store across runs, and caches generated types keyed on `bos.app.ts` so `bos types gen` is a no-op when the config is unchanged. Child repos using `lint-and-typecheck-gate` now depend on the `lint` and `typecheck` jobs.
