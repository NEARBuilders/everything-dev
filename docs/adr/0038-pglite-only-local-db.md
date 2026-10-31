# 0038 — PGlite is the only local database

Date: 2026-10-30 · Status: accepted

## Context

Every scaffolded app shipped a `docker-compose.yml` with hardcoded host ports
5432–5435. Concurrent projects each tried to bind the same block, so starting a
second `bos dev` failed with `Bind for 0.0.0.0:5433 failed: port is already
allocated` (observed between `nearbuilders.org` and `work.efiz.near`). The
zero-config default was *ephemeral* pglite (`pglite:.bos/<slug>/:memory:`,
plan 055 ticket 11) — data lost on every restart — which is exactly why
operators opted into compose Postgres just to persist data. The conflict class
was structural: any operator wanting persistence had to race every other
operator for one port block.

Two real options existed: per-project DB port allocation (extend ADR 0012), or
a single shared postgres with per-project databases. Both keep a server, ports,
docker lifecycle, and credentials in the dev-loop critical path.

## Decision

**Local persistence is a file-backed PGlite data dir; docker-compose is
retired entirely (dev and test).**

- The zero-config dev default is `pglite:.bos/db` — persistent, per
  workspace process (processes spawn with cwd = the workspace, so `api/`,
  `plugins/<id>/`, each keep their own data dir; no ports, no docker, no
  cross-project collision is possible by construction).
- The two-database contract is unchanged: auth keeps its own data dir; api and
  its in-process plugins share one dir, with plugins schema-isolated under
  `plugin_<slug>` (the fallback `*_DATABASE_URL` → `API_DATABASE_URL` now
  yields genuine shared data instead of disjoint in-memory islands).
- Tests run on in-memory pglite (`pglite::memory:` / temp dirs). `.env.test`
  carries only the test auth secret + in-memory URLs.
- `TEST_DATABASE=postgres` + an explicit external `postgres://` URL remains
  the parity escape hatch (pglite/postgres savepoint semantics diverge —
  plan 008 findings). No committed compose anywhere; CI keeps no postgres.
- `bos dev` repairs legacy state once: conventional compose-era URLs
  (`postgres://everythingdev:…@localhost:{5432–5435}/{api_db,auth_db,…}`,
  including drift ports) in `.env` are rewritten to the new defaults, and a
  scaffold-shaped `docker-compose.yml` is relocated to `.bos/compose-retired/`.
  Operator-authored postgres URLs and compose files are untouched.
- Production is unchanged: `postgres://` URLs, Neon/Railway, ADR 0035.

## Consequences

- **Port conflicts are structurally impossible** for the local default — the
  collision class this ADR exists for cannot recur.
- **Concurrent access works out of the box.** pglite ≥ 0.4.6 supports multiple
  instances per data dir across processes (multi-worker file locking),
  verified empirically in this repo: a second process reads what a first
  wrote, and `db:studio`/`db:migrate` run while `bos dev` holds the dir. Two
  dev sessions in one repo share data rather than failing — heavy concurrent
  writers queue on the file lock, which is acceptable at dev scale.
- **drizzle-kit needs the `pglite` dialect** for `pglite:` URLs: configs now
  select dialect/credentials via `drizzleCredentialsFor(url)` (`dialect:
  "pglite"` + `driver: "pglite"`, data-dir path), plain postgres URLs keep
  `dialect: "postgresql"`.
- **The driver creates the data dir recursively.** PGlite mkdirs only the leaf
  component; a missing `.bos/` prefix previously failed ENOENT at boot.
- **Seek-time / heavy-query performance** is WASM-bound — acceptable for dev
  workloads (the plan 055 zero-config decision already accepted this class of
  tradeoff); production parity stays on real postgres.
- **The compose-era skill surface dies**: no `dev:postgres*`, `test:db:up`,
  `test:db:reset` scripts, no compose template in `bos init`, no preflight
  auto-start. ADR 0012's port-block model now governs only the booted
  services (host/api/auth/ui/plugins), which was always its actual concern.
- **Regression fixtures seed through the API, not the DB.** With in-memory
  pglite the stack's database lives inside its own process — no out-of-process
  client can reach it. The direct-DB test helpers (`auth-test-instance`,
  `migrate-test-db`, the Go approve step) are replaced by HTTP seeding
  (`tests/regression/lib/http-seed.mjs`): anonymous sign-in mints sessions,
  Better Auth routes create orgs, and admin actions run through the existing
  `reviewOrganization` / `adminSetRole` routes using a boot-time bootstrap
  admin API key (`AUTH_BOOTSTRAP_ADMIN_API_KEY`, dev/test-only — the auth
  plugin ensures a platform admin + API key from that secret; never set in
  production). Cookie artifacts (`cookies.json`, `admin-cookies.json`,
  `logout-cookies.json`) keep the same locations, captured as Playwright
  cookie snaps from the sign-in responses.

## References

- Plan 055 ticket 11 (zero-config dev), the seed of this decision.
- Issue #651 (contradictory v1 infra state) — this retires that bug class.
- ADR 0012 (ports as scoped resources), ADR 0033 (db seam), ADR 0035 (durable
  Postgres).
