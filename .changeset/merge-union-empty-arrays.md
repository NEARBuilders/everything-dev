---
"everything-dev": patch
---

Fix extends-merge union arrays: merging configs where both parent and child declare an empty `secrets`/`connectSrc` array at the same path previously deleted the key entirely (the union helper returned `undefined`, which the merge customizer assigned through). The union now always yields an array, restoring associativity and the self-merge fixpoint property of config resolution. Surfaced by a new property-based law suite (`tests/unit/merge-properties.test.ts`) checking merge associativity, child precedence, parent-null shadowing, idempotence on resolved configs, digest atomicity, and publish-canonicalization invariants (`local:` targets never publish, seed never publishes).
