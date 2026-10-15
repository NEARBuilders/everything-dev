# Apps

Independently deployed services live here — not registered in `bos.app.ts`, each with its own deploy lifecycle. Composed plugins registered in `bos.app.ts` live in `plugins/`. Runtime libraries and clients live in `packages/`.

| App | Purpose | Deployment | Status |
|---|---|---|---|
| [`upload/`](./upload) | Bundle write/control surface — receives deploy-train uploads, stores to R2, serves the inspection API (ADR 0027 phase 0) | Railway service `upload` (any Docker host — [boot-chain contract](../docs/architecture/boot-chain.md)) | live |
| [`_/`](./_) | Host app — api and ui mount through it (`/$path.$accountId/$domain`) | universal image | planned |
| [`auth/`](./auth) | Auth app — admin dashboard, org/team management, API-key minting, login (absorbs `plugins/auth` per ADR 0027) | universal image | planned |
| [`build/`](./build) | Reference starter app — bare ui+api, ships skills via TanStack Intents + mattpocock/skills (what `bos init` scaffolds from, per ADR 0027) | — | planned |
| [`dev/`](./dev) | Development app — per-project sidecar + dashboard (ADR 0027) | — | planned |
| `www/` | Production everything.dev app — `ui/` + `api/` move here (ADR 0027 §1) | universal image | planned — dir not yet created |

Every app runs on the universal image and boots through the same [boot-chain contract](../docs/architecture/boot-chain.md): identity (`BOS_ACCOUNT`/`BOS_GATEWAY`) → FastKV config → CDN bundles → Module Federation runtime. A hosting provider is anything that can run that Docker image — Railway is the current instance, not the architecture.
