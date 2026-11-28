---
"everything-dev": minor
---

Remove the nine dead export-map entries (`./sdk`, `./ui`, `./cli`, `./cli/init`, `./plugin`, `./bundle-cache`, `./contract.meta`, `./ui/router`, `./ui/router-defaults`) — no external consumer was found on any shipped code path (host, ui, api, plugins, templates, scaffolded child code, regression tests). `src/sdk.ts` (pure re-export facade) and the `src/ui/index.ts` barrel are deleted; the other modules stay and their intra-package consumers keep using relative imports. The `bos` bin is unaffected (`dist/cli.mjs` is still built from the `cli.ts` entry).
