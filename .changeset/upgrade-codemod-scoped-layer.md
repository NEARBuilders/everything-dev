---
"everything-dev": patch
---

Harden the `bos upgrade` scoped-layer codemod to also scan `api/src/index.ts` (previously only `plugins/*/src/index.ts`) and to rewrite the `.pipe(Effect.provide(<Layer>))` form into `tools.buildService(<Tag>, <Layer>)`. This pattern bound `acquireRelease` finalizers to a temporary scope that closed at the end of `initialize`, causing resources like database pools to be released (e.g. `pool.end()`) immediately at startup instead of during graceful shutdown. Children using this form are auto-migrated on upgrade; ambiguous cases emit a warning and are left for manual migration.
