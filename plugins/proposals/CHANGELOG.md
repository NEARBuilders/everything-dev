# @everything-dev/proposals-plugin

## 1.2.0-rc.0

### Minor Changes

- d57b8f4: Upgrade build toolchain to Rspack 2.2 / Rsbuild 2.2 / Module Federation 2.9

  Version catalog bumps: @rspack/core + @rspack/cli → 2.2.6, @rsbuild/core → 2.2.8,
  @rsbuild/plugin-react → 2.1.0, @module-federation/\* → latest 2.x (enhanced 2.9.0,
  node 2.7.50). @module-federation/runtime-tools and @rspack/dev-server are now
  explicit dependencies where used.

  BREAKING (every-plugin): EveryPluginDevServer removed from every-plugin/build/rspack.
  Plugin dev serving is now standalone — `every-plugin-serve` (supervised
  `rspack build --watch` + plain node:http server with the same contract: health,
  remoteEntry statics, oRPC RPC/OpenAPI, sibling composition, effect context).
  Plugin dev scripts use `every-plugin-serve` instead of `rspack serve`.
  EveryPluginBuild carries the build-side responsibilities only.

  Deploy note: `bos mf check` compares host and remote pluginVersion exactly, so
  after the 2.9.0 host deploys, remote-only plugins must be redeployed on
  Module Federation 2.9.0 to stay compatible.

### Patch Changes

- d57b8f4: Pin the node lifecycle prototype to the organization: the node slug is now the active organization's slug (read-only), the team wallet is the DAO linked to the organization via the new inline connect-and-link flow (`linkDao`), and form state resets when the organization changes. Conflict preflights against `resolveTenant` (by DAO) and `resolveTenantByOrgId` turn the previous mid-run 409s into upfront blockers, and an org that already owns its node resumes instead of failing. A Refresh phase can unwind the endowment's stake and delegation (unstake, withdraw, release pool, clear delegations), admins get a cleanup panel that rejects superseded node applications (the proposals plugin now allows rejecting approved proposals that were never applied, and the prototype records apply failures via `markApplyFailed`), the misleading "add members on trezu" hint only renders on DAO-membership blockers, and organization creation gains live slug availability checking with a shared `suggestAvailableSlug` numeric-suffix helper. The apply/provision paths drop the platform audit-seat enforcement and the DAO-membership rejection now names the missing member and links to the DAO's Trezu members page.
- d57b8f4: Consolidate the migration runner and DB driver into `everything-dev/db` (advisor plan 008).

  **Root-cause fix for the boot race** (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"` on `drizzle.__drizzle_migrations` when plugins booted concurrently against one shared database): `ensureMigrationTable`'s retry used `Effect.retry(..., until: isRetryableMigrationError)` — in Effect, `until` means _stop_ retrying when the predicate is true, so the race error the retry was built to absorb got zero retries (verified: 1 attempt with `until`, 4 with `while`). The shared runner now uses `while: isRetryableMigrationError`. `plugins/auth` had no retry at all and now inherits the shared one.

  **Shared runner** (`everything-dev/db`): `runMigrations(db, migrations, opts) => Effect<MigrationReport, DatabaseError>` with SAVEPOINT/ROLLBACK/RELEASE duplicate-DDL tolerance (fixes the proposals/votes bare-`continue` 25P02 aborted-transaction bug — the fix previously lived only in api and never propagated), retryable-SQLSTATE journal-init backoff, hash-tracked idempotence, and the duplicate-table preflight. `detectDrift`/`loadMigrations`/`loadMigrationsFromDisk` move with it; `loadMigrations` takes the bundler's virtual-module loader as an option so the shared package never names `virtual:drizzle-migrations.sql`.

  **Shared driver** (`everything-dev/db`): `createDatabaseDriver(url, schema, namespace?)` — engine by URL scheme (`pglite:`/`:memory:` → PGlite, else postgres), protocol-level `search_path`, **one-time** `CREATE SCHEMA` via `pool.connect()` (replaces votes/proposals' per-connection `on("connect")` handler that re-raced `CREATE SCHEMA IF NOT EXISTS` on every connection), env-driven pool config (`DB_POOL_MAX` etc.), idempotent close (drops auth's `pool.end()` stack-trace noise). Plus `pluginSchemaName(pluginId)` and a single shared `DatabaseError`.

  **Workspaces**: api/votes/proposals/auth `db/migrate.ts` and `db/index.ts` become thin sync-propagated adapters (< 40 lines; `bos sync` copies api's canonical copies verbatim into plugins). `plugins/_template` aligns fully to the standard flow: `migrator.ts` deleted (renamed to `migrate.ts`), canonical layer adopted, journal standardized to `drizzle.__drizzle_migrations` (pre-existing tables are auto-recorded by the preflight; the old in-schema `drizzle_migrations` table is frozen, matching 017/D6), and the `TemplateDatabase` alias is dropped. `adoptPublicTables` is deliberately **not** ported: it was a one-time boot-time `ALTER TABLE ... SET SCHEMA` relocation for pre-schema-isolation databases (live dev DB has zero `public` tables); legacy adoption stays with the fail-closed `detectDrift`/`bos db doctor` path, never boot-time magic.

  **Drivers stay excluded from the bundle graph**: the shared driver dynamic-imports engines (`pg`, `@electric-sql/pglite`, `drizzle-orm/*`) via bare specifiers, and everything-dev's tsdown config adds them to `deps.neverBundle`. This matters beyond hygiene: tsdown's unbundle mode otherwise rewrites dynamic imports into relative paths into its vendored `dist/node_modules/` copies, which (a) defeats rspack's `externals: ["pg", "@electric-sql/pglite"]` (externals match bare requests only), dragging pglite's `pglite.wasm`/`pglite.data`/`initdb.wasm` binaries into the MF dev bundles where they fail to resolve or parse as JS, and (b) makes node resolve `drizzle-orm` from the vendored `dist/node_modules/drizzle-orm` (nearest node_modules wins) whose copied layout breaks ESM resolution in the host process. Every workspace with a database already declares `@electric-sql/pglite` + `drizzle-orm` as its own dependencies, so bare runtime imports resolve everywhere — dev, prod MF bundles (via rspack externals), and `bos init` scaffolds.

  Regression suite added at `packages/everything-dev/tests/unit/db-run-migrations.test.ts`: fresh-schema, partial-overlap savepoint path (previously failed on proposals/votes with 25P02), duplicate-preflight journal recording, and a retry-semantics test pinning 3+ gen-runs on `23505`.

- d57b8f4: Proposal privacy hardening: non-admin readers no longer receive `createdBy` identities or `payload` contents from `getProposals` (both replaced with `[hidden]`/`null`), `getAuditLog` now requires a platform admin, and new audit-log rows stop falling back to the actor's email as the label. The node proposal detail page renders the payload's motivation field instead of dumping the raw payload JSON. A data migration scrubs existing email-shaped labels from `proposal_audit_log.actor_label`.
- d57b8f4: Add a forward migration that repairs legacy proposal databases before current proposal lifecycle queries and writes run.

## 1.1.0

### Minor Changes

- 06966e9: Add reusable proposals and votes plugins, move API to orchestration, and shift builder/project review flows onto proposal-backed admin moderation.

### Patch Changes

- e94dd22: Fix project creation attribution and rework the project proposal flow (#7).

  - **api**: Add a `createProject` route so projects are always created directly, owned by the logged-in user's NEAR account. Non-admins cannot create public projects directly (public visibility is clamped to private) and must have a linked NEAR account. The proposal approve callback now updates the existing project's visibility instead of recreating it, so the approving admin is never recorded as the creator; proposals for projects that don't exist yet (e.g. API-key sources) are still created and attributed to the original proposer.
  - **projects plugin**: Non-admins can no longer flip a project to public via `updateProject`; making a project public requires admin approval through a proposal.
  - **ui**: Creating a project now creates it immediately (private first) and, when public visibility is requested, submits a proposal to make it public. The edit page routes public-visibility changes through the same proposal flow. Owner attribution no longer falls back to the opaque auth user id.
  - **proposals plugin**: Re-proposing an already approved/applied proposal resets it to pending instead of erroring, so a project that went public and was later made private can be submitted for review again. Prior decisions remain in the submissions history and audit log.
  - **api**: Project proposal owners must be valid NEAR account ids — opaque auth user ids and API key ids are rejected. Removing an applied project proposal now reverts the project to private instead of deleting it.

- 974cf46: Fix proposal attribution: store NEAR wallet address as `createdBy` instead of opaque user ID, and fix project ownership when proposals are approved by admins.

  - **proposals plugin**: Prefer `walletAddress` for `actorId` so `createdBy` stores the nominator's NEAR account (e.g. `alice.near`), making "Nominated by" display as a linkable identity on the builders page.
  - **api**: Use `proposal.createdBy` as fallback for `ownerId` in the projects create callback, so approved projects are attributed to the original proposer instead of the approving admin.
  - **ui**: Always include `defaultOwnerId` in project proposal payloads so non-admin proposals carry the proposer's identity even when the ownerId field is hidden from the form.

- c801c40: Complete the reviewed NEAR Catalog claim lifecycle and public presentation for issues #54 and #55.

  - Derive manual activity identity from authentication, add trusted admin-only activity emission, make emitted events idempotent, and support hiding revoked activity from feeds and leaderboards.
  - Apply approved Catalog claims through a compensating workflow that verifies current builder and Catalog state, records a verified activity snapshot, and safely retries or rolls back partial failures.
  - Support rejected and removed claim resubmissions while preserving proposal history, and expose complete claim review, retry, rejection, and revocation controls to administrators.
  - Present claimed Catalog contributions on builder profiles, render specialized claim activity, and merge current Catalog projects into the public and personal project directories without duplicating local projects.

- c801c40: Add the approved-builder NEAR Catalog contribution proposal flow.

  - Keep Catalog proposals private to their submitter and administrators across proposal lists, counts, audit logs, and event streams.
  - Add authenticated Catalog claim proposal submission and current-builder status APIs with server-derived claimant identity, active-project validation, normalized roles, idempotent retries, and rejected-only revisions.
  - Resolve linked NEAR identity from the auth context so notification reads and streams remain authenticated.
  - Accept array-shaped Catalog tags and isolate malformed search entries without converting valid empty results into upstream errors.
  - Add URL-backed manual activity and project contribution tabs with Project contribution as the approved-builder default, Catalog project search and preview, multi-role submission, proposal status cards, rejected-proposal editing, and an owner-only builder profile CTA.

## 1.0.0

- Initial release.
