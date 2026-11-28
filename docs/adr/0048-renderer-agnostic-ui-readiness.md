# ADR 0048: UI renderer-agnostic readiness — Standard Schema contracts, logic seams, no renderer abstraction

Date: 2026-11-27
Status: Accepted

Depends on: ADR 0031 (package shape — contract → handlers → services), ADR 0037 (sonner shared singleton — the ui shared-deps list as the renderer coupling point), ADR 0023 (ui bootstrap stubs are generated), ADR 0008 (manifest composition — the host owns the route graph).

## Context

The ui plane is React 19 + TanStack Router/Query under Module Federation; the backend (api, plugins, host) is Effect v4-first (`effect: 4.1.4` catalog pin, TS 7 + Effect LSP, vendored effect). Two repositories were evaluated as a potential future UI renderer: Effect-TS/ui (`@effect/ui` — an Elm-architecture frontend on Effect v4: `Schema` models, tagged messages, pure `update`, `Query` data access, Layer-provided services, host-agnostic DOM/terminal/native renderers) and nstudio/ns-effect-ui (NativeScript/MasonKit hosts for it). `@effect/ui` is experimental — not on npm, installed as pkg.pr.new snapshots pinned to commit SHAs — and requires `exactOptionalPropertyTypes`; ns-effect-ui targets native platforms this framework does not ship. The full evaluation and migration-cost analysis live in `.scratch/effect-ui-readiness/OVERVIEW.md`.

The conclusion: not now, but the direction is coherent enough to prepare for — and most of the preparation is worth doing regardless, because it removes costs that exist today. A renderer swap's cost concentrates in five places: the contract language (Zod vs Effect Schema), data access inline in components, logic inlined in `.tsx` files, the jsdom component-test layer, and React-shaped auth/i18n bindings. Three of the five are fixable now with zero renderer risk, because the machinery is already renderer-neutral:

- oRPC accepts any Standard Schema library, and Effect Schema implements that spec (per oRPC's integration docs, via `Schema.toStandardSchemaV1`); `effect` 4.1.4 ships `Schema` in core and is already a catalog dependency of every workspace.
- `lib/queries/` modules exist (`ui/src/lib/queries/organizations.ts`, `ui/src/lib/team-workspace.ts`) but most call sites still build `useQuery`/`useMutation` inline in routes and components.
- Browser regression specs are behavioral (`data-testid`), and any DOM host — including a future Effect UI html host — renders the same Tailwind v4 utilities and the same testids.

## Decision

1. **Renderer is composition metadata, not architecture.** A remote is a named position in the composition that loads bytes from URLs; the shared-singleton list (ADR 0037's `UI_SHARED_DEPS`) is the only renderer coupling point, and its tolerant-entry mechanism is the template a mixed-renderer bridge period would use (add `effect`/`@effect/ui` to the ui list; rebuild remotes against it). We reserve the vocabulary — a remote's identity includes its renderer — in docs only. No manifest field, no host mechanism, no scaffold or skills changes until a second renderer exists.

2. **The contract layer standardizes on Effect Schema via Standard Schema**, migrated per-plugin starting with a pilot (`plugins/registry`). The oRPC contract/handler/client machinery is unchanged; only the schema library moves. Zod stays in place until a plugin migrates; `better-near-auth` and `every-plugin` Zod surfaces stay until upstream moves. The OpenAPI/MCP generation path must gain an Effect → JSON-Schema converter during the pilot — MCP tools are generated from the OpenAPI spec (`host/src/services/mcp.ts`), which today consumes Zod-derived schemas.

3. **Two seams become conventions now:** all server data access flows through `lib/queries/*` modules (queryOptions factories; no inline `useQuery` in routes or components), and state transitions / derived logic live in renderer-free modules (no React imports) tested in Node with Vitest.

4. **Test shape:** assertions prefer the bottom layer (Node tests of pure logic) or the top layer (behavioral browser specs via `data-testid`); the jsdom component-test layer shrinks to genuinely React-specific behavior. It is the only test layer a renderer swap deletes.

5. **Explicit non-goals:** no renderer-abstraction layer over React (an abstraction with one implementation is a permanent tax); no `exactOptionalPropertyTypes` enablement (required by `@effect/ui`; stays on the trigger list); no state-store migration (`zustand` is declared in `ui/package.json` with zero imports in `ui/src` — the dep is simply removed); no scaffold/skills/runtime-map mechanism work.

6. **Revisit triggers** for a future renderer-swap ADR (the actual migration decision, which this ADR deliberately does not make): `@effect/ui` lands on npm with SemVer (Renovate- and `minimumReleaseAge`-gateable); an Effect UI router reaching TanStack parity (guards, search-param validation, route masking); an i18n story to replace Lingui; `ui-kit` accessibility maturity vs base-ui/Radix.

## Consequences

- Swap-day cost drops to rewriting views and the shell against an unchanged logic core: contracts (2), data access (3), and logic (3) don't move. The runtime map's route graph stays the migration's unit of accounting.
- The server completes its Effect-native story now: one validation language across contract → handlers → services (ADR 0031), Effect LSP diagnostics on contract schemas, and services able to decode with the structs the contract declares.
- Two schema libraries coexist during the migration window. Each plugin's migration is small; the OpenAPI/MCP converter work is front-loaded into the pilot. Wire-compat matters: the pilot must demonstrate the migrated contract accepts and rejects the same inputs as the Zod one.
- Items 3 and 4 are conventions, not lint rules, until the pattern is established (write-once) — `docs/agents/testing.md` and the AGENTS.md patterns section carry them.
- ns-effect-ui stays on the watchlist, not the roadmap: it becomes relevant only if the platform ships native clients, and its Web/Native/Test platform-layer pattern (host-agnostic `Context.Service` definitions with per-host implementations) is borrowable today without the package.
