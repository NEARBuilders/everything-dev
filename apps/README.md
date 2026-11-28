# Apps

Independently deployed services live here — not registered in `bos.app.ts`, each with its own deploy. Composed plugins registered in `bos.app.ts` live in `plugins/`. Runtime libraries and clients live in `packages/`.

| App | Purpose | Deployment | Status |
|---|---|---|---|
| [`upload/`](./upload/README.md) | bundle write/control surface (ADR 0027 phase 0) | Railway service `upload` (any Docker host per the boot-chain contract) | live |
| `_/` | host app — api/ui mount through it (`/$path.$accountId/$domain`) | universal image | planned |
| [`auth/`](./auth/README.md) | auth plugin as standalone admin-dashboard app (`/admin`, `/login`) | universal image | planned |
| [`build/`](./build/README.md) | starter app — bare ui+api + skills distribution (TanStack Intents, mattpocock/skills) | — | planned |
| [`dev/`](./dev/README.md) | starter app — bare ui+api | — | planned |

Planned rows are the composition roadmap, kept deliberately. Each sketch holds a one-line README (`<app>.everything.dev`); `_/` has no directory yet.
