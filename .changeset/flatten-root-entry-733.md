---
"everything-dev": minor
---

Remove the root `.` export entry — `import ... from "everything-dev"` no longer resolves. The entry was an `export *` barrel over six modules (~308 symbols, most never consumed); the sole external consumer (`plugins/registry`, the `BosConfigInput` type) now imports from `everything-dev/types`. Intra-package consumers already import submodules directly. `src/index.ts` is deleted; no other subpath is affected.
