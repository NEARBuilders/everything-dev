---
"every-plugin": major
---

pnpm/node runtime alignment (ADR 0026)

- The `every-plugin` CLI bins are node-first: the dist path runs plain node,
  and the bootstrap tsx fallback (fresh checkout, no dist yet) passes
  `--conditions=development` so the config chain resolves source over a dist
  that does not exist yet. Emitted bin shebangs are `#!/usr/bin/env node`.
- `every-plugin/identity` inside the rspack config chain resolves relatively
  (a package self-import fell through to the default condition and hit a
  missing dist under node).
- `PLUGIN_VERSION` reads the package manifest via `node:fs` — the previous
  `createRequire(import.meta.url)` came up empty under tsx in spawned
  processes, reading 0.0.0 and tripping the shared-identity check.
- `exports:sync`, `build:test`, and the integration test scripts run through
  node/tsx/pnpm; `@types/bun` and `bun-types` are dropped.
