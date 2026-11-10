# Seed phase

Declarative database seeding for everything.dev apps (#865). Consumer apps hand-roll
seed scripts and run them by hand; a fresh checkout boots empty and nothing tells the
developer the environment is unseeded. The seed phase makes seeding a platform
capability: declared in config, checked automatically, run when needed.

## Declaring a seed

Add a `seed` block to the authored config (`bos.app.ts`, or `bos.dev.ts` for
dev-only overrides):

```ts
export default App({
  name: "my-app",
  account: "my-app.near",
  // ...
  seed: {
    // Bump to re-run the whole phase deliberately (owner bootstrap + steps).
    version: 1,
    // Framework-provided first step: provision the app owner as platform
    // admin (`user.role = 'admin'`) in the auth database. `true` derives the
    // NEAR account from the top-level `account`; name it explicitly for
    // multi-segment accounts, or use `email` for email identities.
    auth: { ownerAdmin: true },
    // The general surface: arbitrary idempotent scripts, in order.
    steps: ["api/scripts/seed-places.ts", "api/scripts/backfill-node-places.ts"],
  },
});
```

Steps are workspace-relative paths resolved from the repo root, executed as
`pnpm exec tsx <path>` (so `tsx` must be available at the workspace root — it is
in scaffolded projects). Each step receives the full environment, including
every local workspace's resolved `<SLUG>_DATABASE_URL` (e.g. `API_DATABASE_URL`,
`AUTH_DATABASE_URL`, `VOTES_DATABASE_URL`), so scripts can address any
workspace database without re-deriving secrets.

### The idempotency contract

Steps run once per `seed.version`. They must be **idempotent — upserts, not
blind inserts** — because:

- a failed step aborts the boot (or the `bos seed` run) and the phase re-runs
  in full on the next attempt;
- bumping `seed.version` re-runs every step against a database that already
  holds the previous version's data;
- `bos seed --force` re-runs the whole phase at the same version.

A step that cannot tolerate re-running is a bug waiting to happen — write
`INSERT ... ON CONFLICT DO NOTHING/DO UPDATE` or an equivalent existence check.

## What runs, and when

### Development: automatic, before serving

`bos dev` checks the marker on boot; when unseeded (or version-bumped), it runs
the phase before any service spawns:

1. **Migrations first** — every local workspace's schema is brought current
   (`loadMigrations`/`runMigrations` against the same per-workspace journal the
   services use, so the services' own boot migrations become no-ops).
2. **Owner-admin bootstrap** — `seed.auth.ownerAdmin` provisions the owner into
   the auth database as platform admin.
3. **Declared steps** — in order; first failure aborts the boot loudly.
4. **Marker write** — one `bos_seed_state` row in the api database recording
   the version that produced the state.

The phase must run pre-spawn by construction: in dev every workspace DB is a
PGlite data dir held open by its service process for the process's lifetime
(ADR 0044), and a cross-process open would block on the file lock. Sequential
open→use→close before the services spawn is the only legal ordering, which is
also why the phase applies migrations itself.

### The marker

One row (`id = 'app'`) in the `bos_seed_state` table of the api database:
`{ version, seeded_at, steps }`. A matching version short-circuits the phase —
the second boot does nothing beyond the (idempotent) migration pass. Bump
`seed.version` to re-run deliberately.

### The owner-admin bootstrap

The first seed step is framework-provided: the configured owner becomes the
platform/account admin so the developer signs in with admin rights
immediately (admin dashboards, API keys, org approval flows). For NEAR
accounts the bootstrap writes the full SIWN row shape — `user` (role
`admin`), `near_account` (the row `/near/verify` resolves first), and the
`account` provider row — so first wallet sign-in finds the pre-provisioned
admin user instead of minting a second user. Multi-segment accounts (whose
sign-in email is unpredictable) are linked by the `near_account` row, not the
email.

## Production: supported, never implicit

Production seeding never happens as a side effect of boot or deploy. Run it
explicitly:

```bash
bos seed --env production
```

Requirements, all enforced:

- **Postgres only** — every workspace `*_DATABASE_URL` that the phase would
  touch must be a `postgres://` URL (a pglite dev database is refused).
- **Env-provided owner credentials** — when `seed.auth.ownerAdmin` is
  declared, the owner identity must come from the environment, never the
  authored config: set `SEED_OWNER_ADMIN_NEAR_ACCOUNT` and/or
  `SEED_OWNER_ADMIN_EMAIL`.
- **Confirmation** — the CLI asks before writing; `--yes` skips the prompt in
  scripts.
- **Same marker semantics** — re-deploys don't re-seed; bump `seed.version`
  (or pass `--force`) to re-run.

The published config never carries the seed block — steps are
workspace-relative paths meaningful only in the repo that declares them, and
production reads the authored config locally via `bos seed`.
