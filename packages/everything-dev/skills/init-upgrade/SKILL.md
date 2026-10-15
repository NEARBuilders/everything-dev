---
name: init-upgrade
description: bos init, bos sync, bos import, and bos upgrade workflows — template download, snapshot-based conflict detection, workspace import from upstream repos with divergence reporting, package version bumps, and how init/sync select and own files. Use when scaffolding new projects, syncing upstream changes, importing a workspace subtree from another repo, or upgrading framework packages.
metadata:
  sources: "packages/everything-dev/src/cli/init.ts,packages/everything-dev/src/cli/sync.ts,packages/everything-dev/src/cli/import.ts,packages/everything-dev/src/commands/import.ts,packages/everything-dev/src/cli/upgrade.ts,packages/everything-dev/src/cli/snapshot.ts,packages/everything-dev/src/cli.ts,packages/everything-dev/src/merge.ts"
---

> **Config form:** the authored config is `bos.app.ts` (canonical, preferred when both exist). A legacy `bos.config.json` is still supported for older children. Where this doc says `bos.config.json` for the *local authored file*, read "the authored config". The published artifact on FastKV keeps the key name `bos.config.json`.

# bos init, sync, import, upgrade

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

**Ref pinning:** the ancestor's published config pins each workspace to an immutable version manifest; when that manifest records a `git sha`, the import uses the exact deployed commit. Until deploys record `git sha` (see issue #406 — the field exists in `WorkspaceVersionManifestSchema` but the publish train does not populate it yet), imports fall back to the **default branch (HEAD)** with a `Note:` line in the output and report. The report's Source section shows both layers: the `bos:// …` extends ref and the dereferenced `repository @ ref`.

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

**"Sync reports conflicted files."** Your local edits diverged from the snapshot; upgrade applies the template version and leaves your copy in `.bos/sync-backup/` — diff and merge back, or `bos sync --force` deliberately.

**"Import a workspace from the base platform."** `bos import <workspace> --dry-run` (defaults to the extends chain; or `--from <owner/repo>` for an explicit upstream) first, read `.bos/import-report.md` for the conflict/migration/route picture, then real-run: plain invoke prompts in a TTY, `--yes` applies upstream over conflicts (backed up), and a flagged migration chain stays held until reconciliation.

**"Upgrade framework packages."** `bos upgrade --dry-run` first, then `bos upgrade` — it bumps the root catalog, rewrites workspace refs to `catalog:`, syncs the template, and rewrites legacy imports.

## What comes back when it refuses

| word | do |
|---|---|
| file listed as `conflicted` in sync results | local file modified since the snapshot AND the template changed — take the template version (your copy is backed up at `.bos/sync-backup/`) or re-apply your change on top |
| sync keeps skipping my file | app-owned files that diverged from the snapshot are skipped without `--force`; framework-owned files always update when the template changes |
| import exits 1 listing files | unresolvable conflicts (or a held migration chain) — read `.bos/import-report.md`, then re-run with `--yes` to apply upstream (local copies land in `.bos/import-backup/`), or port local changes manually first |
| `Circular extends detected while resolving upgrade source` | the upgrade source's extends chain loops — resolve from a non-cyclic parent |
| init copies fewer files than expected | `buildInitPatterns` filters to the selected plugins + their routes; pass `--overrides ui,api,host` to widen the scaffold |
