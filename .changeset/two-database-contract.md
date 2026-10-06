---
"everything-dev": patch
"every-plugin": patch
---

Two-database contract: production deployments now need only `AUTH_DATABASE_URL` and `API_DATABASE_URL`; plugin `*_DATABASE_URL` secrets fall back to the shared API database (per-plugin tables isolate in `plugin_<slug>` schemas). Explicit per-plugin values still win.

- `bos start` no longer manufactures `.env`/`.env.example`/`.env.test` at boot — the production container previously generated a dev-convention `.env` (localhost Postgres URLs) and dotenv-loaded it, feeding plugin DB secrets unreachable URLs (`ECONNREFUSED`). `bos start` only loads an operator-provided `.env`; `bos dev`/`bos init` keep the bootstrap.
- Plugin `*_DATABASE_URL` secrets missing from the host environment resolve to `API_DATABASE_URL` (host plugin composition).
- Generated `.env.example` omits plugin database secrets (they are fallback-covered); `.env.test` keeps explicit test-database values for isolation.
