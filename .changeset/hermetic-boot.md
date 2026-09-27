---
"everything-dev": minor
---

Hermetic boot for image-native runtimes (ADR 0011 amendment — the image consumes what it stages): a self-contained runtime resolves its own-namespace bundle URLs (`https://<domain>/bundles/<account>/<gateway>/…`) from `BOS_BUNDLE_DIR` on disk instead of round-tripping through its own public origin, so a cold boot no longer depends on the gateway, DNS, or the host being up. Registry-tier children are unaffected — remotes still load from their published URLs. `BOS_BUNDLE_DIR`-less environments see zero behavior change.

Also fixes the production crash-loop class this exposed: port allocation no longer reserves ports for remote-source services (they spawn nothing locally), a stale PID-registry claim (PID reuse across container restarts) can no longer wedge a pinned port — claims record the process generation and are pruned when it no longer matches — and Docker healthcheck start-periods no longer kill a cold boot mid-startup. `bos start` reports `InfraError`/`DevStepError` failures instead of escaping them as unhandled rejections.
