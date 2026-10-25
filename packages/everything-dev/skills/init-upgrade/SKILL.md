---
name: init-upgrade
description: bos init, bos import, and bos upgrade workflows — template download, snapshot-based conflict detection, workspace import from upstream repos with divergence reporting, platform pin movement (ADR 0034), and how init/upgrade select and own files. Use when scaffolding new projects, importing a workspace subtree from another repo, or upgrading framework packages.
metadata:
  sources: "packages/everything-dev/src/cli/init.ts,packages/everything-dev/src/services/scaffold/init-flow.ts,packages/everything-dev/src/services/scaffold/sync.ts,packages/everything-dev/src/services/scaffold/import.ts,packages/everything-dev/src/handlers/import.ts,packages/everything-dev/src/services/scaffold/upgrade.ts,packages/everything-dev/src/services/scaffold/snapshot.ts,packages/everything-dev/src/cli/commands/scaffold.ts,packages/everything-dev/src/services/resolution/merge.ts"
---

> **Config form:** the authored config is `bos.app.ts` (canonical, preferred when both exist). A legacy `bos.config.json` is still supported for older children. Where this doc says `bos.config.json` for the *local authored file*, read "the authored config". The published artifact on FastKV keeps the key name `bos.config.json`.

# bos init, import, upgrade

## bos init

Creates a new project from a published template:

```bash
bos init                                                  # Interactive
bos init -a my.near --domain my.dev --noInteractive       # Skip prompts
bos init --overrides ui,api,host                          # Include host locally
```

### Flow
1. Fetch parent config from FastKV (`bos://account/gateway`)
2. Download template tarball from parent's `repository` URL
3. Build the file list with `buildInitPatterns(overrides, plugins)`
4. Filter plugins: only included plugins + their routes are copied
5. `personalizeConfig()` — sets `extends`, `account`, `domain`, removes production URLs
6. `resolveWorkspaceRefs()` — normalizes each workspace `package.json`: rewrites `file:`/`workspace:*` refs to `catalog:`, ensures all workspace packages are listed in root `workspaces.catalog`, pins framework versions (`everything-dev`, `every-plugin`)
7. Write initial snapshot (`.bos/sync-snapshot.json`) — records file path → content hash for all template-origin files, used later by `bos upgrade` for conflict detection
8. `pnpm install` + `bos types gen`

## Shared Host + Custom Child App

Use this pattern when you want one deployed host runtime and separate descendant apps that inherit from it.

### 1. Create the base host runtime

Create the app that owns the shared host, auth, API, and base plugin list:

```bash
bos init --overrides ui,api,host
```

This base runtime is the app the host boots from.

### 2. Create the child app from the base runtime

Create a second app whose authored config extends the base runtime:

```json
{
  "extends": "bos://pingpayio.near/pingpay.io",
  "account": "pizza.pingpayio.near",
  "domain": "pizza.com"
}
```

Then customize the child-owned sections, usually:
- `account`
- `domain`
- `repository`
- `app.ui`
- `app.api.shared`
- `app.auth.shared`
- `plugins.<id>.shared`
- existing `plugins.<id>.ui`
- existing `plugins.<id>.sidebar`

This runtime is still a child in lineage because it extends the parent, but on `pizza.com` it becomes its own tenant root operationally.

### 3. Understand fixed-core tenant mode

Today the shared host stays fixed to the base runtime for:
- `app.host`
- `app.api`
- `app.auth`
- server-side plugin loading

Child apps can either run as their own base runtime on their own domain, or as request-scoped overlays on top of a shared host. In fixed-core mode, the supported shared-host overrides are:
- `app.ui`
- existing `plugins.<id>.ui`
- existing `plugins.<id>.sidebar`

Shared-host children must extend the base runtime and do not introduce new server-side plugin IDs dynamically.

### 4. Host resolution for shared-host mode

The shared host resolves descendant requests via a DB-backed binding map. It fetches tenant permissions from the API's `GET /tenants/bindings` endpoint (cached for 30s) — no env vars are needed:

Design target, for example:
- `pingpay.io` -> base runtime `bos://pingpayio.near/pingpay.io`
- `pizza.com` -> child runtime `bos://pizza.pingpayio.near/pizza.com`
- `chicago.pizza.com` -> descendant runtime `bos://chicago.pizza.pingpayio.near/pizza.com`

Current implementation note:
- shared-host fixed-core mode still applies one tenant overlay on top of a process-wide base runtime
- nested label routing and account-relative tenant derivation are the intended architecture direction for upcoming work

Use the `extends-config` skill when reasoning about how the tenant config merges with the base runtime.

### Init File Selection

`buildInitPatterns(overrides, plugins)` chooses what init copies from the template source:
- Scaffold runtime files (bos.app.ts, bos.dev.ts, package.json, biome.json, rsbuild configs)
- UI structure (routes/__root.tsx, components/index.ts, providers, hooks, lib)
- API structure (contract.ts, index.ts, db/, drizzle.config.ts)
- Selected plugin workspaces (`plugins/<selected-plugin>/**`)
- GitHub workflows (`.github/templates/**` → `.github/`)

### Upgrade Ownership Model

`bos upgrade` uses the init snapshot plus the ownership inventory (`src/services/scaffold/ownership.ts` — `FRAMEWORK_OWNED_SYNC_FILES`, the per-plugin predicate, `AGENT_SYNC_GLOBS`; ADR 0032) to decide what it may overwrite.

Framework-owned files are updated when the template changes — build configs, shared runtime wiring, `drizzle.config.ts` (journal policy), agent-skill content. App-owned files are never considered, for example:
- `ui/src/components/**`
- `ui/src/routes/**`
- `ui/src/router.tsx`, `ui/src/app.ts`
- `api/src/contract.ts`
- `api/src/index.ts`
- `api/src/db/**` — the database seam (ADR 0033): the seam file layer, the schema, and the migrations are the app's, free to swap
- `plugins/*/src/lib/context.ts` — the plugin's request-context schema

Generated files are regenerated separately and are not the source of truth for upgrade decisions.

**Editing framework-owned files is allowed** (ADR 0032): when the template later changes, the template version is applied and your copy is backed up under `.bos/sync-backup/`. To make a local change permanent, file an issue at https://github.com/NEARBuilders/everything-dev/issues — the framework team implements it upstream and ships it in package versions.

### Porting the vendored db trio (ADR 0033 prompt)

Children scaffolded before ADR 0033 carry the old sync-owned `src/db/{index,layer,migrate}.ts` trio (~180 lines). Sync no longer manages those paths and the old copies keep working — but hand an agent this prompt to port a workspace to the shrunk seam:

```text
Port <workspace> to the ADR 0033 database seam:
1. Replace <workspace>/src/db/{index,layer,migrate}.ts with a single ~15-line
   src/db/layer.ts: declare `DatabaseTag` (Context.Service, id "<pluginId>/Database",
   shape PgDatabase<PgQueryResultHKT, typeof schema>), the `Database` type alias,
   a workspace-bound `loadMigrations` (loadMigrations from "everything-dev/db"
   with fromDir: import.meta.dirname and virtual: () => import("virtual:drizzle-migrations.sql")),
   and `DatabaseLive(config: { pluginId: string; secrets: { <SLUG>_DATABASE_URL: string } })`
   calling `databaseLayer(DatabaseTag, config.secrets.<SLUG>_DATABASE_URL,
   { pluginId: config.pluginId, schema, migrations: loadMigrations, namespace: <true|false> })`.
   namespace: false only for the api shell (public schema) and auth (dedicated database).
2. Keep src/db/schema.ts, src/db/migrations/, and drizzle.config.ts untouched.
3. Re-point `type { Database } from "./db"` imports to "./db/layer"; import
   DatabaseError/unwrapDatabaseError from "everything-dev/db" directly.
4. `DatabaseLive(config)` now takes the initialize input (pluginId + secrets) —
   update the plugin's initialize call site.
5. In tests, drop any `Layer.succeed(PluginIdTag, ...)` provision for the db layer;
   provide fakes with `Layer.succeed(DatabaseTag, fakeDb)` instead.
6. Run the workspace's test suite and `pnpm run typecheck`.
```

## bos upgrade

Children are **pinned snapshots** (ADR 0034): init derives the child's `platform` field from the parent's resolved platform release manifest, the authored config records it, and only `bos upgrade` moves it. There is no `bos sync` — everyday work never touches framework-owned files.

```bash
bos upgrade              # Re-pin to the parent's latest release + reconcile the template
bos upgrade --dry-run    # Preview version bumps
bos upgrade --check      # Manual drift alarm (ADR 0034): exit 1 when updates are available
```

### Flow
1. Resolve the platform release manifest through the extends chain (unpinned — the upgrade itself is the pathway that moves the pin). When one resolves, its catalog is the version source (one registry read)
2. Stamp the new `platform` pin in the authored config (restores a missing pin too — e.g. a child scaffolded with `--source`)
3. Bump the root `package.json` catalog + all workspace refs to `catalog:`, then `pnpm install` + `bos types gen`
4. **Pre-flight:** run the staged template sync as a dry-run first — any conflict between a child hand-edit and a template change aborts the whole run, listing the conflicted files and the upstream-issue URL
5. Run the real sync, migrate the root package manifest, reconcile shared deps, and re-exec the remaining migration phases with `--from <previousVersion>` (internal)

### Snapshot-based conflict detection

Uses `.bos/sync-snapshot.json` (written by init/import/upgrade) to track which files came from the template and their hashes:

| Local state | Template changed? | Action |
|------------|-------------------|--------|
| No local file | Yes | Add |
| Matches snapshot | Yes | Update (safe) |
| Modified since snapshot | Yes | Conflicted — aborts the run listing the file + the upstream-issue URL; `--force` applies the template and backs your copy up to `.bos/sync-backup/` |
| Matches template | No | Skip |

The gate is **all-or-nothing**: one conflicted file blocks the entire sync step — never a partial template application. Re-run with `--force` to accept the template everywhere conflicting; your forks land in `.bos/sync-backup/` to diff and merge back.

### Same-version upgrades never touch framework-owned files (ADR 0032)

When the framework version does not change, the template sync is skipped entirely — framework-owned files are only reconciled at a version change.

### Package ref strategy

Workspace packages use `catalog:` refs so a single version bump in root catalog propagates everywhere. Skips `workspace:*` and `file:` refs.

### Release-scoped sources (ADR 0034)

The upgrade (and the sync it drives) fetches the parent template at the **release tag** — the pinned-and-stamped framework version's `v<version>` ref — not `main` HEAD, and pins the framework's own reusable-workflow refs in `.github/workflows/*.yml` to `@v<version>` (third-party actions are never repointed). The snapshot records `release` (the resolved sha/ref) beside `parentRef` for provenance.

## the `platform` pin (ADR 0034)

A child records **one** field in `bos.app.ts`:

```ts
export default App({
  // …
  platform: "2.0.0-rc.14",
});
```

Everything else derives from the resolved **platform release manifest** (published to FastKV at `apps/<root-account>/<root-gateway>/platform.json` beside the config, and staged in-image): the release catalog (what `bos upgrade` bumps from), the image ref + version tag (`ref@v<version>` — the retired `ci.image` fails the deploy with a migration pointer), the release-scoped template source, and the compat contract (strict singletons must match the release's `sharedDeps`; the child's framework version must sit inside the release's compat window).

Rules:
- The pin is **exact** — no ranges. Resolution picks one manifest.
- Field absent → latest manifest found via the `extends` chain (nearest wins). Offline, the cached `.bos/platform-manifest.json` (gitignored) resolves.
- An explicit pin the chain cannot satisfy **fails loud** — publish the release or clear the pin.
- **Pin lifecycle (#546):** the `platform.json` slot is a pointer — a root republish overwrites it. A stale child pin resolves only while the fresh cache (24h TTL) stands in, then fails loud (`platform pin <version> not found in the extends chain`). The repair is exactly this command: `bos upgrade` re-pins to the latest release. Deleting `.bos/platform-manifest.json` defeats the cache when diagnosing.
- Inspect what resolves: `bos platform manifest` (the booted host self-describes from the in-image copy). `--check` runs the compat gate against the local workspace and exits 1 on violations — it also reports pin drift as "parent platform is X (published), you pinned Y" instead of the raw pin error.
- `bos init` without `--source` stamps the pin from the resolved manifest; a local-template init (source dir) leaves the pin off — the next `bos upgrade` stamps it from whatever release then resolves.

What the upgrade reconciles from the parent template:
- framework-owned files (build configs, workflow wrappers, db/lib plumbing — ADR 0032/0033)
- `package.json` deps/scripts/workspaces inside the template's override scopes

What stays local:
- `account`, `testnet` — your NEAR accounts
- `app.*.development` — local dev paths

### extends handling

Both sync and upgrade read the `extends` field (string or object form) of the authored `bos.app.ts` to find the parent. For object extends, uses the `production` URL to locate the template source.

## bos upgrade

Bumps `everything-dev` and `every-plugin` across all workspaces:

```bash
bos upgrade              # Check for new versions, update, then sync
bos upgrade --dry-run    # Preview without making changes
```

> **v1 trees:** upgrading a pre-v2 child app onto the v2 train is a separate
> flow — see the `v1-to-v2-upgrade` skill (`bos upgrade --from v1 --audit`).

### Flow
1. Check npm registry for latest versions of `everything-dev` and `every-plugin`
2. Update root `package.json` workspaces.catalog
3. Update all workspace `package.json` to use `catalog:` references
4. `pnpm install` + `bos types gen`
5. Run `bos sync` to pull template updates matching new version
6. Rewrite legacy UI imports (e.g., `from "@/auth"` → `from "@/app"`)
7. Remove obsolete files

### Package ref strategy

Workspace packages use `catalog:` refs so a single version bump in root catalog propagates everywhere. Skips `workspace:*` and `file:` refs.

## bos import

Imports a workspace subtree (e.g. `plugins/auth`) from an upstream GitHub repo or a local directory — no clone of the full history, just a tarball (or direct local read) of one ref. The upstream can also be resolved through the authored config's `extends` chain (a bos:// URL centric source — see below):

```bash
bos import plugins/auth                          # resolved through the extends chain
bos import plugins/auth --from bos://base.near/base
bos import plugins/auth --from NEARBuilders/everything-dev
bos import plugins/auth --from NEARBuilders/everything-dev@v2.1.0
bos import plugins/auth --from NEARBuilders/everything-dev@everything-dev@2.0.0-rc.8
bos import plugins/auth --from https://github.com/owner/repo@develop
bos import plugins/auth --from ./local-checkout --dry-run
bos import plugins/auth --from owner/repo --yes
```

**Flags:** `--from <bos://<account>/<gateway> | owner/repo[@ref] | url | dir>` (optional — resolve through the extends chain when omitted), `--yes`, `--dry-run`, `--no-install`, `--json`. The GitHub ref splits on the **first** `@`, so changesets-style tags keep their own `@`.

### Source resolution

`--from` takes three shapes:

- **`bos://<account>/<gateway>`** — the config published to FastKV by that runtime. The extends chain of that runtime is walked outward to the **nearest ancestor whose own config declares the workspace locally** (`local:<workspace-path>`); the tarball comes from that ancestor's `repository` field (continuing rootward when the declaring runtime itself lacks one).
- **omitted** — same chain walk, starting from the authored `bos.app.ts` (v2 config only). Errors when the workspace is declared locally in the child (you own it — nothing to import), when no runtime in the chain declares the workspace, or when no ancestor along the chain carries a `repository`.
- **`<owner/repo>[@ref]`, GitHub URL, or local dir** — explicit source, unchanged.

**Ref pinning:** the ancestor's published config pins each workspace to an immutable version manifest. When the ancestor publishes source archives (`publish.sourcePublish` on its authored config, ADR 0030), the import **byte-sources** from the pinned archive: the manifest itself is SRI-verified against the config slot pin, the archive URL + server SRI come from the manifest's `source` field, the bytes are SRI-verified and extracted (repo-root-relative — a drop-in for the GitHub tarball root), and no GitHub dependency exists (the parent's `repository` may be absent or private). If archive fetch fails or its SRI mismatches, the import falls back to the chain-resolved GitHub coordinate with a `Note:`. When the manifest records no `source`, GitHub remains the source: a recorded `git sha` pins the exact deployed commit; otherwise the import falls back to the **default branch (HEAD)** with a `Note:` line. The report's Source section shows both layers: the `bos:// …` extends ref, the source archive URL when used, and the dereferenced `repository @ ref`.

### Classification

Each file shared between the local workspace and the upstream subtree is classified against a baseline: `.bos/import-snapshot.json` (written by previous imports), falling back to `.bos/sync-snapshot.json`.

| Bucket | Meaning | Action |
|---|---|---|
| added | upstream-only | written |
| unchanged | identical content | nothing (baseline recorded) |
| updated | local matches baseline, upstream moved | overwritten with upstream (backed up first) |
| preserved-local | local-only, upstream lacks it | never deleted |
| preserved-local-edit | upstream matches baseline, local edited | local wins, untouched |
| merged | diverged `package.json` | structured merge — template wins shared keys, local-only keys and deps preserved |
| conflict | both changed since baseline, or no baseline exists | gated |

Local-only files are never deleted, even when upstream no longer carries them.

### Gating

Conflicts — and a migration chain that cannot be applied verbatim (next section) — gate the import:

- **Non-TTY without `--yes`:** nothing is written, the report is emitted, exit 1. `--yes` applies upstream over conflicting files (local copies backed up to `.bos/import-backup/<timestamp>/`) and proceeds.
- **TTY:** an interactive confirm (default No; declining exits 1).

A diverged `package.json` is never a conflict when both sides parse — it merges instead.

### Migration chain reconciliation

When both sides have `src/db/migrations/` journals, the chain is **reconciled** instead of overwritten:

- **Applied entries win.** Every local journal entry is presumed applied to the database and is kept verbatim — never renumbered or rehashed.
- **Colliding upstream migrations are renumbered and appended.** An upstream entry that shares an idx or lands below the local tail but is not present locally is renumbered after the local tail in upstream order: upstream `0011_team-member-role` with a local tail at idx 12 becomes `0013_team-member-role`. The `.sql` file is copied to the new name, `meta/<idx>_snapshot.json` is renamed to match, and the migration journal under `meta` (`_journal.json`) is rebuilt (local entries verbatim + appended entries carrying upstream's `when`/`version`).
- **Content matching keeps repeat imports convergent.** An upstream entry whose SQL content hash matches a local entry (e.g. one imported under a renumbered tag earlier) is treated as already imported — nothing is appended twice.
- **Report.** The import report and console output show the kept set (applied), the appended set (`fromTag → toTag`, new idx), and what the next boot will apply versus what is already applied. Renamed snapshots record upstream intermediate schema states — review `drizzle-kit generate` output against the merged chain before generating new migrations.
- **Held back.** Only unresolvable drift holds the chain now: a shared tag whose SQL content differs locally (already-applied hashes would drift), or an unreadable journal. Held chain files are not written; the rest of the workspace imports normally. A held chain gates the run even when no other file conflicts.

### Route-set delta

Both sides' contract surface is scanned for literal `.route({ method, path })` pairs — the monolithic `<workspace>/src/contract.ts` plus any split `<workspace>/src/contract/**` files, unioned per side (so a monolithic local contract compares correctly against a re-export + split-file upstream). The report lists ours-only and theirs-only `METHOD path` routes so API drift is visible before you port local routes onto the new upstream contract.

### Report and baselines

Every run — dry-run, refused, or applied — writes `.bos/import-report.md`: summary table, conflict checklist with reasons and held markers, the migration-chain reconciliation plan (kept/appended/held), route delta, bucket lists, and next steps. Written and unchanged files are recorded to `.bos/import-snapshot.json` (and merged into `.bos/sync-snapshot.json` when one exists) so the next import detects drift instead of starting from zero.

## bos publish

See `everything-dev#publish-sync` for the full publish workflow. A quick reference:

```bash
bos publish                  # Publish config to FastKV
bos publish --deploy         # Build, deploy to CDN, then publish
```

`bos publish --deploy` builds, pins deterministic bundle URLs into the published config, then publishes to FastKV (a legacy JSON child's `bos.config.json` is also updated locally).

## Canonical Ordering

All writes to the authored config enforce `BOS_CONFIG_ORDER`:
`extends` → `account` → `domain` → `title` → `description` → `testnet` → `staging` → `repository` → `ci` → `app` → `plugins`

Unknown keys go after known keys. See `everything-dev#extends-config` for full ordering details.

## The tasks you will actually be given

**"Scaffold a child that extends the base runtime."** `bos init --extends bos://<parent-account>/<gateway> --account <you>.near --domain <your.domain> --no-interactive`, then customize `account` / `domain` / `app.ui` in the authored config; init's tail runs `pnpm install` + `bos types gen` (unless `--no-install`).

**"Sync/upgrade reports conflicted files."** Upgrade refuses atomically — nothing was applied. Your local edits diverged from the init snapshot AND the template changed since your pin. Diff the listed files; if the template should win re-run with `--force` (your copies land in `.bos/sync-backup/`), re-apply your change on top, or port it upstream by filing an issue (ADR 0032).

**"Import a workspace from the base platform."** `bos import <workspace> --dry-run` (defaults to the extends chain; or `--from <owner/repo>` for an explicit upstream) first, read `.bos/import-report.md` for the conflict/migration/route picture, then real-run: plain invoke prompts in a TTY, `--yes` applies upstream over conflicts (backed up), and a flagged migration chain stays held until reconciliation.

**"Upgrade framework packages."** `bos upgrade --dry-run` first, then `bos upgrade` — it re-pins `platform` (ADR 0034), bumps the catalog, rewrites workspace refs to `catalog:`, and reconciles the template. With **no version change** the template sync is skipped (ADR 0032): framework-owned files are only reconciled when the framework version actually changes.

## What comes back when it refuses

| word | do |
|---|---|
| file listed as `conflicted` in upgrade results | local file modified since the snapshot AND the template changed — re-run with `--force` to take the template (your copy is backed up at `.bos/sync-backup/`) or re-apply your change on top |
| my file is never touched by upgrade | app-owned files are never touched; framework-owned files only reconcile at a framework version change (ADR 0032) |
| import exits 1 listing files | unresolvable conflicts (or a held migration chain) — read `.bos/import-report.md`, then re-run with `--yes` to apply upstream (local copies land in `.bos/import-backup/`), or port local changes manually first |
| `Circular extends detected while resolving upgrade source` | the upgrade source's extends chain loops — resolve from a non-cyclic parent |
| init copies fewer files than expected | `buildInitPatterns` filters to the selected plugins + their routes; pass `--overrides ui,api,host` to widen the scaffold |
