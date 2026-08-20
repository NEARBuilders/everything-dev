---
"everything-dev": minor
---

Add a `bos typecheck` command that runs TypeScript type checking across all local workspaces (host, ui, api, auth, and every plugin with a `tsconfig.json`), streaming errors inline and failing with a non-zero exit if any workspace fails. Root `bun run typecheck` now delegates to it.

- New `bos typecheck [packages]` aggregates pass/fail across all configured local workspaces instead of stopping at the first error.
- Framework source hardened for strict consumer configs (`noUncheckedIndexedAccess`): safe non-null assertions in `contract.ts`, `fastkv.ts`, and `api-contract.ts`.
- `plugins/apps` tsconfig aligned with the plugin template (`types: ["node"]`, DOM lib) so its typecheck passes.
