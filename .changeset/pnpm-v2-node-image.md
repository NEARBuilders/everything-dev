---
"everything-dev": minor
---

Node-based universal image (ADR 0026 ticket 04)

- All five Dockerfile stages run `node:24-alpine` with pinned pnpm — no `oven/bun` base remains. The runtime `CMD` boots `bos start` on node (the start stack loads the host/api/plugins in-process through Module Federation; no child spawns on that path).
- The dist-builder's workspace builds and the deploy train's build leg spawn `npm run build` (was `bun run`), and shared-deps catalog changes run `pnpm install`.
- The every-plugin bin re-execs through tsx: `dev` carries the `development` condition; other commands run the built dist when present (fresh checkouts fall back to tsx + src for the bootstrap build).
- The image prune script reads workspace globs from pnpm-workspace.yaml.
