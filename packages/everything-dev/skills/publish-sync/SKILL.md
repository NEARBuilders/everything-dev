---
name: publish-sync
description: Publish bos.config.json to the FastKV registry, sync from upstream, and upgrade workspace packages. Use when deploying, syncing, or managing runtime configuration across projects.
metadata:
  sources: "src/plugin.ts,src/cli/sync.ts,src/cli/upgrade.ts,src/fastkv.ts,src/integrity.ts"
---

# everything-dev Publish & Sync

## Core Workflow

```
Build → Deploy → Publish → Sync
  ↓       ↓        ↓        ↓
rspack  Zephyr   FastKV   bos sync
        CDN      registry
```

## Publish

Publish `bos.config.json` to the configured FastKV registry path for the app account/domain:

```bash
bos publish                  # Publish config only
bos publish --deploy         # Build/deploy all workspaces first, then publish
bos publish --dry-run        # Preview without sending
bos publish --network testnet
bos publish --packages ui,api
```

After `bos publish --deploy`:
1. Each workspace builds and deploys to Zephyr CDN
2. `bos.config.json` is auto-updated with production URLs + integrity hashes
3. Config is published to the FastKV registry at `{account}/bos/gateways/{gateway}/bos.config.json`

Lineage model:
- `extends` is the canonical parent edge between published runtimes
- `account` is the tenant namespace root for that runtime
- `domain` is the public ingress for that runtime
- a child runtime can extend a parent and still become a new tenant root on its own domain

## Sync

Pull template updates from the parent referenced by local `bos.config.json`:

```bash
bos sync
bos sync --force
bos sync --dry-run
```

What gets synced from the parent template:
- `app.*.production` — Zephyr URLs
- `app.*.ssr` — SSR URLs
- `shared` — shared dependency versions
- framework-owned files like build configs, router wiring, and shared runtime scaffolding

What stays local:
- `account`, `testnet` — your NEAR accounts
- `app.*.development` — local dev URLs

What gets merged:
- `app.*.secrets` — union of remote + local
- `app.*.variables` — merged (local overrides remote)

## Upgrade

Bump `every-plugin` and `everything-dev` across all workspaces:

```bash
bos upgrade              # Check for new versions, update, then sync
bos upgrade --dry-run    # Preview without making changes
```

`bos upgrade` updates **all workspace `package.json`s**, not just root. Also updates `peerDependencies` and `workspaces.catalog`. Correctly skips `workspace:*` and `catalog:` references.

## Build

```bash
bos build                # Build all packages (skips missing)
bos build ui             # Build specific package
bos build ui,api         # Build multiple
bos build --force        # Force rebuild
```

## Config Integrity

`bos.config.json` entries can include `integrity` fields with SRI hashes:

```json
{
  "app": {
    "ui": {
      "production": "https://cdn.example.com/ui/remoteEntry.js",
      "integrity": "sha384-abc123..."
    }
  }
}
```

These are auto-generated during `bos publish --deploy` and verified at runtime by the host.

## Configuration

All runtime config lives in `bos.config.json`. Key sections:
- `account` — NEAR mainnet account
- `testnet` — NEAR testnet account
- `staging.domain` — Staging domain
- `app.host`, `app.ui`, `app.api`, `app.auth` — Module configs with development/production URLs
- `plugins.{key}` — Plugin configs with variables, secrets, routes
- `app.api.shared`, `app.auth.shared`, `plugins.{key}.shared` — Module Federation shared dependency versions

### extends

Config can inherit from a parent via `extends`:
```json
{ "extends": "bos://dev.everything.near/everything.dev" }
```

Or per-environment:
```json
{
  "extends": {
    "development": "bos://dev.everything.near/everything.dev",
    "production": "bos://dev.everything.near/everything.dev",
    "staging": "bos://staging.everything.near/everything.dev"
  }
}
```

Deep merge: child overrides parent. Plugins are deep-merged (set to `null` to remove). `secrets` arrays are unioned. See the `extends-config` skill for full details.

Registry and discovery should treat `extends` as runtime lineage. That keeps remix ancestry, tenant roots, and published BOS refs aligned without adding a second parent field.

For remix-host browsing with the apps plugin:
- use `parent` when you want only direct children of a runtime
- use `ancestor` when you want all descendants of a runtime, even when that runtime is not the lineage root
- use `root` when you want the whole tree from the topmost ancestor
- prefer querying by canonical BOS ref like `bos://account/gateway`, not by host URL, because shared-host descendants can reuse the same host

### What bos dev writes vs bos publish writes

| Mode | Writes to | File |
|------|-----------|------|
| `bos dev` | `.bos/bos.resolved-config.json` | Full merged config (gitignored) |
| `bos build` | `.bos/bos.resolved-config.json` | Full merged config |
| `bos publish --deploy` | `bos.config.json` | Snapshot with pinned production URLs |
| `bos plugin publish` | `bos.config.json` | Records production URL + integrity |
| `bos sync` | `bos.config.json` | Merges template updates |

## Troubleshooting

```bash
bos info              # Show current configuration
bos status            # Check remote health
```

Process issues:
```bash
bos kill               # Kill all tracked processes
bun install            # Reinstall deps
bos dev --host remote  # Restart
```
