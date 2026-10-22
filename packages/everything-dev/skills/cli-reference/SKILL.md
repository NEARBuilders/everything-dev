---
name: cli-reference
description: Quick reference for all bos CLI commands — flags, options, environment settings, and links to detailed guidance in related skills. Use when any bos command comes up or the user needs a CLI overview.
metadata:
  sources: "packages/everything-dev/src/contract.ts,packages/everything-dev/src/contract.meta.ts,packages/everything-dev/src/cli.ts,packages/everything-dev/src/cli/catalog.ts"
---

> **Config form:** the authored config is `bos.app.ts` (canonical, preferred when both exist). A legacy `bos.config.json` is still supported for older children. Where this doc says `bos.config.json` for the *local authored file*, read "the authored config". The published artifact on FastKV keeps the key name `bos.config.json`.

# CLI Command Reference

21 `bos` commands organised by workflow category.

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

Start the production host. Loads the authored config (`bos.app.ts`), wires MF remotes, serves SSR.

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

`--packages` accepts a comma-separated key list, `all` (default), or `local`. `local` selects only entries whose `development` field starts with `local:`, so the build set auto-tracks whatever apps and plugins live in this repo. CI deploy now invokes `bos publish --deploy --packages local` instead of a hand-maintained CSV.

→ [`publish-sync`](.) skill for full deploy+publish workflow.

### `bos config`

Print the loaded configuration (plain or fully resolved).

**Flags:** `--full`

```bash
bos config        # print the authored config with env overrides applied
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

### `bos upgrade`

Upgrade a child behind a pinned parent to the parent's latest platform release, moving the `platform` pin (ADR 0034). Fails out on unresolvable local conflicts — the template wins; conflicting copies are backed up to `.bos/sync-backup/` only with `--force`.

**Flags:** `--dry-run` `--check` `--no-install` `--no-sync` `--force` (`--from <version>` is passed internally by the scheduled re-exec, not user-facing)

```bash
bos upgrade
bos upgrade --dry-run       # preview version bumps
bos upgrade --check         # CI drift alarm (ADR 0034): exit 1 when updates are available
bos upgrade --no-sync       # only upgrade packages, skip the template sync
bos upgrade --force         # accept the template, back up conflicting local edits, continue
```

When a platform release manifest resolves, its catalog is the version source (one registry read); `--check` diffs the recorded `platform` pin against the latest published manifest and exits nonzero on drift. The pre-flight runs the staged `dryRun` `dry-run` sync first: any file the child hand-edited past its init snapshot aborts the whole run with the conflicted list and the upstream-issue URL — re-run with `--force` to back up the forks and take the template. Framework-owned files are reconciled only when the framework version actually changes (ADR 0032).

→ [`init-upgrade`](.) skill for catalog strategy, snapshot conflict gates, and upgrade+publish flow.

### `bos import`

Import a workspace subtree (e.g. `plugins/auth`) from an upstream — a GitHub repo, a local directory, a `bos://` published runtime, or (default) the authored config's extends chain. Chain-resolved sources walk outward to the nearest ancestor declaring the workspace; when the ancestor publishes source archives (`publish.sourcePublish`, ADR 0030) the import byte-sources from the pinned, SRI-verified archive (no GitHub needed, `repository` optional) and falls back to the chain's `repository` (pinned to the manifest's git sha, HEAD otherwise) only when no archive exists. Per-file classification is snapshot-baselined; diverging migration chains are reconciled — applied local entries are kept verbatim, colliding upstream migrations are renumbered and appended, journal rebuilt. Unresolvable conflicts (content drift on an applied migration, unreadable journal) hold the chain and gate the run (exit 1) unless `--yes` or an interactive confirmation.

**Flags:** `--from <bos://<account>/<gateway> | owner/repo[@ref] | url | dir>` (optional — extends chain when omitted) `--yes` `--dry-run` `--no-install` `--json`

```bash
bos import plugins/auth                                    # resolved through the extends chain
bos import plugins/auth --from bos://base.near/base        # chain of a published runtime
bos import plugins/auth --from NEARBuilders/everything-dev@v2.1.0
bos import plugins/auth --from ./local-checkout --dry-run
bos import plugins/auth --from owner/repo --yes
```

→ [`init-upgrade`](.) skill for source resolution, classification buckets, migration-chain reconciliation, route deltas, and the `.bos/import-report.md` report.

### `bos status`

Show project health: package versions, parent reachability, last sync, env file status, and update availability.

```bash
bos status
```

Output includes installed vs latest versions for each workspace package, whether the parent extends reference is reachable, whether `.env` exists, and when the last sync ran. No flags.

### `bos platform manifest`

Show the resolved platform release manifest (ADR 0034) — the contract of the framework release this runtime is pinned to.

**Flags:** `--check`

```bash
bos platform manifest          # print the resolved manifest + its source
bos platform manifest --check  # also run the compat gate; exit 1 on violations
```

Resolution order: the in-image manifest first (the booted host self-describes from the release bytes it runs on), registry resolution through the extends chain otherwise (`.bos/platform-manifest.json` is the offline cache). `--check` verifies the workspace's strict-singleton pins against the manifest's `sharedDeps` and the framework version against the release's compat floor — the same check the deploy smoke gate runs. Status is `absent` (no manifest resolves — pre-0034 behavior applies) or `fail` (unresolvable/error) with diagnostics.

## Publishing

### `bos publish`

Publish the resolved config to the FastKV on-chain registry. Optionally build and deploy workspaces first.

**Flags:** `--deploy` `--dry-run` `--network <mainnet|testnet>` `--private-key <key>` `--wallet` `--env <production|staging>` `--packages <list|all|local>`

```bash
bos publish                          # publish current config snapshot
bos publish --deploy                 # build all + deploy + publish
bos publish --deploy --packages local   # build/deploy only the workspaces owned by this repo (CI default)
bos publish --dry-run                # preview what would be published
bos publish --network testnet        # publish to testnet registry
bos publish --wallet                 # gasless: sign in a browser, relayed delegate write — no local key needed
```

→ [`publish-sync`](.) skill for config sections, SRI integrity, rollback, and FastKV troubleshooting.

### `bos mf check`

Verify Module Federation runtime compatibility across the published host + plugin config. Fetches every `<remote>/mf-manifest.json`, asserts `metaData.pluginVersion` matches the host, and confirms each plugin provides the shared dependencies the host requires at compatible versions.

```bash
bos mf check     # exits 0 if compatible, 1 with diagnostic output if not
```

Use after redeploying any plugin to verify federation reachability before the next deploy. CI runs this on every push/PR; do not disable the gate. When it fails, redeploy the lagging plugin via `cd plugins/<key> && pnpm run deploy && bos publish --deploy`.

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

**Deploy legs** (image / smoke / railway) report per-leg outcomes (✓ ok / – skipped / ✗ failed) and are tier-aware (ADR 0020/0021): a runtime that owns its image (a Dockerfile at the config root or `BOS_IMAGE`) is "root" and must pin a digest before Railway; a runtime inheriting the universal image is "child" — its image ref derives from the platform release manifest (`platform` pin, ADR 0034): the Railway leg repoints the service source to the pinned ref and redeploys (`railway service source connect --image <ref:tag>`, then `redeploy --from-source`), float children without a resolved manifest redeploy without a digest, and `ci.image` in an authored config fails the deploy with a migration pointer. The deploy exits 0 whenever the config publishes and no leg failed; `RAILWAY_TOKEN` is optional. The platform release manifest (ADR 0034) rides the FastKV publish as a third `registryEntries` key — full trains only (a root's production build with upload; config-only publishes and staging skip it), and a registry failure reading the previous release skips the manifest rather than publishing a wrong compat window.

→ [`publish-sync`](.) skill and [`super-app`](.) for tenant-aware deploy considerations.

### `bos login` / `bos logout`

Establish publish/CLI identity without a seed phrase or private key. `bos login` opens a browser (one approval), persists a device-named API key in `.bos/session.json` (gitignored), and works for both the publish path and API access (`x-api-key` on `/api/*`, `/api/rpc/*`, `/api/mcp`).

**Flags (login):** `--key` (additionally mint and export a publish-scoped function-call key to `~/.near-credentials`)

```bash
bos login          # browser approval → API key in .bos/session.json
bos login --key    # also export a scoped publish key (near-CLI format)
bos logout         # revoke the API key (best-effort) + delete the handle and exported key
```

Sessions/keys expire (90 days by default); re-login is non-destructive. → [`talk-to-the-app`](.) skill for the authentication model and MCP access.

### `bos secrets set` / `list` / `remove`

The deploy console's secrets vault — sealed runtime secrets keyed by `(account, gateway, name)`, sealed at rest with the proven sealed-box cipher under a per-runtime KEK (HKDF of the platform root secret, runtime-scoped salt). Values are never echoed back — `list` shows names + set/missing status against the declared config only.

**Flags:** `<name>` (positional) `--value <val>` (omit: hidden TTY prompt) `--site <url>` (override vault site) · remove: `--yes` (skip confirmation)

```bash
bos secrets set AI_API_KEY      # hidden prompt → sealed into the vault
bos secrets set AI_API_KEY --value sk-...   # non-interactive
bos secrets list                # names + set/missing/undeclared, never values
bos secrets remove AI_API_KEY   # confirmation prompt (skip with --yes)
```

The vault is per-deployment: rows go to whichever deployment answers at the credential's site, keyed by the authored config's runtime identity. Reserved names: `BOS_*` and `PORT` (the platform composes them into instance env). → plan 055 for the delivery model (reconciler assembles resolved values into `identityEnv`; ticket 13 swaps the KEK source).

## Plugins

### `bos plugin add`

Add a plugin attachment to the authored config from a local path, BOS reference, or remote URL.

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

Remove a plugin attachment from the authored config (inherited parent plugins cannot be removed locally).

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

Build a single plugin, then pin its deterministic image-native production URL into the published config (`https://<domain>/bundles/<account>/<gateway>/<key>/`).

**Flags:** `<key>` (positional)

```bash
bos plugin publish my-plugin
```

→ [`plugin-development`](.) skill for build config (rspack.config.js), CLI lifecycle, and deploy workflow.

## Types & DB

### `bos types gen`

Generate and fetch type definitions from configured API and plugin contracts. Runs automatically on `pnpm install`, `bos dev`, `bos build`, `bos plugin add`, and `bos plugin remove`. Also the hermetic local-resolution step: it writes `.bos/bos.resolved-config.json` and regenerates the ui route tree, so a fresh checkout needs exactly one `bos types gen` before `pnpm typecheck` to match CI.

**Flags:** `--env <development|production>` `--dry-run` `--remote-plugins <ids>`

```bash
bos types gen                     # development mode (local + remote sources)
bos types gen --env production    # production mode (remote sources only)
bos types gen --dry-run           # preview without writing files
bos types gen --remote-plugins auth,registry   # fetch contract types remotely
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

## The tasks you will actually be given

**"Regenerate the types."** `bos types gen` — or just `pnpm run typecheck`, which regenerates first and then checks. Never hand-edit `*.gen.ts` files.

**"Which command deploys?"** `pnpm run deploy` (the full train: preflight → build → upload → publish → image). Config-only is `bos publish`; one plugin is `bos plugin publish <key>`.

**"What release am I on?"** `bos platform manifest` — the resolved platform release manifest and its source; `--check` adds the compat gate. `bos upgrade --check` is the CI drift alarm against the latest release.

**"What is running right now?"** `bos ps` for tracked dev processes, `bos status` for health and versions, `ls .bos/logs/` for per-service logs.
