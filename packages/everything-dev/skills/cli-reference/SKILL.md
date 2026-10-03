---
name: cli-reference
description: Quick reference for all bos CLI commands — flags, options, environment settings, and links to detailed guidance in related skills. Use when any bos command comes up or the user needs a CLI overview.
metadata:
  sources: "packages/everything-dev/src/contract.ts,packages/everything-dev/src/contract.meta.ts,packages/everything-dev/src/cli.ts,packages/everything-dev/src/cli/catalog.ts"
---

# CLI Command Reference

17 `bos` commands organised by workflow category.

## Development

### `bos dev`

Start a development session. Runs host, API, auth, and UI processes with hot reload.

**Flags:** `--host <local|remote>` `--ui <local|remote>` `--api <local|remote>` `--auth <local|remote>` `--remote-plugins <ids>` `--proxy` `--ssr` `--port <n>`

```bash
bos dev                   # full local (all services)
bos dev --api remote      # UI-only mode, use remote API
bos dev --ui remote       # API-only mode, use remote UI
bos dev --proxy           # local host proxies to remote API/UI
bos dev --remote-plugins auth,registry  # force specific plugins remote
```

→ [`dev-workflow`](.) skill for port assignments, service-descriptor architecture, hot reload, and debugging.

### `bos start`

Start the production host. Loads config from `bos.config.json`, wires MF remotes, serves SSR.

**Flags:** `--env <production|staging>` `--port <n>` `--account <id>` `--domain <domain>` `--no-interactive`

```bash
bos start                          # production, auto-detects env
bos start --env staging            # staging mode
bos start --account myapp.near     # tenant override
```

→ [`dev-workflow`](.) skill for production topology and [`super-app`](.) for tenant overrides.

### `bos build`

Build all workspace packages (or a subset) for production.

**Flags:** `--packages <list|all|local>` `--force` `--deploy`

```bash
bos build                       # build all workspaces
bos build --packages ui,api     # build specific packages (csv)
bos build --packages local      # build only workspaces whose development starts with local:
bos build --force               # rebuild even if up-to-date
bos build --deploy              # build + write deploy URLs
```

`--packages` accepts a comma-separated key list, `all` (default), or `local`. `local` selects only entries whose `bos.config.json` `development` field starts with `local:`, so the build set auto-tracks whatever apps and plugins live in this repo. CI deploy now invokes `bos publish --deploy --packages local` instead of a hand-maintained CSV.

→ [`publish-sync`](.) skill for full deploy+publish workflow.

### `bos config`

Print the loaded configuration (plain or fully resolved).

**Flags:** `--full`

```bash
bos config        # print bos.config.json with env overrides applied
bos config --full # print fully resolved config (extends + deep merge)
```

→ [`extends-config`](.) skill for deep merge semantics and resolved config lifecycle.

## Lifecycle

### `bos init`

Scaffold a new project from a deployed app or template. Interactive by default.

**Flags:** `--extends <ref>` `--directory <dir>` `--account <id>` `--domain <d>` `--source <dir>` `--plugins <list>` `--overrides <sections>` `--no-interactive` `--no-install`

```bash
bos init                                       # interactive wizard
bos init mysite.everything.dev                 # quick scaffold from current config
bos init --extends bos://account/gateway       # from a specific parent
bos init --overrides ui,api,host,plugins       # customise local sections
bos init --source ./my-app --no-interactive    # from local source, skip prompts
```

→ [`init-upgrade`](.) skill for template download, file selection, snapshots, and conflict wiring.

### `bos sync`

Sync template files from the parent project. Compares snapshot-versioned files to detect conflicts.

**Flags:** `--dry-run` `--no-install`

```bash
bos sync
bos sync --dry-run    # preview without writing
```

→ [`init-upgrade`](.) skill for snapshot-based conflict detection and framework-owned sections.

### `bos upgrade`

Upgrade framework packages then sync template files. Interactive; prompts for package selection.

**Flags:** `--dry-run` `--no-install` `--no-sync`

```bash
bos upgrade
bos upgrade --dry-run       # preview version bumps
bos upgrade --no-sync       # only upgrade packages, skip template sync
```

→ [`init-upgrade`](.) skill for catalog strategy, legacy import rewrites, and upgrade+publish flow.

### `bos status`

Show project health: package versions, parent reachability, last sync, env file status, and update availability.

```bash
bos status
```

Output includes installed vs latest versions for each workspace package, whether the parent extends reference is reachable, whether `.env` exists, and when the last sync ran. No flags.

## Publishing

### `bos publish`

Publish `bos.config.json` to the FastKV on-chain registry. Optionally build and deploy workspaces first.

**Flags:** `--deploy` `--dry-run` `--network <mainnet|testnet>` `--private-key <key>` `--env <production|staging>` `--packages <list|all|local>`

```bash
bos publish                          # publish current config snapshot
bos publish --deploy                 # build all + deploy + publish
bos publish --deploy --packages local   # build/deploy only the workspaces owned by this repo (CI default)
bos publish --dry-run                # preview what would be published
bos publish --network testnet        # publish to testnet registry
```

→ [`publish-sync`](.) skill for config sections, SRI integrity, rollback, and FastKV troubleshooting.

### `bos mf check`

Verify Module Federation runtime compatibility across the published host + plugin bundles in `bos.config.json`. Fetches every `<remote>/mf-manifest.json`, asserts `metaData.pluginVersion` matches the host, and confirms each plugin provides the shared dependencies the host requires at compatible versions.

```bash
bos mf check     # exits 0 if compatible, 1 with diagnostic output if not
```

Use after redeploying any plugin to verify federation reachability before the next deploy. CI runs this on every push/PR; do not disable the gate. When it fails, redeploy the lagging plugin via `cd plugins/<key> && bun run deploy && bos publish --deploy`.

→ [`publish-sync`](.) skill for the federation-compat failure mode and the recovery workflow.

### `bos deploy`

Publish config and trigger a Railway redeploy. Builds and deploys by default.

**Flags:** `--env <production|staging>` `--no-build` `--dry-run` `--network <mainnet|testnet>` `--private-key <key>` `--service <name>` `--packages <list|all|local>`

```bash
bos deploy                              # build + publish + trigger deploy
bos deploy --packages local             # build/deploy only this repo's local workspaces
bos deploy --no-build                   # publish only, skip workspace build
bos deploy --service my-railway         # override Railway service name
```

→ [`publish-sync`](.) skill and [`super-app`](.) for tenant-aware deploy considerations.

### `bos key generate`

Generate a publish access key (NEAR function-call key) scoped to the FastKV registry contract.
If existing publish keys are found on the account, you will be prompted to remove them.

**Flags:** `--allowance <amount>` (default: `1NEAR`)

```bash
bos key generate                    # generate key with default allowance
bos key generate --allowance 2NEAR  # custom allowance
```

Outputs the public key, private key, and registry contract address. The generated key can only call the set and get methods on the BOS registry contract — it cannot transfer funds or call other contracts.

## Plugins

### `bos plugin add`

Add a plugin attachment to `bos.config.json` from a local path, BOS reference, or remote URL.

**Flags:** `<source>` (positional) `--as <alias>` `--production <url>`

```bash
bos plugin add local:plugins/my-plugin                         # local plugin
bos plugin add bos://account/gateway                           # from BOS registry
bos plugin add https://cdn.example.com/remoteEntry.js           # remote URL
bos plugin add local:plugins/my-plugin --as my-alias            # with alias
bos plugin add local:plugins/my-plugin --production <prod-url>  # separate prod URL
```

→ [`plugin-development`](.) skill for plugin anatomy, contract/service/index pattern, and registration.

### `bos plugin remove`

Remove a plugin attachment from `bos.config.json`.

**Flags:** `<key>` (positional)

```bash
bos plugin remove my-plugin
```

### `bos plugin list`

List all configured plugins with their sources (local vs remote), versions, and integrity hashes.

```bash
bos plugin list
```

Outputs each plugin's key, development source, production URL, local path, version, and SRI integrity hash.

### `bos plugin publish`

Build a single plugin, then update `bos.config.json` with its deterministic image-native production URL (`https://<domain>/bundles/<account>/<gateway>/<key>/`).

**Flags:** `<key>` (positional)

```bash
bos plugin publish my-plugin
```

→ [`plugin-development`](.) skill for build config (rspack.config.js), CLI lifecycle, and deploy workflow.

## Types & DB

### `bos types gen`

Generate and fetch type definitions from configured API and plugin contracts. Runs automatically on `bun install`, `bos dev`, `bos build`, `bos plugin add`, and `bos plugin remove`.

**Flags:** `--env <development|production>` `--dry-run`

```bash
bos types gen                     # development mode (local + remote sources)
bos types gen --env production    # production mode (remote sources only)
bos types gen --dry-run           # preview without writing files
```

Generated files: `api-types.gen.ts`, `auth-types.gen.ts` (ui, api, host), `plugins-types.gen.ts`. Uses `local:` sources in dev and production URLs in production mode.

### `bos db studio`

Open Drizzle Studio for inspecting a plugin's database.

**Flags:** `<plugin>` (positional, default: `api`)

```bash
bos db studio             # open Drizzle Studio for the API database
bos db studio auth        # open for the auth plugin
bos db studio my-plugin   # open for a custom plugin
```

Requires the `DATABASE_URL` secret to be set on the target plugin. Uses the plugin's drizzle.config.ts for schema discovery.
