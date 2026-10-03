---
"everything-dev": minor
---

Atomic deploys tickets 07-08: the host gains a `SnapshotCoordinator` (adopt the published FastKV pointer: derive via version manifests, pre-warm a fresh compose state, SRI-verify pinned entries, atomically swap the RuntimeSnapshot — any failure leaves the live snapshot untouched) and a `SnapshotWatch` supervised fiber replacing the setInterval integrity monitor (pointer poll → adopt on fingerprint change; per-tick entry SRI verification with re-adopt-then-alert on mismatch; production-only).
