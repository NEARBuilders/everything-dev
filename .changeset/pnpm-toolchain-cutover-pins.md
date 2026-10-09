---
"everything-dev": patch
---

`bos init` now pins generated child projects to the parent workspace's pnpm (`pnpm@12.10.1`), matching the pnpm 10 → 12 toolchain cut-over; a unit test pins the constant to the root `package.json` `packageManager` field so the two can't drift again. Previously children were pinned to `pnpm@10.20.0`, whose packageManager auto-switch path fails against the new pin.
