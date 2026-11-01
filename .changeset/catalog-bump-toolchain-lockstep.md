---
"everything-dev": patch
---

Bump the platform catalog: better-auth 1.7.7 → 1.7.14 (with @better-auth/*), @orpc suite 2.0.0-beta.35 → 2.0.0-beta.45 (`PublisherResumeOptions` takes `ttl` in milliseconds instead of `seconds`), @tanstack/react-router 1.170.32 → 1.170.46 (router-core 1.171.39, router-plugin 1.168.48, router-generator 1.167.46), and the Effect toolchain trio in lockstep (@effect/tsgo 0.63.0, oxlint 1.90.0, oxlint-tsgolint 7.0.2005). The pnpm pin moves to 12.16.1.

Overrides now reference the catalog through pnpm's `catalog:` protocol so shared-dep pins cannot drift from the catalog (#659/#682); `bos upgrade` reconciles child overrides, propagates the pnpm pin forward-only to existing v2 children, and regenerates the framework `minimumReleaseAgeExclude` rows from the catalog with `minimumReleaseAgeExcludePrune` enabled — the list replaces instead of accumulating. The v1→v2 migration's `V2_CATALOG` baseline is drift-guarded against the parent catalog (row-for-row, both directions), closing #650's outdated-catalog vector.
