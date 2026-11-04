---
"everything-dev": minor
---

Registry starts consume `bos.lock.json` (ADR 0042 ticket 03): when a lockfile is present for the booting runtime, its frozen remote coordinates are the boot's authority — missing pins are stamped from the frozen descriptors and drifted coordinates are overridden, with every stamp and disagreement reported as a loud warning in the start summary. The boot never fails because of the lockfile — enforcement lives in CI via `bos lock --check`. The `everything-dev/lockfile` surface gains `applyCompositionLockfile` (pure application: stamping, drift reporting, runtime-ref guard).
