---
title: "07 · Data"
description: The database seam — one call gives a plugin a migrated, namespaced, schema-isolated database; PGlite locally, Postgres in production; migrations that serialize and refuse to run blind.
order: 70
tags:
  - book
---

# 07 · Data

Storage is one framework call, one local database engine, and one migration protocol.
A plugin declares what only it can know — its schema, its migrations, its identity —
and the framework supplies everything else.

## The seam

```ts
export const DatabaseLive = (config) =>
  databaseLayer(DatabaseTag, config.secrets.VOTES_DATABASE_URL, {
    pluginId: config.pluginId,
    schema,
    migrations: loadMigrations,
  });
```

One call acquires the driver, applies pending migrations under a lock, detects drift,
and provides the typed database on the plugin's own tag. The tag is the swap point:
the same interface accepts a fake in tests, a hand-built Layer for a different Drizzle
setup, or an entirely different store. `namespace` defaults to an isolated
`plugin_<slug>` schema; the API shell passes `false` for a database of its own.
([ADR 0033](../adr/0033-database-seam.md))

Each workspace's connection string is its own secret, conventionally
`<NAME>_DATABASE_URL`. On Postgres a plugin's secret may fall back to
`API_DATABASE_URL` and share the API's database, isolated by schema.

## One engine locally, another in production

| Environment | Engine | Why |
|---|---|---|
| Development | **PGlite** — Postgres compiled to WASM, running in process | No server, no port, no container; nothing to start or collide |
| Tests | PGlite in memory | Fast and disposable |
| Production, shared servers | Postgres (`postgres://`) | Real connections, real concurrency |

A zero-config checkout needs no `.env`. Each workspace persists to its own directory,
`.bos/db/<slug>`, so two projects — or forty — never contend for a port and never
share a file.

**One directory, one instance.** PGlite keeps a private buffer cache and does not
coordinate across instances; two instances on one directory corrupt it silently. The
driver refuses a second open, and `bos dev` preflight refuses any setup where two
services resolve to the same directory. Cross-process access, such as a tool reading
while a dev stack runs, queues on PGlite's own file lock.
([ADR 0038](../adr/0038-pglite-only-local-db.md),
[ADR 0044](../adr/0044-per-identity-pglite-data-dirs.md))

Cross-workspace data goes through `pluginsClient`, never through another plugin's
schema — the only coordination that works on an embedded engine.

## Migrations

Migrations apply automatically at boot. The protocol has three properties:

- **Serialized.** The whole run is one transaction whose first statement takes an
  advisory lock scoped to the workspace's journal. Concurrent boots — a plugin's dev
  server and the host loading it in process — cannot race each other, and a crashed
  migrator cannot orphan the lock.
- **Journaled per workspace.** Each workspace owns `drizzle.__drizzle_migrations_<slug>`.
  Every row in a journal belongs to the workspace that reads it.
- **Refuses to run blind.** A row the running build does not recognize means a newer
  build has migrated this database. Boot fails closed rather than write over a schema
  it cannot see. `BOS_ALLOW_SCHEMA_AHEAD=1` is the explicit, once-only override for a
  rollback window.

`drizzle-kit` commands — `db:push`, `db:studio`, `db:migrate` — do not take the lock
and need a real `postgres://` URL; PGlite is a runtime-driver concern only.
([ADR 0019](../adr/0019-migration-serialization-advisory-lock.md),
[ADR 0045](../adr/0045-per-workspace-migration-journals.md))

## Check it

- `ls .bos/db` — one directory per workspace that stores data.
- `bos db doctor` — journal and schema state.
- `bos status` — the project's health check.

## Further reading

- ADRs [0033](../adr/0033-database-seam.md) (the seam), [0038](../adr/0038-pglite-only-local-db.md) and [0044](../adr/0044-per-identity-pglite-data-dirs.md) (PGlite), [0019](../adr/0019-migration-serialization-advisory-lock.md) and [0045](../adr/0045-per-workspace-migration-journals.md) (migrations).
- The [`everything-dev#plugin-development`](../../packages/everything-dev/skills/plugin-development/SKILL.md) skill — database setup in a new plugin.
- Next: [08 · Identity](08-identity.md).
