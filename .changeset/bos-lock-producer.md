---
"everything-dev": minor
---

`bos lock` — freeze the resolved composition into `bos.lock.json` (ADR 0042). The command resolves the authored config through the full extends chain + release stamping (the same resolution session the deploy train uses) and writes the lockfile atomically; `bos lock --check` re-resolves and exits 1 on drift for CI. The runtime map gains lockfile provenance: when a lockfile exists, the generated map carries its fingerprint, release, and resolved-at, and names every source/backend whose serving digest differs from the frozen one (`lockfile.drift`) — the explainer can no longer drift silently from the frozen composition. `everything-dev/lockfile` gains `readLockfileIfExists` and the shared `writeLockfile` producer seam.
