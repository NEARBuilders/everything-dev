<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/devtools#devtools-app-setup"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-app-setup"
    for: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
  - id: "@tanstack/devtools#devtools-marketplace"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-marketplace"
    for: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
  - id: "@tanstack/devtools#devtools-plugin-panel"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-plugin-panel"
    for: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
  - id: "@tanstack/devtools#devtools-production"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-production"
    for: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
  - id: "@tanstack/devtools-event-client#devtools-bidirectional"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-bidirectional"
    for: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
  - id: "@tanstack/devtools-event-client#devtools-event-client"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-event-client"
    for: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
  - id: "@tanstack/devtools-event-client#devtools-instrumentation"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-instrumentation"
    for: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
  - id: "better-near-auth#client"
    run: "bunx @tanstack/intent@latest load better-near-auth#client"
    for: "Set up the siwnClient plugin for Better Auth client, configure NEAR wallet connection via NearConnect, use authClient.near actions for sign-in, profile lookup, account management, delegate action building with TransactionBuilder, and relay submission. Load when implementing NEAR wallet sign-in on the client, using authClient.near.* methods, or building delegate actions for gasless relay."
  - id: "better-near-auth#relay"
    run: "bunx @tanstack/intent@latest load better-near-auth#relay"
    for: "Configure the gasless NEP-366 delegate action relayer in ephemeral or explicit mode, relay signed delegate actions on-chain, enforce contract whitelisting and gas/deposit limits, check relay status and history, and use the contract view endpoint. Load when setting up relayer config, debugging relay failures, or configuring RotatingKeyStore for high-throughput relay."
  - id: "better-near-auth#siwn"
    run: "bunx @tanstack/intent@latest load better-near-auth#siwn"
    for: "Set up the SIWN server plugin for Better Auth, configure NEP-413 authentication with recipient and API key, handle nonce generation, signature verification, account linking and unlinking, and NEAR profile lookup. Load when adding NEAR wallet sign-in to a Better Auth server, configuring siwn() plugin options, or debugging NEP-413 verify or nonce issues."
  - id: "better-near-auth#tanstack"
    run: "bunx @tanstack/intent@latest load better-near-auth#tanstack"
    for: "Integrate better-near-auth with TanStack Router (SSR or CSR). Set up auth client as a router context singleton, useAuthClient hook, session query options, inferred types from AuthClient, and ensureConnected before signing. Load when scaffolding a new TanStack Router app with better-near-auth, wiring auth into router context, or debugging wallet state loss after sign-in in SSR/CSR TanStack apps."
  - id: "dotenv#dotenv"
    run: "bunx @tanstack/intent@latest load dotenv#dotenv"
    for: "Load environment variables from a .env file into process.env for Node.js applications. Use when configuring apps with secrets, setting up local development environments, managing API keys and database uRLs, parsing .env file contents, or populating environment variables programmatically. Always use this skill when the user mentions .env, even for simple tasks like \"set up dotenv\" — the skill contains critical gotchas (encrypted keys, variable expansion, command substitution) that prevent common production issues."
  - id: "dotenv#dotenvx"
    run: "bunx @tanstack/intent@latest load dotenv#dotenvx"
    for: "Use dotenvx to run commands with environment variables, manage multiple .env files, expand variables, and encrypt env files for safe commits and CI/CD."
  - id: "every-plugin#plugin-client"
    run: "bunx @tanstack/intent@latest load every-plugin#plugin-client"
    for: "Connect to and consume deployed everything.dev plugins from an external app, child project, or script. Use when creating API/auth clients, reading runtime config, authenticating with API keys or sessions, or calling plugin routes programmatically."
  - id: "every-plugin#plugin-development"
    run: "bunx @tanstack/intent@latest load every-plugin#plugin-development"
    for: "Build every-plugin modules with oRPC contracts, Effect services, and Module Federation. Use when creating or modifying plugins under plugins/ or the _template scaffold."
  - id: "every-plugin#plugin-testing"
    run: "bunx @tanstack/intent@latest load every-plugin#plugin-testing"
    for: "Test every-plugin modules with vitest and the plugin runtime. Use when writing or modifying plugin tests under plugins/*/src/__tests__/ or plugins/*/tests/."
  - id: "everything-dev#api-and-auth"
    run: "bunx @tanstack/intent@latest load everything-dev#api-and-auth"
    for: "API architecture, oRPC contracts, auth middleware, plugin-client composition, session handling, and client-side auth. Use when adding API routes, creating middleware, calling other plugins in-process, or integrating auth in routes and UI."
  - id: "everything-dev#cli-reference"
    run: "bunx @tanstack/intent@latest load everything-dev#cli-reference"
    for: "Quick reference for all bos CLI commands — flags, options, environment settings, and links to detailed guidance in related skills. Use when any bos command comes up or the user needs a CLI overview."
  - id: "everything-dev#code-style"
    run: "bunx @tanstack/intent@latest load everything-dev#code-style"
    for: "Code style conventions for everything-dev projects — component file naming (kebab-case, lowercase), CSS (semantic Tailwind only, no hardcoded colors), no comments in implementation, import/export conventions, and following neighboring file patterns."
  - id: "everything-dev#dev-workflow"
    run: "bunx @tanstack/intent@latest load everything-dev#dev-workflow"
    for: "Development workflow for everything-dev projects using bos dev, bos start, and the Module Federation runtime. Use when starting dev servers, debugging hot reload, or understanding the service-descriptor architecture."
  - id: "everything-dev#extends-config"
    run: "bunx @tanstack/intent@latest load everything-dev#extends-config"
    for: "How bos.config.json extends chains work, deep merge semantics, resolved config lifecycle, env-specific extends, and canonical field ordering. Use when debugging extends inheritance, configuring per-environment parents, understanding what dev writes vs publish writes, or reasoning about config merging."
  - id: "everything-dev#init-upgrade"
    run: "bunx @tanstack/intent@latest load everything-dev#init-upgrade"
    for: "bos init, bos sync, and bos upgrade workflows — template download, snapshot-based conflict detection, package version bumps, and how init/sync select and own files. Use when scaffolding new projects, syncing upstream changes, or upgrading framework packages."
  - id: "everything-dev#plugin-development"
    run: "bunx @tanstack/intent@latest load everything-dev#plugin-development"
    for: "Build, register, and deploy plugins within everything.dev. Covers the _template scaffold, contract/service/index pattern, database setup with Drizzle, bos.config.json registration, plugin UI, and CLI workflow. Use when creating new plugins, adding database-backed routes, or deploying plugins to production."
  - id: "everything-dev#publish-sync"
    run: "bunx @tanstack/intent@latest load everything-dev#publish-sync"
    for: "Publish bos.config.json to the FastKV registry, sync from upstream, and upgrade workspace packages. Use when deploying, syncing, or managing runtime configuration across projects."
  - id: "everything-dev#super-app"
    run: "bunx @tanstack/intent@latest load everything-dev#super-app"
    for: "Build shared-host, shared-API super apps with tenant-specific UI composition. Use when setting up a base runtime plus custom tenant apps, configuring fixed-core multi-tenancy, reasoning about extends-based runtime lineage, or deciding what tenants can override today."
  - id: "everything-dev#ui-integration"
    run: "bunx @tanstack/intent@latest load everything-dev#ui-integration"
    for: "Route creation, API client usage, auth client, SSR hydration, and the @/app module surface. Use when adding new UI routes, fetching data from the API, implementing auth flows, or customizing navigation."
<!-- intent-skills:end -->

# Agent Instructions

This document provides operational guidance for AI agents working in the parent `everything.dev` repository.

## Quick Reference

**Start Development:**
```bash
cp .env.example .env   # First time only
bun install
bun run dev

# Pin individual service ports (unset flags are auto-picked and persisted in .bos/infra-state.json)
bos dev --port 3100 --api-port 3101 --ui-port 3103 --auth-port 3102 --plugin-port-start 3110
```

Dev ports are persisted to `.bos/infra-state.json` under `devPorts` and reused across restarts.
`CORS_ORIGIN` in `.env.example` is derived from the actual resolved host port in development.
A global PID registry at `~/.cache/everything-dev/pids.json` tracks running `bos dev` sessions.

**Sync and Publish:**
```bash
bos sync              # Pull updates from published config/template state
bos upgrade           # Check for new versions, update, then sync
bos publish           # Publish config to the FastKV registry
bos publish --deploy  # Build/deploy all workspaces, then publish
```

**Check Status:**
```bash
bos ps        # List tracked development processes (PID, role, ports, age)
bos kill      # SIGTERM processes owned by the cwd
bos kill --all              # SIGTERM across all config directories
bos kill --signal SIGKILL    # Force kill
bos status    # Project health check
bos info      # Show configuration
```

## Architecture

This is the parent **Module Federation monorepo** for `everything.dev`. The host is in this repository under `host/`. You may work across `/host`, `/ui`, `/api`, `/plugins`, and `/packages`.

```
┌─────────────────────────────────────────────────────────┐
│                    Host (Server)                        │
│  - Hono.js + oRPC router                               │
│  - Runtime config loader (bos.config.json)              │
│  - Module Federation host                               │
│  - every-plugin runtime                                │
└─────────────────────────────────────────────────────────┘
            ↓                ↓                ↓
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│       UI         │ │  Auth Plugin     │ │  API + Plugins   │
│  - React 19      │ │  - every-plugin  │ │  - every-plugin  │
│  - TanStack      │ │  - Better-Auth   │ │  - oRPC contract │
│  - Module Fed.   │ │  - NEAR SIWN     │ │  - Effect svc    │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

The host loads UI and API at runtime from URLs in `bos.config.json`. In production today, the host still boots one base `RuntimeConfig` snapshot at startup, but it can resolve tenant-specific UI overrides per request while keeping the server core fixed.

### Runtime Config

All runtime configuration lives in `bos.config.json`. The UI reads `window.__RUNTIME_CONFIG__` to get account, gateway, API base URL, etc. The host uses the same config to wire Module Federation remotes, auth, plugins, and SSR.

Use these helpers from `@/app`:
- `getAppName()` — active runtime title (falls back to account)
- `getAccount()` — NEAR account from config
- `getRepository()` — repository URL from config
- `getActiveRuntime()` — active runtime info (accountId, gatewayId, title)
- `getRuntimeConfig()` — full client config

Important: fixed-core tenant runtime composition now lives primarily in:
- `host/src/services/tenant-runtime.ts`
- `host/src/program.ts`
- `host/src/services/federation.server.ts`

Tenant model:
- `extends` is the lineage edge between runtimes
- `account` is the tenant namespace root for the active runtime
- `domain` is the public ingress for that runtime
- a runtime can extend another runtime and still become a new tenant root on its own domain

Current fixed-core host rules:
- the shared host still boots once from one base runtime snapshot
- child runtime config must extend the active BOS runtime
- supported request-scoped overrides are `ui` and existing `plugins.<id>.ui`
- tenant SSR is gated by `TENANT_WHITELIST` and `ALLOW_UNTRUSTED_SSR`
- nested label routing and account-relative tenant derivation are the intended architecture direction, but not the complete resolver behavior today

For full per-request host/plugin/auth/api swapping, start from `plans/runtime-config-hot-swap.md`.

## Development Workflow

### Typical Session
1. `bun run dev` to start development
2. UI available at http://localhost:3003, API at http://localhost:3001, Auth at http://localhost:3002
3. Check `.bos/logs/` for process logs if issues occur
4. Use `bos kill` to clean up processes when done

### Debugging Issues

**API not responding:**
- Check `bos ps` to see if API process is running
- Check `.bos/logs/api.log` for errors

**UI not loading:**
- Verify host is running: `bos ps`
- Check browser console for Module Federation errors
- Clear browser cache and retry

**Type errors:**
- Run `bun typecheck`
- Ensure `api/src/contract.ts` is in sync with UI usage

## Code Changes

### Making Changes
- **Host Changes**: Edit `host/src/` when changing runtime resolution, auth wiring, SSR, proxying, or plugin mounting
- **UI Changes**: Edit `ui/src/` files → hot reload automatically
- **API Changes**: Edit `api/src/` files → hot reload automatically
- **CLI/Scaffolding Changes**: Edit `packages/everything-dev/` when changing init/dev/publish flows or child-project scaffolding
- **New Components**: Create in `ui/src/components/ui/`, export from `ui/src/components/index.ts`
- **New Routes**: Create file in `ui/src/routes/`, TanStack Router auto-generates tree

### Style Requirements
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `text-muted-foreground`
- No hardcoded colors like `bg-blue-600`
- No code comments in implementation
- Component file naming: lowercase kebab-case (`data-table.tsx`, `user-profile.tsx`)
- File/directory naming: kebab-case for all files and directories
- Follow existing patterns in neighboring files

### Adding API Endpoints
1. Define in `api/src/contract.ts` — the oRPC route definitions and Zod schemas
2. Implement in `api/src/index.ts` — the `createRouter` function
3. Use in UI via `apiClient` from `useApiClient()` in `@/app`

### Plugin Architecture

Business logic is organized into independent plugins loaded via Module Federation:
- **`api/`** — Thin structural shell: ping, authHealth, error routes, middleware definitions
- **`plugins/auth/`** — Authentication and authorization (Better-Auth, NEAR SIWN, organizations, API keys)
- **`plugins/registry/`** — FastKV app discovery, metadata publish/relay (no database)
- **`plugins/projects/`** — Project and organization management
- **`plugins/_template/`** — Scaffold for creating new plugins

Each plugin is self-contained with its own:
- `contract.ts` — oRPC route definitions and Zod schemas
- `index.ts` — `createPlugin` with variables, secrets, context, router
- rspack config for independent deployment

The UI accesses plugin routes via namespaced clients: `apiClient.registry.listRegistryApps()`, etc.

### Plugin Client (pluginsClient)

The API plugin receives typed client factories for all other plugins via `createPlugin.withPlugins<PluginsClient>()`, enabling in-process composition without HTTP roundtrips.

**Two-phase loading**: The host loads non-API plugins first (Phase 1), creates a `pluginsClient` map, then loads the API with that map injected (Phase 2). The host is generic — no plugin-specific code.

**Generated types**: `api/src/lib/plugins-types.gen.ts`, `api/src/lib/auth-types.gen.ts`, `ui/src/lib/api-types.gen.ts`, and `ui/src/lib/auth-types.gen.ts` are generated by `bos types gen` from `bos.config.json`. These files are gitignored and auto-regenerated on `bun install`, `typecheck`, `bos dev`, `bos build`, and `bos pluginAdd`/`pluginRemove`.

Plugin types resolve in two ways:
- `local:plugins/<name>` → reads `src/contract.ts` directly from disk
- Remote URL → fetches bundled types from the deployed plugin manifest

If you hand-edit `bos.config.json`, run `bos types gen` or restart `bos dev` to regenerate.

## Parent vs Child

This repo is the parent platform, not a generated child project.

- Prefer changing `host/` and `packages/everything-dev/` when the request is about runtime resolution, domain routing, config loading, CLI behavior, or scaffolding.
- Prefer changing child project repos when the request is about project-specific content, shell navigation, or app-specific plugin composition.
- Do not assume the host is remote-only or out of tree; that is true for many child repos, not for this one.

## Changesets

**When to add a changeset:**
- Any user-facing change (features, fixes, deprecations)
- Breaking changes
- Skip for: docs-only changes, internal refactors, test-only changes

**Release flow:**
- Parent repo production releases run through `.github/workflows/packages-release.yml`, which creates or updates the `chore: version packages` PR when changesets are pending.
- After that version PR is merged, `packages-release.yml` calls `.github/workflows/release.yml`, which runs `bun run deploy`, publishes `bos.config.json` to FastKV, and commits the updated deployment URLs.
- Generated child repos use the same `CI` -> `Packages Release` -> `Release` pattern, but only version and deploy their local workspaces and runtime surfaces.

**Create changeset:**
```bash
bun run changeset
# Follow prompts to select packages and describe changes
```

## Testing & Quality

**Before committing:**
```bash
bun run test    # Run all tests
bun typecheck   # Type check all packages
bun lint        # Run linting
```

## Common Patterns

### Authentication Check
Routes requiring auth use `_authenticated.tsx` layout:
```typescript
export const Route = createFileRoute('/_layout/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } });
    }
  },
});
```

### API Middleware (Server-side)
Routes requiring auth use typed middleware that narrows the request context —
no non-null assertions needed:

```typescript
import { createAuthMiddleware } from "./lib/auth";

const { requireAuth } = createAuthMiddleware(builder);

builder.myRoute.use(requireAuth).handler(async ({ input, context }) => {
  context.userId; // string — narrowed by middleware
  context.user;   // RequestAuthUser — non-null after requireAuth
});
```

Available middlewares: `requireAuth`, `requireAuthOrApiKey`, `requireRole`,
`requireAdmin`, `requireOrganization`, `requireOrgRole`, `requireApiKey`.
Pass an optional Zod schema for org metadata: `createAuthMiddleware(builder, { orgMetaSchema })`.

### API Client Usage
```typescript
import { useApiClient } from "@/app";

function MyComponent() {
  const apiClient = useApiClient();
  const { data } = await apiClient.ping();
  const { data } = await apiClient.registry.listRegistryApps({ limit: 24 });
}
```

### App Name in UI
```typescript
import { getAppName } from "@/app";

// In a component (client-side only)
const appName = useClientValue(() => getAppName(), "app");

// In a head() function (server-side, from loaderData)
const { runtimeConfig } = Route.useLoaderData();
const appName = getActiveRuntime(runtimeConfig)?.title ?? getAccount(runtimeConfig);
```

## Security

### Shared Singleton Trust Model

Module Federation shares React, TanStack Query, and TanStack Router as singletons across remotes. A compromise of these packages affects all remotes simultaneously. Defense:

- **Catalog pinning** — versions are locked in root `package.json` catalogs. Bump versions deliberately, not reactively.
- **Renovate `minimumReleaseAge`** — 3 days general, 5 days for `@tanstack/*`. Malicious versions detected within hours are blocked from auto-merge.
- **Minor bumps never automerged** — supply chain attacks typically ship as minor version bumps. All minor updates require manual review.

### Dependency Security

- **Renovate** manages dependency updates for this parent repo (not Dependabot). Config: `.github/renovate.json`. New generated child repos no longer scaffold that config by default.
- **`--ignore-scripts`** — all CI workflows use `bun install --frozen-lockfile --ignore-scripts`. Lifecycle scripts (the TanStack attack vector) never execute during install.
- **Renovate `vulnerabilityAlerts`** — enabled in `.github/renovate.json`, opens PRs for dependencies with known vulnerabilities.
- **`bun audit`** runs in CI on every push, PR, and manual dispatch. It fails the build on critical/high findings only when the `AUDIT_STRICT=true` GitHub secret is set; otherwise it emits a warning.
- **GitHub Actions pinned to commit SHAs** — all `uses:` references are SHA-pinned to prevent tag-hijacking attacks (e.g. tj-actions).

### Supply Chain Incident Response

If a dependency is compromised:

1. **Catalog pin protects all remotes** — all workspaces resolve from the same catalog, so pinning one version secures everything.
2. **Independent deployment enables instant containment** — update the compromised remote's URL in `bos.config.json` and publish. No host rebuild needed.
3. **On-chain config is verifiable** — `bos.config.json` is published to FastKV. URL changes are inspectable and auditable on-chain.
4. **Runtime isolation limits blast radius** — a compromised UI dep cannot access API database secrets or auth keys. Remotes run in separate processes.

### CI Hardening

- No `pull_request_target` in any workflow — prevents the "Pwn Request" cache-poisoning pattern used in the TanStack compromise.
- Secrets scoped to individual steps, not job-level env — limits exposure if any step is compromised.
- `id-token: write` removed from job-level permissions — only granted where explicitly needed.
- `permissions:` set to minimum required on every workflow.

## Troubleshooting

**Process won't start:**
```bash
bos kill        # Kill all tracked processes
bun install     # Ensure dependencies
bun run dev     # Restart
```

**Module Federation errors:**
- Check `bos.config.json` URLs are accessible
- Verify shared dependency versions match in package.json
- Clear browser cache

**Database issues:**
```bash
bun run db:push   # Push schema changes
bun run db:studio # Open Drizzle Studio
```

## Environment

**Required files:**
- `.env` - Secrets (see `.env.example`)
- `bos.config.json` - Runtime configuration (committed)

**Key ports:**
- 3003 - UI dev server
- 3001 - API dev server
