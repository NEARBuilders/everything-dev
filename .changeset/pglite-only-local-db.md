---
"everything-dev": minor
---

PGlite is the only local database — docker-compose is retired (ADR 0038). The zero-config dev default is now a persistent, file-backed PGlite data dir (`pglite:.bos/db`, per workspace process), so concurrent local projects can never collide on DB ports and data survives restarts without any `.env`. `bos dev` migrates leftovers once: compose-era `postgres://everythingdev:…@localhost:543x/…` URLs in `.env` are rewritten to the pglite defaults and a scaffold-shaped `docker-compose.yml` is relocated to `.bos/compose-retired/`. `db:*` commands work against pglite (drizzle-kit pglite dialect selected by URL scheme); the CLI/scaffold drop the compose template, `dev:postgres*` scripts, post-init docker prompt, and preflight auto-start; regression tests and the deploy smoke run on pglite (`TEST_DATABASE=postgres` + an external URL remains the parity escape hatch). Production `postgres://` URLs are unchanged.
