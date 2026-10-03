---
name: publish-sync
description: Publish bos.config.json to the FastKV registry, sync from upstream, and upgrade workspace packages. Use when deploying, syncing, or managing runtime configuration across projects.
metadata:
  sources: "packages/everything-dev/src/plugin.ts,packages/everything-dev/src/cli/sync.ts,packages/everything-dev/src/cli/upgrade.ts,packages/everything-dev/src/fastkv.ts,packages/everything-dev/src/integrity.ts,packages/everything-dev/src/config.ts"
---

# everything-dev Publish & Sync

## Core Workflow

```
Build → Publish → Sync
  ↓        ↓        ↓
rspack  FastKV    bos sync
```

## Publish

Publish `bos.config.json` to the configured FastKV registry path for the app account/domain:

```bash
bos publish                        # Publish config only
bos publish --deploy               # Build/deploy all workspaces first, then publish
bos publish --deploy --packages local   # Build/deploy only the workspaces owned locally (recommended for CI)
bos publish --dry-run              # Preview without sending
bos publish --network testnet
bos publish --packages ui,api      # Manual subset
```

`--packages` accepts a comma-separated key list, `all` (default), or `local`. `local` selects only the entries whose `development` field starts with `local:`, so it auto-tracks whatever plugins or apps live in this repo without you editing workflow files when a plugin is added. CI deploy configuration should use `--packages local` exclusively; remote-only plugins can't be redeployed from this repo and will fail with a missing-local-path error.

The registry transaction is signed in-process via near-kit — key resolution order: explicit key → `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` env → `~/.near-credentials/<network>/<account>.json` → near-cli-rs OS keychain (`sign-with-keychain`, interactive only). Publishes are skipped when FastKV already holds an identical config. Reads are indexed by tx signer, so the config resolves at `bos://<account>/<gateway>` only when signed by `<account>` itself — see the `registry` skill for the namespace=signer law and composing other runtimes (`bos registry use`).

After `bos publish --deploy`:
1. Each workspace builds; the publish writes deterministic bundle URLs (`https://<domain>/bundles/<account>/<gateway>/<workspace>/`)
2. `bos.config.json` is auto-updated with the production URLs
3. Config is published to the FastKV registry at `{account}/bos/gateways/{gateway}/bos.config.json`

The `--network` flag controls the NEAR network (mainnet by default). With `--network testnet`, publishes go to the NEAR testnet chain under the testnet account specified in config.

### Rollback

To revert a publish, restore the previous `bos.config.json` from git and re-publish:

```bash
git checkout HEAD~1 -- bos.config.json
bos publish
```

Or cherry-pick a specific version of `bos.config.json` and publish that snapshot.

Lineage model:
- `extends` is the canonical parent edge between published runtimes
- `account` is the tenant namespace root for that runtime
- `domain` is the public ingress for that runtime
- a child runtime can extend a parent and still become a new tenant root on its own domain

### Self-Deployed / Tenant Publishing

You don't need to wait for CI/CD to see changes in production. Publish your own config on-chain under your own NEAR account and run your own host instance, inheriting the base platform via `extends`.

**Same gateway, own account:**

`BOS_GATEWAY` (`domain` in `bos.config.json`) is the **FastKV lookup key**, not the DNS domain your Railway instance serves on. By keeping `BOS_GATEWAY` the same as the parent while using your own `BOS_ACCOUNT`, your config lives at a separate FastKV path (`bos://<your-account>/<gateway>`) that `extends` the base runtime. You inherit the full platform — host, API, auth, plugins — and override only what you change. Your Railway URL is the ingress.

**Step-by-step:**

1. Install near-cli-rs (v0.23.5) — only needed for account creation and `bos key generate`; `bos publish` signs transactions in-process via near-kit
2. Create a NEAR account via near-cli-rs (testnet or mainnet; named accounts can own subaccounts, implicit hex accounts cannot)
3. `bos key generate` — generates a function-call key scoped to the FastKV registry contract; set the output as `NEAR_PRIVATE_KEY`
4. Update `bos.config.json`: set `account` to your NEAR account, add `"extends": "bos://<parent-account>/<parent-gateway>"`, keep `domain` as the parent gateway
5. `bos publish --deploy` — builds workspaces, writes deterministic bundle URLs, publishes config to FastKV at `bos://<your-account>/<gateway>`
6. Deploy to Railway (one-click template or `railway up`), set `BOS_ACCOUNT`, `BOS_GATEWAY` (same as parent), `BETTER_AUTH_SECRET` — the host fetches your config from FastKV and serves live

**Subaccount creation** (unused by the tenant wizard today — tenants are owned by the connected sputnik-dao account) requires an explicit relayer with a named account: set `siwn.relayer.{mainnet,testnet}.accountId` + a private key, and point `siwn.subAccount.parentAccount`, `siwn.recipients`, and `siwn.relayer.*.whitelistedContracts` to your account.

## Sync

Pull template updates from the parent referenced by local `bos.config.json`:

```bash
bos sync
bos sync --force
bos sync --dry-run
```

What gets synced from the parent template:
- `app.*.production` — bundle URLs
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

See `everything-dev#extends-config` for the full table. In short: `bos dev` and `bos build` write to `.bos/bos.resolved-config.json` (gitignored); `bos publish --deploy`, `bos plugin publish`, and `bos sync` write to `bos.config.json`.

## Troubleshooting

```bash
bos info              # Show current configuration
bos status            # Check remote health
```

### FastKV publish failures

- **NEAR RPC error**: Verify the configured NEAR account has sufficient gas and the FastKV contract is deployed at `{account}/bos/gateways/{gateway}/bos.config.json`
- **Account mismatch**: The `bos.config.json` `account` field must match the on-chain account that owns the FastKV path
- **Network mismatch**: Ensure `--network` matches where the account is deployed (mainnet vs testnet)
- **Dry-run first**: Use `bos publish --dry-run` to preview before sending

### Integrity verification

During `bos publish --deploy`, integrity SRI hashes are auto-generated for each remote entry and stored in `bos.config.json`. At runtime, the host:
- Verifies integrity on first load using bounded streaming (not full-response buffering)
- Uses stale-while-revalidate for asset requests to avoid latency spikes
- Blocks HTML and SSR requests on integrity mismatch
- Identifies SSR modules by both URL and `ssrIntegrity` hash in the cache

If a remote entry fails integrity check, the host rejects it and falls back to client-rendered output without that remote.

### Federation runtime compatibility (`bos mf check`)

Each deployed bundle's `mf-manifest.json` reports `metaData.pluginVersion` — the version of `@module-federation/runtime` baked into the bundle at build time. The host is the federation **consumer**; each plugin is a **provider** loaded over `mf-manifest.json` and `remoteEntry.js`. When the host's runtime version drifts ahead of a plugin's runtime version, the plugin's `remoteEntry.js` throws:

```
undefined is not an object (evaluating '__webpack_modules__[e].call')
```

The host treats this as a soft failure and continues serving with the plugin missing (`⚠ N plugin(s) failed to load`). Production stays live but the plugin is dead.

```bash
bos mf check                          # exit 0 = all manifests compatible
bos publish --deploy --packages local # ship a fresh bundle + republish to FastKV
```

The check fetches `<host>/mf-manifest.json` and every `<plugin>/mf-manifest.json`, asserting:

- `metaData.pluginVersion` matches the host's
- every `shared[]` dep the host requires (`requiredVersion: ^X.Y.Z`) is provided by the plugin at a compatible version

If `bos mf check` fails for one plugin, redeploy only that plugin from this repo:

```bash
cd plugins/<key>
bos plugin publish <key>             # rebuild + write the deterministic bundle URL to bos.config.json
```

Then from the repo root: `bos publish --deploy --packages local` and `bos mf check` to confirm.

In CI, this runs as a `bos mf check` step on every push/PR (`packages/everything-dev/src/cli.ts:mfCheck`). Treat a failed run as "this bundle is stale; a plugin needs to be redeployed" — never disable.

### Process issues

```bash
bos kill               # Kill all tracked processes
bun install            # Reinstall deps
bos dev                # Restart
```
