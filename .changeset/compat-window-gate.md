---
"everything-dev": patch
---

Gate non-release deploys against the live compat window: when the platform pointer stays put, the upload leg now refuses bundles whose embedded singleton versions diverge from the published release manifest's `sharedDeps` — a chain that moved mid-version (a catalog bump without a version bump) previously landed skew on every pinned child while every in-train version stamp agreed. Failed legs surface the offending rows with the release-train remediation; the release leg itself is unchanged (it repins the window with the chain).
