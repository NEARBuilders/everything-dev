---
"every-plugin": patch
---

Fix boot SSR composition failing with a false `unresolvable parentage` when a
core-ui route claim shadows a plugin route that has children (e.g. both a
tenant and the auth plugin declare `_public/login` → `/login`). The cascade
branch of `constructTree`'s pending resolution marked a shadowed record's
descendants shadowed but never removed them from `pending`, so the drain guard
threw — naming exactly the records that should have been silently skipped —
and degraded the host's boot health. Shadowed descendants are now spliced out
of `pending` as they are marked (and count as loop progress, so
grandchildren ordered before their shadowed parent still drain across passes).
