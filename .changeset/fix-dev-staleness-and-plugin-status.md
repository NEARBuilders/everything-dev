---
"everything-dev": patch
"host": patch
---

Fix stale workspace dist breaking dev servers and false "Process failed" statuses in bos dev.

After moving plugin sources into the repo, `bos dev` showed TEMPLATE/API as failed although both servers ran: rspack dev servers bundle workspace packages from their `dist` exports, and `bos dev` skipped rebuilding `packages/everything-dev` whenever a dist existed — so new exports (e.g. `isRetryableMigrationError`) were missing from dev bundles, producing ESModulesLinkingWarning and silently inactive fixes. Separately, the plugin error pattern `/error/i` matched the substring "Error" inside identifiers in warning text, marking healthy servers as failed, and the sticky error status ignored later "ready" signals.

- `bos dev` now rebuilds `everything-dev`/`every-plugin` dists when stale (newest source/package.json mtime vs dist entry) instead of skipping whenever dist exists.
- Plugin error patterns tightened to real compile-failure signals (`ERROR in`, `failed to compile`, `Module not found`, `Cannot find module`) — no more false failures from warning text.
- A later "ready" signal now clears an earlier "Process failed" status, matching rspack watch-mode recovery.
- New `suppressPgQueryQueueDeprecation()` (host + api boot): silences pg's once-per-process query-queue deprecation from pg-pool's internal dispatch while re-printing every other process warning (Node's default warning handler is removed first, since it prints even with listeners attached).
