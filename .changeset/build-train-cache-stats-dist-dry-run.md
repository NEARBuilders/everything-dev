---
"everything-dev": patch
---

Build-train cache v2 and staleness reporting (#481, #482, #483). `.bos/build-cache.json` moves to a versioned v2 shape (`{ version, members }`) whose entries carry per-file mtime/size stats manifests: unchanged trees reuse the recorded input hash without reading file contents, any drift (changed/new/removed file) falls back to a full rehash, and pre-v2 flat caches invalidate cleanly. `recordBuilt` now also persists a dist output record (tree hash + stats manifest + an entry-file anchor hash that is re-verified on every judgement), and `isStale` rebuilds when the dist bytes no longer match. `bos build --dry-run` reports per-member staleness verdicts (fresh/stale/forced) with stale reasons — `no-cache-entry`, `missing-dist`, `input-hash-mismatch`, `dist-hash-mismatch`, `dependency-stale:<name>` — through the new `verdicts` event on the `WorkspaceBuildRender` seam; it runs no builds and exits 0 regardless of verdicts.
