# @everything-dev/auth-plugin

## 1.2.0

### Minor Changes

- 2b542ae: Clean up PostgreSQL migration artifacts and tighten type safety.

  ### Auth Plugin

  - Remove stale `types/db/layer.d.ts` (source file was deleted in the PostgreSQL migration).
  - Replace `any` in Drizzle query callbacks with inferred types (`auth-instance.ts`, `index.ts`).
  - Tighten `AuthDatabase` type from `PgDatabase<any, ...>` to `PgDatabase<PgQueryResultHKT, ...>`.
  - Add `.gitignore` for local pglite artifacts (`auth-local.db`, `test-auth.db`).
  - Add `githubClientId` and `githubClientSecret` optional dev defaults to `plugin.dev.ts`.
  - Update README to reflect pglite instead of libsql.

## 1.1.6

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

- Updated dependencies [a0c5784]
  - every-plugin@2.5.3

## 1.1.5

### Patch Changes

- Updated dependencies [a38288d]
  - every-plugin@2.5.2

## 1.1.4

### Patch Changes

- Updated dependencies [f185a6c]
  - every-plugin@2.5.1

## 1.1.3

### Patch Changes

- Updated dependencies [516376e]
  - every-plugin@2.5.0

## 1.1.2

### Patch Changes

- Updated dependencies [b20445f]
  - every-plugin@2.4.3

## 1.1.1

### Patch Changes

- Updated dependencies [fac9cf6]
  - every-plugin@2.4.2

## 1.1.0

### Minor Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

### Patch Changes

- Updated dependencies [0a67206]
  - every-plugin@2.4.1
