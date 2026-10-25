---
"everything-dev": minor
---

Enforce the i18n-seam guard (#496): the composition-fatal findings (unwired i18n runtime, unmounted provider, absent root) are promoted from warn to blocker, and `bos upgrade --from v1 --maintain i18n-seam` now **fails with `gate-blocked`** when a blocker remains after the step runs — a child core UI that ships no `@lingui/*` share-scope entries can no longer pass silently and only surface later as RUNTIME-012 at SSR composition. Dry-run previews the blockers as notes instead of failing. The maintain branch also now runs on v2 trees (previously the `already-upgraded` early-return made it unreachable on exactly the post-upgrade trees the guard targets).
