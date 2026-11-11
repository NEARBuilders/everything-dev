---
"everything-dev": minor
---

Seed phase: automatic seeding on dev boot with a seeded marker, auth-owner admin bootstrap first (#865)

Consumer apps hand-roll seed scripts and run them by hand; a fresh checkout boots empty and
nothing tells the developer the environment is unseeded. Seeding is now a platform capability —
declared in config, checked automatically, run when needed:

- **Authored `seed` block** — `seed: { version, auth: { ownerAdmin }, steps }` in `bos.app.ts`
  (or the dev overlay). Steps are workspace-relative idempotent scripts (upserts by contract),
  the general surface for app data. The descriptor/resolved schemas, conversion pick lists,
  canonical key ordering, and the scaffold emitter all carry the block; publish canonicalization
  strips it (workspace-relative steps never reach FastKV).
- **`bos dev` seeds before serving** — when the marker (one `bos_seed_state` row in the api
  database) doesn't match `seed.version`, the boot runs the phase pre-spawn: it migrates every
  local workspace from disk first (fresh checkouts have no tables until the services'
  migrate-on-boot fires — and services hold their PGlite data dirs open for their lifetime, so
  nothing can run after them, ADR 0044), then provisions, then runs steps in order, first failure
  aborting the boot loudly. Second boot does nothing; a version bump re-runs.
- **Owner-admin bootstrap first** — `seed.auth.ownerAdmin` (`true` derives the NEAR account from
  the top-level `account`, or name one explicitly) writes the SIWN row shape (`user` role `admin`
  + `near_account` + `account`) into the auth database, so the configured owner signs in with
  platform-admin rights immediately — `/near/verify` resolves the pre-provisioned `near_account`
  and issues a session for the admin user instead of minting a duplicate.
- **Production: explicit only** — `bos seed --env production` requires `postgres://` URLs,
  env-provided owner credentials (`SEED_OWNER_ADMIN_NEAR_ACCOUNT` / `SEED_OWNER_ADMIN_EMAIL`,
  never config defaults), and a confirmation prompt; non-interactive stdin must pass `--yes`
  explicitly rather than hanging on a prompt. The deploy train never seeds.
- **DevEx guards** — the phase refuses to run while a dev stack is live for the project (the
  shared pid registry is checked when pglite URLs are in play — a cross-process seed would
  block on the PGlite file lock indefinitely, ADR 0044); a seeded boot pays only the marker
  read (migrations run only when the phase will actually seed); `SEED_STEP_TIMEOUT_MS` bounds
  each step (SIGTERM → SIGKILL, default off).
- Route `POST /seed` in the CLI contract; the runner (`services/seed/runner.ts`) and the marker
  semantics are the unit-tested contract surface (`tests/unit/seed-phase.test.ts`,
  `tests/unit/seed-config.test.ts`) with the auth-schema provisioning canaried against the real
  plugin migrations in `tests/integration/seed-phase.test.ts`. Docs: `docs/seed-phase.md`.
