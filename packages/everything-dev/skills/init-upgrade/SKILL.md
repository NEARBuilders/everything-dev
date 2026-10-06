---
name: init-upgrade
description: bos init, bos sync, and bos upgrade workflows — template download, snapshot-based conflict detection, package version bumps, and how init/sync select and own files. Use when scaffolding new projects, syncing upstream changes, or upgrading framework packages.
metadata:
  sources: "packages/everything-dev/src/cli/init.ts,packages/everything-dev/src/cli/sync.ts,packages/everything-dev/src/cli/upgrade.ts,packages/everything-dev/src/cli/snapshot.ts,packages/everything-dev/src/cli.ts,packages/everything-dev/src/merge.ts"
---

> **Config form:** the authored config is `bos.app.ts` (canonical, preferred when both exist). A legacy `bos.config.json` is still supported for older children. Where this doc says `bos.config.json` for the *local authored file*, read "the authored config". The published artifact on FastKV keeps the key name `bos.config.json`.

# bos init, sync, upgrade

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
7. Write initial snapshot (`.bos/sync-snapshot.json`) — records file path → content hash for all template-origin files, used later by `bos sync` for conflict detection
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

### Sync Ownership Model

`bos sync` uses the init snapshot plus `FRAMEWORK_OWNED_SYNC_FILES` to decide what it may overwrite.

Framework-owned files are updated when the template changes, for example build configs, generated wiring, and shared runtime scaffolding.

App-owned files are left alone unless the local file still matches the recorded snapshot or you pass `--force`, for example:
- `ui/src/components/**`
- `ui/src/routes/**`
- `api/src/contract.ts`
- `api/src/index.ts`
- `api/src/db/schema.ts`

Generated files are regenerated separately and are not the source of truth for sync decisions.

## bos sync

Pulls updates from the parent template:

```bash
bos sync                 # Sync from extends reference
bos sync --force         # Overwrite even locally modified files
bos sync --dry-run       # Preview without writing changes
```

### Snapshot-based conflict detection

Uses `.bos/sync-snapshot.json` to track which files came from the template and their hashes:

| Local state | Template changed? | Action |
|------------|-------------------|--------|
| No local file | Yes | Add |
| Matches snapshot | Yes | Update (safe) |
| Modified since snapshot | Yes | Skip (unless `--force`) |
| Matches template | No | Skip |

Framework-owned files (from `FRAMEWORK_OWNED_SYNC_FILES`) are always updated when changed.

### What gets synced

From parent template → local:
- `app.*.production` — bundle URLs
- `app.api.shared`, `app.auth.shared`, `plugins.*.shared` — dependency versions
- Framework-owned files (rsbuild configs, routers, etc.)

What stays local:
- `account`, `testnet` — your NEAR accounts
- `app.*.development` — local dev paths

### extends handling

Sync reads the `extends` field (string or object form) to find the parent. For object extends, uses the `production` URL to locate the template source.

## bos upgrade

Bumps `everything-dev` and `every-plugin` across all workspaces:

```bash
bos upgrade              # Check for new versions, update, then sync
bos upgrade --dry-run    # Preview without making changes
```

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

**"Sync reports conflicted files."** Your local edits diverged from the snapshot; upgrade applies the template version and leaves your copy in `.bos/sync-backup/` — diff and merge back, or `bos sync --force` deliberately.

**"Upgrade framework packages."** `bos upgrade --dry-run` first, then `bos upgrade` — it bumps the root catalog, rewrites workspace refs to `catalog:`, syncs the template, and rewrites legacy imports.

## What comes back when it refuses

| word | do |
|---|---|
| file listed as `conflicted` in sync results | local file modified since the snapshot AND the template changed — take the template version (your copy is backed up at `.bos/sync-backup/`) or re-apply your change on top |
| sync keeps skipping my file | app-owned files that diverged from the snapshot are skipped without `--force`; framework-owned files always update when the template changes |
| `Circular extends detected while resolving upgrade source` | the upgrade source's extends chain loops — resolve from a non-cyclic parent |
| init copies fewer files than expected | `buildInitPatterns` filters to the selected plugins + their routes; pass `--overrides ui,api,host` to widen the scaffold |
