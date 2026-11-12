# 0045 — Per-workspace migration journals

Date: 2026-11-08 · Status: accepted

## Context

The namespace model (ADR 0033) scopes workspace *data* — a physical database
for auth, a `plugin_<slug>` schema on the shared API database for plugins —
but the migration journal stayed one global table per database:
`drizzle.__drizzle_migrations`. Every workspace on a shared database wrote
its migration hashes into the same rows, distinguished by nothing. The slug
was resolved everywhere (`getMigrationStorage(slug)`, drizzle-kit configs,
CLI bindings) and then discarded at the table-name step — kept only for log
lines.

That made the invariant "every row in my journal is mine" false by
construction. #811 shipped an ahead-of-build guard that asserted it: any
journal row the build doesn't know means a *newer* build migrated the
database, so boot must fail closed (protecting against silently writing on
top of an unseen schema — issues #803/#804/#805). On a shared journal the
guard fired 100% of the time: every workspace saw its siblings' rows as
unknown, and all five shared-DB workspaces (api, proposals, votes, template,
agent-connect) refused to boot on every deploy — the guard also crashed
before failing cleanly, because node-postgres delivers the journal's
`bigint created_at` as a string and `new Date("1730…").toISOString()`
throws `RangeError: Invalid time value`.

An interim patch (same release) downgraded the guard to advisory, which
restored boot but left #805's hazard unguarded everywhere.

## Decision

- **The journal's identity follows the workspace's identity** — the same
  rule the data model already follows. `getMigrationStorage` resolves
  `drizzle.__drizzle_migrations_<slug>` by default (the long-planned
  "phase 2" flag flip, `PER_PLUGIN_ISOLATION`). Every journal consumer
  already routed through that resolver — `databaseLayer`, drizzle-kit config
  generation, CLI bindings — so the flip changes what it returns, not a
  single caller.
- **One-time boot adoption** moves history out of the shared journal: when a
  workspace's per-workspace journal is empty/absent and the legacy shared
  journal has rows, `runMigrations` copies the rows whose hashes *this build
  knows* — attribution by construction; a workspace can only ever claim its
  own migrations. Adoption runs under the workspace's journal-scoped
  advisory lock (concurrent boots serialize; the loser sees a non-empty
  journal and skips), tolerates duplicate DDL, and is idempotent.
- **The legacy shared table is never modified.** It becomes a frozen relic
  the adoption path reads. This keeps rollbacks sound: a pre-ADR build
  reading the legacy journal still finds its history there and applies
  nothing.
- **The ahead-of-build guard is restored, fail-closed, and now sound**: any
  unknown row in the *workspace's own* journal genuinely means a newer build
  migrated that database. `BOS_ALLOW_SCHEMA_AHEAD=1` remains the explicit
  once-only operational override for rollback windows where the database is
  ahead of the image.
- **The advisory-lock coordinate is workspace-scoped** everywhere it is
  taken — the migration runner and the driver's `CREATE SCHEMA` guard now
  use `<journal-schema>.<journal-table>` for the workspace's own journal.
  Cross-workspace boot no longer serializes on one lock (workspaces touch
  disjoint schemas; the pg_catalog race ADR 0019 addressed needs same-name
  objects), and same-workspace concurrency still serializes — more precise
  than the shared lock, not less. Duplicate-DDL tolerance stays as
  defense-in-depth for non-participants (drizzle-kit).
- **`created_at` is coerced at the read seam** (`string | number → finite
  number, else null`): node-postgres delivers int8 as a string, and every
  consumer of journal timestamps formats them.

## Consequences

- Zero interface change for plugin authors: `databaseLayer(tag, url, {
  pluginId, schema, migrations, namespace })` is untouched; every workspace
  in every child repo inherits correct journal semantics on its next
  framework bump.
- A rollback to a pre-ADR image after a post-ADR deploy works: the old
  build reads the legacy journal, finds its rows, applies nothing. A
  pre-ADR build that *applies a new migration* during a rollback window
  writes it to the legacy journal; the next post-ADR boot re-applies it
  into the per-workspace journal — the duplicate-DDL preflight records it
  as applied without replaying DDL.
- Known edge: `normalizeSlug` maps `foo` and `foo-plugin` to the same slug,
  so such a pair would share one journal and trip the guard (fail-closed —
  the safe direction). `bos db doctor` can surface the collision; not
  automated here.
- Supersedes ADR 0019's shared-journal serialization assumption: the
  journal-scoped lock remains, but its scope is the workspace's own journal.
