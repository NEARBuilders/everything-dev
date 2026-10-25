---
"everything-dev": patch
---

Upgrade derives its migration delta from durable state instead of carrying it on a flag

- `bos upgrade` no longer forwards the pre-upgrade framework version through the re-exec boundary (`--from <version>`). The migration-phase delta is derived from durable state — the authored `platform` pin vs the resolved release manifest — so the parent and the re-exec'd child compute the identical value, and the `--from` flag stays the v1→v2 train selector it was narrowed to in #505. This fixes the migration phase failing (`invalid_value` on `from` for every version-delta upgrade since that change): packages were applied but the template sync, platform-pin stamp, shared-deps sync, and types gen were skipped, leaving a half-upgraded tree.
- Half-upgraded trees self-heal: a pin that lags (or is absent) counts as pending migration work — rerun `bos upgrade` and the template sync, pin stamp, and shared-deps sync complete; `bos upgrade --check` reports the pending work instead of "up to date".
- `--migrations-only` (historically a guaranteed no-op without `--from`) is now the repair path: it completes any pending migration and stays a no-op on an aligned tree.
