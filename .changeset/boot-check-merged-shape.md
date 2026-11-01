---
"everything-dev": patch
---

The pre-publish gate validates the extends-merged boot shape; children deploy and roll back again

- Regression fix for the rc.23 gate (#625): it validated the canonicalized **leaf** payload against `BosConfigSchema`, whose `app` slots (`host`/`ui`/`api`) are required — but extends children legitimately author none of the host slot and inherit it at boot. Every child full deploy (and config-only publish) failed post-build with `app.host: Invalid input: expected object, received undefined`, publishing nothing. The new `verifyBootPayload` boot-check (`resolution/boot-check.ts`) re-runs the consumer's own walk-merge-parse — `walkExtendsChain` with the payload as the seeded leaf, env pinned to `resolvePublishedConfig`'s `PUBLISHED_CONFIG_ENV` — so the verdict is boot parity by construction: root payloads parse as-is with zero I/O; child payloads are judged on the merged shape their consumers will boot.
- The boot-check reports structured issues (`code`/`path`/`origin`/`message`) with best-effort origin attribution — a failing path present in the leaf is the leaf's; anything else came from the parent chain — and a chain-failure class for unreachable parents and circular extends, surfaced at preflight instead of as a post-publish smoke failure.
- `bos rollback` (and the smoke-failure rollback protocol) no longer crash on child snapshots: the historical `BosConfigSchema.parse(targetValue)` threw on host-less child leaves. The snapshot is now boot-checked (unskippable — the rollback command's own vetting covers pins/bytes, not boot-ability) and republished **verbatim**: the old parse's Zod strip mode silently dropped keys the schema didn't know, which broke a rollback's byte-faithful republication guarantee.
