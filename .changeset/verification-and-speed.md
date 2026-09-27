---
"everything-dev": patch
---

Verification & speed (plan 040): the root `bun run test` chain now includes the framework suites (`test:framework` — everything-dev + every-plugin), so a green root run actually exercises the CLI package. `bos dev`/`bos start` no longer block service spawn on the outdated-packages check (npm registry + FastKV round trips, up to ~10s with retries) — the warning prints late via stderr instead (TTY-preserving). The two config test suites stub their network boundary (`http-client`/`fastkv`/`api-contract`) instead of doing real DNS-resolution retries (~15s saved per run, environment-independent).
