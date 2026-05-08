# @everything-dev/auth-plugin

## 1.2.6

### Patch Changes

- c5fecc9: Switch from PGlite to Docker Postgres for development, fix multi-instance WASM crash, add auto-migration and infinite scroll for projects

  The host was crashing with `RuntimeError: Aborted()` because multiple PGlite WASM instances cannot coexist in a single Node.js process. This replaces in-process PGlite with Docker Postgres for development, and adds several related fixes:

  - Add `docker-compose.yml` with 3 postgres:17-alpine services (api:5432, auth:5433, projects:5434)
  - Add `dev:postgres`, `dev:postgres:down`, `dev:postgres:reset` convenience scripts
  - Declare `API_DATABASE_URL` and `PROJECTS_DATABASE_URL` secrets in `bos.config.json` so the host injects them into plugins
  - Conditionally disable SSL for localhost connections in `createDatabaseDriver` (3 files)
  - Add auto-migration to API and projects plugins on startup (matching auth plugin's existing pattern)
  - Fix projects `listProjects` pagination: move visibility filter from JS post-filter to SQL WHERE clause, add offset-based cursor pagination
  - Add infinite scroll with IntersectionObserver to projects list UI
  - Default project visibility to `public` instead of `private`
  - Show all visible projects (public/unlisted from everyone + own private) instead of filtering to current user only
  - Fix CI: replace broken `file:./api-test.db` with postgres service container

- f3f9e64: Migrate projects and API plugins to PostgreSQL with pglite fallback, add generic upvote system with SSE live ranking, and redesign projects page as a real-time ranked leaderboard.

  ### What Changed

  **API Plugin**

  - Migrated from SQLite to PostgreSQL (`pg` production, `pglite` local fallback)
  - Added `upvotes` table with unique constraint on `(thing_id, user_id)`
  - New upvote endpoints: `upvoteThing`, `downvoteThing`, `getUpvoteCount`, `getUpvoteFeed`
  - Real-time SSE stream at `/api/upvotes/stream` with in-memory pub/sub
  - Unified database defaults to `pglite:.bos/<plugin>/:memory:`

  **Projects Plugin**

  - Migrated from SQLite/libsql to PostgreSQL (same driver pattern as auth)
  - Dropped KV store (`kvStore` table, `KvService`, and all KV routes)
  - Regenerated Drizzle schema with `pgTable` and `timestamp with time zone`
  - Unified database defaults to `pglite:.bos/projects/:memory:`

  **Auth Plugin**

  - Updated default `AUTH_DATABASE_URL` to `pglite:.bos/auth/:memory:`
  - Driver now detects `:memory:` basename for true in-memory mode

  **UI**

  - Complete redesign of projects list page
  - Full-width horizontal cards with rank numbers (`#1`, `#2`, etc.)
  - Vote stack on right (↑ count ↓)
  - Projects sorted by upvote count descending
  - Framer Motion `Reorder.Group` for smooth rank transitions
  - SSE integration pushes live vote updates that trigger re-sorting
  - Removed legacy `keys/` KV test routes and UI

  **Config**

  - Updated `.env.example` with new PostgreSQL default comments
  - Removed `keys/**` from `bos.config.json` projects plugin routes

## 1.2.5

### Patch Changes

- Updated dependencies [03bb4a0]
  - every-plugin@2.5.4

## 1.2.4

### Patch Changes

- ecb7c63: Default auth database to `:memory:` for local development

  - `plugins/auth/plugin.dev.ts`: Change `AUTH_DATABASE_URL` default from `pglite:./auth-local.db` to `:memory:`
  - `plugins/auth/src/index.ts`: Change `AUTH_DATABASE_URL` schema default from `pglite:./auth-local.db` to `:memory:`

  This eliminates PGlite filesystem initialization failures during local development. Users can still override with `AUTH_DATABASE_URL` environment variable for persistent storage.

## 1.2.3

### Patch Changes

- 6dff104: Remove artificial startup timeout, fix TCP false-positive, and auth pglite initialization

  - `packages/everything-dev/src/dev-session.ts`: Remove the hardcoded 30-second `awaitReady` timeout so the host genuinely waits until local plugins (auth, api, template) finish rspack compilation and serve their remote entry.
  - `packages/everything-dev/src/orchestrator.ts`: Remove the TCP-port fallback in `spawnDevProcess` readiness probing. A plugin is now only considered "ready" when its HTTP endpoint returns 200, eliminating false positives where rspack opens its listen port before compilation is complete.
  - `plugins/auth/src/db/driver.ts`: Add `mkdirSync(..., { recursive: true })` before initializing `@electric-sql/pglite`, fixing "PGlite failed to initialize properly" errors caused by PGlite's internal non-recursive `mkdirSync`.

## 1.2.2

### Patch Changes

- 2e79fea: Fix init config ordering, parent plugin leakage, auth pglite resolution, and plugin selection

  - `packages/everything-dev/src/cli/init.ts`: Fix `bos.config.json` key ordering so `extends` is always first and trailing group (`app`, `plugins`, `shared`) is last. Prevent parent plugin leakage by writing `"plugins": {}` instead of deleting the key when no plugins are selected.
  - `packages/everything-dev/src/cli/prompts.ts`: Remove `registry` from `AVAILABLE_PLUGINS` since `.templatekeep` only includes `plugins/_template/**`.
  - `plugins/auth/package.json`, `host/package.json`, `package.json`: Move `@electric-sql/pglite` to runtime `dependencies` so the auth plugin can resolve it when loaded remotely via Module Federation.

## 1.2.1

### Patch Changes

- fd962b6: Clean up tracked generated types and old SQLite artifacts.

  - Added `types/` to `.gitignore` to prevent generated `.d.ts` files from being tracked
  - Removed previously tracked generated type declarations from git history
  - Removed leftover `auth.db` and `test-auth-sandbox.db` SQLite files from pre-PostgreSQL migration
  - No source code changes, no functional impact

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
