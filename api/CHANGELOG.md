# api

## 1.1.0-rc.0

### Minor Changes

- d57b8f4: Hydrate and paginate admin lists, batch node summary counts, resolve organization links, add signed-in Things navigation, and restore the Thing event stream.
- ## d57b8f4: Child bundle storage (ADR 0020): `POST /api/storage/bundles` uploads workspace dists to the platform storage (session or API-key auth, account-pinned, path allowlist, traversal rejection, 64 MB ceiling, server-side SRI) backed by an S3-compatible client (R2 in production via `BOS_STORAGE_*`, in-memory fallback). `bos publish` gains the CDN deploy path: with the CDN origin resolved (env or the base's inherited bundle URLs), dists upload in batched requests and every bundle URL (root's own included) points at the CDN origin with integrity fields; the credential rides the `bos login` session or `BOS_STORAGE_API_KEY`.
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

- d57b8f4: Consolidated `bos deploy` — one command runs the full train, and `bos publish` is config-only (ADR 0020/0021).

  **`everything-dev` (breaking):**

  - `bos deploy` is the full train: preflight (config → auth guards → signing → storage/CDN credentials → registry reachability, all before any build) → staleness-checked build train → bundle upload to the R2-backed storage → FastKV publish with read-back confirmation → `runtime` image build pushed to GHCR by short-SHA and `latest` tags (image name: `ci.image` in `bos.config.json`, `BOS_IMAGE` env, or derived from `repository`) → pull-only Railway deploy pinned to the pushed digest via a generated thin `FROM <image>@sha256:<digest>` Dockerfile in `.bos/deploy/` (`RAILWAY_DOCKERFILE_PATH`). Missing legs (no `ci.image`, no docker, no `RAILWAY_TOKEN`) degrade gracefully with a notice — child repos get build+upload+publish only.
  - `bos publish` no longer builds or uploads — it re-publishes the current `bos.config.json` and confirms the read-back. The `--deploy` and `--packages` options are removed (`bos build --deploy` is gone too); use `bos deploy`.
  - `DeployResultSchema` replaces the required `redeployed` boolean with optional `image`/`service`; the deploy command's `railway redeploy` branch (which re-deployed the _old_ image) is deleted.
  - Storage-mode disclosure: the bundle upload response carries `storage: "s3" | "memory"`; `bos deploy` hard-fails when the receiving instance only has in-memory storage (bytes would be lost on restart).
  - Scaffolded children get `"deploy": "bos deploy"` and single-command deploy/staging workflow templates.

  **`api`:** `POST /api/storage/bundles` responses include `storage: "s3" | "memory"` reflecting the resolved bundle-storage backend.

- d57b8f4: Tenant creation on the admin dashboard now requires connecting a sputnik-dao account via the Trezu wallet (separate from the existing SIWN session wallet). The connected DAO account owns the new tenant: `tenants.accountId` is the DAO, `bos.config.json` is published at `bos://<dao>/<gateway>` and inherits the platform base. The API gains `requireAdmin` + a server-side `get_policy` view call that confirms the session user's primary NEAR account appears in an explicit DAO policy group before accepting the create. `tenants.owner_kind` (default `platform`) is added to flag DAO-owned rows and to gate the DAO-aware republish flow.

  The platform subaccount flow (`siwn.subAccount.*`, `NEAR_SUB_ACCOUNT_PARENT_KEY_*`) is removed. Existing tenants created before this update keep working — the host is account-agnostic — but the admin wizard is now DAO-only.

- d57b8f4: Per-community dashboard bulletin. Community managers can author a short markdown announcement (Events & profile → Bulletin tab) that renders as a bluish bulletin card at the top of the main dashboard and the community overview page, with an UnderConstruction footer linking to the repository. Stored on the node's existing `metadata` jsonb (`bulletin` key) — no migration. Adds a merge-safe `PUT /nodes/{nodeId}/bulletin` route (same team-area + org-ownership gate as `updateNode`) that reads-modifies-writes metadata so other keys like `poolAccountId` are never clobbered. `Markdown` gains a `variant?: "default" | "compact"` prop with compact prose styling for card-sized content.
- d57b8f4: Event-linked Onboarding Codes, Organizers and a station view:

  - Onboarding Codes are tied to a Node Event. `createOnboardingCode` now requires `eventId` and `eventName` (a display snapshot) and takes an optional `expiresAt` in place of `expiresInHours`; codes for the same event share one Event Team, two events with the same title get separate teams, and renaming a team doesn't affect lookup. The raw code is stored encrypted at rest (HKDF-SHA256 → AES-256-GCM from `BETTER_AUTH_SECRET`) beside its hash. Migration `0007_onboarding_code_event` adds `event_id` and `encrypted_code`.
  - New API route `createEventOnboardingCode({ eventId, maxUses?, expiresAt? })` loads the Node Event, refuses non-event activities, nodes whose tenant has no organization, and organizations other than the caller's active one, then creates the code through the auth plugin in-process with a default expiry of event end + 48h.
  - Organizers — organization owners, admins, or members of a Team granted the new `events` Feature Area — can create, list and revoke codes and open a station. New auth procedure `getOnboardingStation` returns the decrypted code for an active code to an Organizer of its organization.
  - Redeeming a code sets the active organization only and no longer switches the Active Team. At the organization membership limit, redemption fails with "This organization is full". The limit is configurable through the auth plugin's `organizationMembershipLimit` variable (citynode sets 1000). `getOnboardingCodeInfo` reports `usedUp`.
  - UI: event rows in the activity editor get "Start onboarding", which opens a fullscreen station at `/onboarding/station/$codeId` (large QR on the Gateway Origin, live joined count, recent joiners), reopenable from the org Onboard tab for any active code. The free-text event name form is removed, and the onboarding page explains used-up codes.
  - UI: the activity editor lists events on a date timeline with Upcoming (default) and Past tabs and per-tab counts. Days get a sticky header in the viewer's timezone (year shown outside the current year), and cards show the start time with the event-local time when the event is in another offset, the organizer, venue, status badges and the existing actions. Posts keep the flat list.

- d57b8f4: Fix the tenant publish plane: the apps plugin no longer overrides the registry namespace, so tenant config publishes (including DAO-owned tenants via the Trezu flow) now target the global `dev.everything.near` registry that `bos://` resolution and the host's tenant loader actually read. Previously the wizard wrote configs into a project-local FastKV trie that the host could never resolve.

  Tenant discovery moves to the project database: a new public `GET /tenants/apps` route lists active tenants with their primary hostname and attached geographic node, and the landing-page directory is now powered by it (rows link via their stored binding hostname instead of deriving `slug.gateway`). The wizard's publish re-check reuses the shared `buildRegistryConfigUrl` helper, and a pinned test guards the publish contract against future namespace drift.

- d57b8f4: User-owned tenant spawning plus dev passkeys on localhost.

  **api**

  - New `spawnTenant` route (`POST /tenants/spawn`): session-gated — creates a tenant owned by the signed-in user's linked NEAR account (wallet or passkey-derived `0s…`) with the given hostname as its verified-or-pending primary binding, in one transaction. Returns the tenant, binding, owner account, and a `publishStatus` of `pending_funding` (passkey-derived owner) or `ready`.
  - New `getSpawnStatus` route (`GET /tenants/spawn/{tenantId}`) for owner-scoped spawn polling.
  - `tenants.owner_user_id` column (migration included); `ownerKind` gains `"user"`; `authorizedTenant` authorizes user-owned tenants for their owner; `listTenants` returns a user's owned tenants without requiring an active organization.
  - Bindings whose hostname falls under a configured gateway zone are verified automatically (the platform owns that DNS; TXT verification stays for tenant-brought custom domains). Configure via the new `gatewayDomains` api variable (comma-separated).
  - The `requireOrganization` gate on `listTenants` is gone for organization-less users, who now get their personal tenant list instead of `FORBIDDEN`.

  **@everything-dev/auth-plugin**

  - Passkey RP ID resolves to the local hostname when the auth origin is `localhost`/`127.0.0.1` (dev), so passkey creation and assertion work in local development; production keeps the configured `passkey.rpID`. Override with `PASSKEY_RPID`.

- d57b8f4: Add authenticated in-app node applications, atomic administrator provisioning for approved node proposals, and typed proposal application dispatch for node and template resources.
- d57b8f4: Add geographic node discovery with published profiles, manual events, Luma calendar imports and social updates, activity filters, growth curation and moderation, and anonymous aggregate engagement reporting.
- d57b8f4: Add platform-admin node management with filtering, metadata editing, validator controls, and tenant domain bindings. Verify custom-domain ownership using DNS TXT records, scope verification and removal to the binding's tenant, and resolve verified custom hostnames without appending the platform gateway.
- d57b8f4: Generalize the node model beyond geography. The `nodes.kind` column and its `country`/`state`/`city` enum are gone — the kind label now lives in `nodes.metadata.kind` (geo specifics become plain metadata), `parentId` is the only hierarchy axis, and `nodes.tenantId` is nullable so standalone org/user/zone-root nodes can exist without a tenant. New org-scoped `spawnNode` route (`POST /nodes/spawn`) creates nodes of any kind under any parent with no kind-validated parentage or depth limit; `applyNodeProposal` keeps the strict geo ladder as the DAO provisioning path; the validator staking walk and `listTenantApps` are unchanged (already `parent_id`-driven) and now carry nullable, open-ended kind labels. UI kind displays fall back to a generic "Community" label for non-geo kinds, and standalone nodes can only be mutated by platform admins.
- d57b8f4: Rework the node lifecycle prototype at `/prototype-staking-poc` to mirror the real on-chain deployment flow. Twelve stations across five phases — initialize (apply, admin approve + pool assignment, admin funds the team treasury), bootstrap (publish the tenant config, stake 1 NEAR into the team-owned pool, House of Stake setup via veNEAR registration + lockup deploy + lock-all), an optional sponsor phase for the endowment (lock its NEAR, stake the pool from its lockup, delegate all its veNEAR to the team — skipped when team and endowment are one account, never blocking the team's track), the team's House of Stake vote, and a refresh phase that unwinds both sides.

  Ordering is now declarative: each station lists exactly the chain facts it requires, replacing the implicit upstream walk — the bootstrap stations run in any order and a wrong requirement-blocker no longer gets overwritten. Steps carry their attached deposits, so the admin "Fund the team treasury" action computes `max(4 NEAR, remaining requirement + 1 NEAR buffer)` and the page shows the live treasury balance against the derived requirement. The vote deposit is corrected to `vote.dao`'s configured `vote_storage_fee` (0.00125 NEAR) instead of a hard-coded 5 NEAR, sensing proposals (status `Created`) are listed as votable, and a publish proposal that reports failed on trezu is treated as expected — the config-live FastKV check is the source of truth.

  The prototype's inputs move to TanStack Form with per-organization localStorage persistence, so a refresh restores the draft; the staking pool is prefilled from the admin-assigned default staking validator. `applyNodeProposal` now accepts an optional `poolAccountId` and persists it as the node's default staking validator plus node metadata at approval time.

### Patch Changes

- d57b8f4: Build output hardening for the platform deploy path.

  - Show all stdout during deploy builds (not just chunks matching a provider regex). Chunks can split across boundaries so a filtered URL never matched — deploy builds now pass all stdout through unconditionally.
  - Extract build-result classification as a pure function from the build attempt, making the exit-code classification testable without spawning processes.
  - Fix variable shadowing where inner `const result` shadowed the outer `await run(...)` binding.
  - Remove the unnecessary per-workspace env copy.

- d57b8f4: Reject cyclic City Node reparenting, bound recursive hierarchy reads when existing records contain cycles, and preserve the current default validator when a replacement write fails.
- d57b8f4: Fix host crash after login caused by a pg-pool search_path race.

  - The `on("connect")` handler in `api/src/db/index.ts` and `plugins/_template/src/db/index.ts` ran `CREATE SCHEMA` and `SET search_path` concurrently with the first query on each fresh connection. pg-pool does not await `on("connect")`, so after idle connections closed (30s timeout) the next query (e.g. `listRootNodes`) could land before `SET search_path`, hitting `relation "nodes" does not exist` in the `public` schema. The concurrent `client.query()` calls also produced `Connection terminated` errors (the deprecation warnings at startup were the same root cause).
  - Set `search_path` at the protocol level via the pool's `options` config (`-c search_path=<schema>,public`) so every connection has it before any query. Move `CREATE SCHEMA IF NOT EXISTS` to a one-time `pool.connect()` call before returning the driver, eliminating the race entirely.
  - Add `uncaughtException` and `unhandledRejection` handlers in `host/src/program.ts` so a dropped DB connection logs an error instead of killing the host process (which cascaded to SIGTERM of all dev services).
  - Fix Docker healthcheck to specify the correct database (`pg_isready -U everythingdev -d api_db` / `-d auth_db`), eliminating the `FATAL: database "everythingdev" does not exist` log spam every 3s.
  - Harden `bos db:studio` local path to pass the resolved `*_DATABASE_URL` explicitly to the spawned drizzle-kit process, fixing the `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` error when dotenv `override: false` left a stale empty shell env value in place.

- d57b8f4: Add the organization-scoped My Node dashboard with node selection, structure and validator statistics, staking resolution, node proposals, and role-aware review actions. Add tenant filtering to `listNodes` so the dashboard resolves only nodes managed by the active organization. Refresh session data after organization switches so the dashboard immediately follows the selected organization.
- d57b8f4: Expose public node subtree and summary routes with validator counts and staking resolution.
- d57b8f4: Require platform-admin approval for self-service organizations, expose pending and rejected request status, and prevent unapproved organizations from being activated or linked to tenants. Personal signup organizations remain active.

  Block direct member additions before approval and preserve shared organizations when the original requester's account is removed.

  Enforce organization approval through shared authorization middleware and infer organization status in the UI from the auth API contract.

- d57b8f4: Pin the node lifecycle prototype to the organization: the node slug is now the active organization's slug (read-only), the team wallet is the DAO linked to the organization via the new inline connect-and-link flow (`linkDao`), and form state resets when the organization changes. Conflict preflights against `resolveTenant` (by DAO) and `resolveTenantByOrgId` turn the previous mid-run 409s into upfront blockers, and an org that already owns its node resumes instead of failing. A Refresh phase can unwind the endowment's stake and delegation (unstake, withdraw, release pool, clear delegations), admins get a cleanup panel that rejects superseded node applications (the proposals plugin now allows rejecting approved proposals that were never applied, and the prototype records apply failures via `markApplyFailed`), the misleading "add members on trezu" hint only renders on DAO-membership blockers, and organization creation gains live slug availability checking with a shared `suggestAvailableSlug` numeric-suffix helper. The apply/provision paths drop the platform audit-seat enforcement and the DAO-membership rejection now names the missing member and links to the DAO's Trezu members page.
- d57b8f4: Consolidate the migration runner and DB driver into `everything-dev/db` (advisor plan 008).

  **Root-cause fix for the boot race** (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"` on `drizzle.__drizzle_migrations` when plugins booted concurrently against one shared database): `ensureMigrationTable`'s retry used `Effect.retry(..., until: isRetryableMigrationError)` — in Effect, `until` means _stop_ retrying when the predicate is true, so the race error the retry was built to absorb got zero retries (verified: 1 attempt with `until`, 4 with `while`). The shared runner now uses `while: isRetryableMigrationError`. `plugins/auth` had no retry at all and now inherits the shared one.

  **Shared runner** (`everything-dev/db`): `runMigrations(db, migrations, opts) => Effect<MigrationReport, DatabaseError>` with SAVEPOINT/ROLLBACK/RELEASE duplicate-DDL tolerance (fixes the proposals/votes bare-`continue` 25P02 aborted-transaction bug — the fix previously lived only in api and never propagated), retryable-SQLSTATE journal-init backoff, hash-tracked idempotence, and the duplicate-table preflight. `detectDrift`/`loadMigrations`/`loadMigrationsFromDisk` move with it; `loadMigrations` takes the bundler's virtual-module loader as an option so the shared package never names `virtual:drizzle-migrations.sql`.

  **Shared driver** (`everything-dev/db`): `createDatabaseDriver(url, schema, namespace?)` — engine by URL scheme (`pglite:`/`:memory:` → PGlite, else postgres), protocol-level `search_path`, **one-time** `CREATE SCHEMA` via `pool.connect()` (replaces votes/proposals' per-connection `on("connect")` handler that re-raced `CREATE SCHEMA IF NOT EXISTS` on every connection), env-driven pool config (`DB_POOL_MAX` etc.), idempotent close (drops auth's `pool.end()` stack-trace noise). Plus `pluginSchemaName(pluginId)` and a single shared `DatabaseError`.

  **Workspaces**: api/votes/proposals/auth `db/migrate.ts` and `db/index.ts` become thin sync-propagated adapters (< 40 lines; `bos sync` copies api's canonical copies verbatim into plugins). `plugins/_template` aligns fully to the standard flow: `migrator.ts` deleted (renamed to `migrate.ts`), canonical layer adopted, journal standardized to `drizzle.__drizzle_migrations` (pre-existing tables are auto-recorded by the preflight; the old in-schema `drizzle_migrations` table is frozen, matching 017/D6), and the `TemplateDatabase` alias is dropped. `adoptPublicTables` is deliberately **not** ported: it was a one-time boot-time `ALTER TABLE ... SET SCHEMA` relocation for pre-schema-isolation databases (live dev DB has zero `public` tables); legacy adoption stays with the fail-closed `detectDrift`/`bos db doctor` path, never boot-time magic.

  **Drivers stay excluded from the bundle graph**: the shared driver dynamic-imports engines (`pg`, `@electric-sql/pglite`, `drizzle-orm/*`) via bare specifiers, and everything-dev's tsdown config adds them to `deps.neverBundle`. This matters beyond hygiene: tsdown's unbundle mode otherwise rewrites dynamic imports into relative paths into its vendored `dist/node_modules/` copies, which (a) defeats rspack's `externals: ["pg", "@electric-sql/pglite"]` (externals match bare requests only), dragging pglite's `pglite.wasm`/`pglite.data`/`initdb.wasm` binaries into the MF dev bundles where they fail to resolve or parse as JS, and (b) makes node resolve `drizzle-orm` from the vendored `dist/node_modules/drizzle-orm` (nearest node_modules wins) whose copied layout breaks ESM resolution in the host process. Every workspace with a database already declares `@electric-sql/pglite` + `drizzle-orm` as its own dependencies, so bare runtime imports resolve everywhere — dev, prod MF bundles (via rspack externals), and `bos init` scaffolds.

  Regression suite added at `packages/everything-dev/tests/unit/db-run-migrations.test.ts`: fresh-schema, partial-overlap savepoint path (previously failed on proposals/votes with 25P02), duplicate-preflight journal recording, and a retry-semantics test pinning 3+ gen-runs on `23505`.

- d57b8f4: Scope the stake directory to the signed-in user's active organization or connected organization memberships, while preserving the full public directory for anonymous visitors.
- d57b8f4: - Public node page `/n/$slug` now shows live stake stats (total staked, fee, pool accounts, and a ranked sample of up to 50 accounts) per resolved validator, including inherited staking pools.
  - Keep stake links, show loading and unavailable states, and link to network-specific explorers.
  - Resolve child-node overview URLs and keep child navigation within the overview. Parent-scoped links distinguish duplicate city slugs; unscoped lookup preserves root URLs and avoids selecting an arbitrary duplicate child.
  - Preserve the selected node ID when entering staking and returning from sign-in.
- d57b8f4: Per-PUT retry and 4-way concurrency for bundle storage; storage timeout hint fires for all 408s.

  - **Per-object retry** (`api`): `aws4fetch` signs and sends but never retries — one keep-alive reset over a slow uplink killed entire multi-hundred-file bundle batches (`fetch failed` mid-sequence, after earlier files had already PUT successfully). `S3StorageClient.put/get` now run through a retry helper (3 attempts, 250ms/500ms backoff) that retries transient failures — network errors (undici's `fetch failed`, with the `cause` code surfaced, e.g. `fetch failed (ECONNRESET)`) and 429/5xx responses — and fails fast on definitive rejections (401/403) with the R2 response body included.
  - **4-way PUT concurrency** (`api`): the storage route uploads files through `Effect.forEach(..., { concurrency: 4 })` instead of sequentially — 736 sequential round-trips were minutes of pure latency.
  - **Timeout hint** (`everything-dev`): the `BOS_STORAGE_UPLOAD_TIMEOUT_MS` hint now fires for the storage route's own 408 body ("Bundle upload timed out"), not just the general API timeout's "Request timeout".
  - **Env docs**: `.env.example` regains the ADR 0020 storage section (BOS*STORAGE*\* / CDN deploy vars) plus the new `BOS_STORAGE_UPLOAD_TIMEOUT_MS`.

- d57b8f4: Bind wallet invitations to their NEAR network, guard invitation status transitions, and align wallet membership limits with email invitations. Refresh workspace state after team changes and invitation acceptance, and defer membership loading until the Teams tab is opened.

  Existing wallet invitations without a network must be reissued; email invitations are unaffected.

- d57b8f4: Complete organization teams and wallet invitations across the auth plugin, API, and dashboard. Team workspaces now carry feature-area context through node mutation authorization, and organization owners can invite either an email address or a NEAR account, target a team, and manage wallet-aware pending invitations. Invitees can accept email or wallet invitations from the dashboard or claim link and land in the targeted workspace.
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [95261fe]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [9191ab3]
- Updated dependencies [4d8efd1]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f9d2dce]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [784fcad]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f5f1a5f]
- Updated dependencies [d57b8f4]
- Updated dependencies [c23dfb6]
- Updated dependencies [ed70808]
- Updated dependencies [8a06f6b]
- Updated dependencies [f9d2dce]
- Updated dependencies [f9d2dce]
- Updated dependencies [9191ab3]
  - every-plugin@3.0.0-rc.0
