---
"everything-dev": minor
---

Deploy speed (ticket #430), in the new service structure:

- **Content-hash rebuild oracle** behind the staleness seam: a Turborepo-style `contentHashStalenessOracle` (workspace tree + transitive local-dependency hashes + build-mode env, persisted at `.bos/build-cache.json`, unknown → build) replaces the deploy blanket force-rebuild of the prerequisite closure. On this repo (13 members) recording costs 765ms and a full freshness judgement 604ms — a warm deploy skips every fresh prerequisite instead of rebuilding them all. `--force-build` (and `BOS_FORCE_BUILD=1`) retains the forced-rebuild escape hatch.
- **Build concurrency capped** at ~`os.cpus()` (overridable per call via `concurrency`); unbounded parallel workspace builds oversubscribed 2–4 core CI runners.
- **Uploads concurrent and pipelined**: independent bundle keys upload with bounded concurrency (`BOS_UPLOAD_CONCURRENCY`, default 4) and each workspace's upload starts as its build completes instead of after the whole train; outcomes assemble in target order, so the published config is byte-identical to the serial train's, and the first failure in target order is the one thrown.
- **Redundant work trimmed**: the docker probe is skipped when an image digest is prebuilt (it could never reach the build branch), and the publish-confirmation wait tracks the submitted transaction — cheap history probes with a 2-probe trial window, then one authoritative read-back; a registry whose history never carries the tx falls back to plain equality polling. The preflight/idempotency config-fetch dedupe was attempted and reverted: the two readers normalize differently (raw JSON vs Zod-parsed), so comparing across them misdetects drift — config reads went 3→2, not 1. Pin-verification's manifest fetch is unchanged (the fetch is the propagation check it exists to be).

Timing on a fully representative deploy (real uploads + NEAR transaction) requires a funded run; the structural measurements above are from this repo's own workspace closure.
