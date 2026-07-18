---
name: dev-workflow
description: Development workflow for everything-dev projects using bos dev, bos start, and the Module Federation runtime. Use when starting dev servers, debugging hot reload, or understanding the service-descriptor architecture.
metadata:
  sources: "packages/everything-dev/src/service-descriptor.ts,packages/everything-dev/src/orchestrator.ts,packages/everything-dev/src/dev-logs.ts,packages/everything-dev/src/dev-session.ts,packages/everything-dev/src/process-registry.ts,packages/everything-dev/src/app.ts"
---

# everything-dev Development Workflow

## Starting Development

```bash
# Typical: start development (host mode auto-detected)
bos dev

# Isolate work
bos dev --api remote     # UI only
bos dev --ui remote      # API only
bos dev                  # Full local (rarely needed)

# Pin individual service ports (unset flags are picked automatically and persisted)
bos dev --port 3100 --api-port 3101 --ui-port 3103 --auth-port 3102 --plugin-port-start 3110
```

### Port persistence

`bos dev` writes the resolved host/api/ui/auth/plugin-port-start values to `.bos/infra-state.json`
under a `devPorts` key. Subsequent runs reuse the same ports unless you pass an explicit flag
(or delete the file). This keeps CORS, browser bookmarks, and wallet-allowlisted origins stable
across restarts.

### Port budgets (forward-compat for `--workspaces`)

`prepareDevelopmentRuntimeConfig` accepts an optional `portBudget: { min, max }`. When set,
`pickAvailablePort` skips candidates outside the budget and throws `RangeError` if no free port
is found inside it. The standalone `bos dev` path does not pass a budget today; a future
`bos dev --workspaces` orchestrator will slice disjoint budgets per child project.

## Port Assignments

| Service | Default | URL |
|---------|---------|-----|
| host | 3000 | http://localhost:3000 |
| api | 3001 | http://localhost:3001 |
| auth | 3002 | http://localhost:3002 |
| ui | 3003 | http://localhost:3003 |
| ui-ssr | 3004 | http://localhost:3004 |
| plugins | 3010+ | http://localhost:3010+ (incremental — one per plugin in config order) |

## Service-Descriptor Architecture

The orchestrator builds a `ServiceDescriptorMap` from `bos.config.json`. Each descriptor defines:
- `key` — service identifier (host, ui, api, auth, plugin:*)
- `source` — `"local"` or `"remote"` (determines if process is spawned or URL is probed)
- `port` / `defaultPort` — TCP port for local services
- `readinessPath` — HTTP path for readiness probes (e.g., `/health`, `/remoteEntry.js`)
- `readyPatterns` / `errorPatterns` — Regexes matched against stdout/stderr

The orchestrator:
1. Spawns local services via `bun run dev` in each package directory
2. Probes remote services via HTTP GET to their readiness path
3. Tracks process state: pending → starting → ready → error
4. Writes logs to `.bos/logs/{service}.log`

## Hot Reload

- **UI changes**: Rsbuild HMR — instant at :3003, no rebuild
- **API changes**: Rspack HMR — instant at :3001, no rebuild
- **Auth / Plugin changes**: No HMR — require full restart (`bos kill && bos dev`)
- **SSR (ui-ssr)**: No HMR — restart required after UI changes
- **Config changes**: Require host restart (`bos kill && bos dev`)

## Contract Sync & Type Generation

Plugin types are auto-generated from `bos.config.json` via `bos types gen`:

```bash
bos types gen   # Regenerate ui/src/lib/api-types.gen.ts and api/src/lib/plugins-types.gen.ts
```

**When it auto-runs:**
- `bun install` (postinstall hook)
- `bun typecheck`
- `bos dev` startup
- `bos build`, `bos deploy`, `bos publish`
- `bos pluginAdd` / `bos pluginRemove`

**How plugin types are resolved:**
1. `local:plugins/<name>` → reads `src/contract.ts` directly from disk
2. Remote URL → fetches contract types from the deployed plugin's manifest
3. Missing local path with no URL → skipped with a warning

**Source of truth:** `bos.config.json`. If a plugin is listed there, its routes appear on `ApiContract`. If removed, TypeScript catches stale usage.

**After hand-editing `bos.config.json`:** Run `bos types gen` or restart `bos dev` to pick up changes.

## Runtime Config Loading

The host reads `BOS_RUNTIME_CONFIG` at startup (resolved from `bos.config.json` by the CLI). `ConfigService` is an immutable Effect Layer — every service is built from that one snapshot.

**Override for testing**: Set `BOS_RUNTIME_CONFIG` env var to a JSON string or file path to bypass config loading from disk. Useful for testing with different configs without modifying `bos.config.json`.

On page refresh:
1. Browser re-fetches HTML shell from host
2. Host injects current config into `window.__RUNTIME_CONFIG__`
3. Module Federation container re-initializes from fresh `remoteEntry.js`

This means a new deployment requires a host restart to pick up new URLs.

### Resolved Config (`.bos/bos.resolved-config.json`)

`bos dev` and `bos build` write the fully-merged config to `.bos/bos.resolved-config.json` (gitignored). This file includes `_resolved` metadata with env, timestamp, and extends chain.

**`bos.config.json` is NOT modified during dev.** Only `bos publish --deploy`, `bos plugin publish/add/remove`, and `bos sync` write to `bos.config.json`.

Build configs (rsbuild/rspack) read from `.bos/bos.resolved-config.json` first, falling back to `bos.config.json`. This allows slim child configs with `extends` to work correctly — the merged parent+child config is what the build sees.

## Debugging

```bash
bos ps                    # List running processes + ports
bos status                # Check remote health
bos info                  # Show current configuration
ls .bos/logs/             # Available log files
cat .bos/logs/api.log     # API process logs
```

### Port Conflicts

If a port is already in use, the local service fails to start. Check what's on the port:

```bash
lsof -i :3003             # Check what is using port 3003
```

Kill the conflicting process and retry, or stop the existing `bos dev` session first.

### Stale PID registry

If `bos kill` doesn't run cleanly (e.g., terminal was closed), stale entries can linger in the
global registry at `~/.cache/everything-dev/pids.json`. `bos ps` and `bos kill` always prune
ESRCH (dead) PIDs on read, so stale entries don't block restart — but you can wipe the file
manually if you want a clean slate:

```bash
rm ~/.cache/everything-dev/pids.json   # Clear global registry
bos dev                                # Start fresh
```

### API not responding

1. `bos ps` — is API running?
2. `.bos/logs/api.log` — startup errors?
3. `curl http://localhost:3001/remoteEntry.js` — is the entry accessible?

### UI not loading

1. Check browser console for Module Federation errors
2. `bos.config.json` — is `app.ui.development` correct?
3. Clear browser cache and hard reload (Cmd+Shift+R)
4. Verify UI SSR restart if using SSR

### Module Federation errors

- Verify shared dependency versions match across package.json files
- Clear browser cache (Cmd+Shift+R)
- Check `bos.config.json` URLs are accessible

## Production Mode

```bash
bos start --no-interactive                    # All remotes, production URLs
bos start --env staging --no-interactive      # Staging environment
bos start --account foo.near --domain bar.com # Load specific config
```

## Process Management

```bash
bos ps                       # List tracked development processes (cwd's entries, with role/ports)
bos kill                     # SIGTERM processes owned by cwd
bos kill --all               # SIGTERM across all config directories
bos kill --signal SIGKILL    # Force kill (cwd)
bos kill --config-dir /path  # Target a specific project
```

The registry lives at `~/.cache/everything-dev/pids.json`, keyed by `pid`. Each entry stores
`configDir`, `role` (`standalone` today; `workspace-parent`/`workspace-child` reserved for the
planned `bos dev --workspaces` orchestrator), `ports`, optional `budget`, `startedAt`, and
`description`. `bos dev` registers on startup and unregisters on graceful shutdown; the
`BOS_WORKSPACE_CHILD=1` env var suppresses standalone registration so a future parent
orchestrator owns registry entries.

Process tracking uses `~/.cache/everything-dev/pids.json` (global, atomic writes).
