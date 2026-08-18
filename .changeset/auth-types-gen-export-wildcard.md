---
"everything-dev": patch
---

Fix stale auth type name in type generation by replacing the hard-coded re-export list in `auth-types.gen.ts` with `export type *`. New types added to the auth plugin's `auth-export.ts` now flow through automatically without generator changes, preventing the class of `TS2724` errors caused by stale type names.
