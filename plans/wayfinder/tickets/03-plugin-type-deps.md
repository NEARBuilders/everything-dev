## Question

When plugin `dashboard` depends on plugin `registry`'s oRPC contract types at build time, how does it get them?

Current state (v1): `api/src/lib/plugins-types.gen.ts` is generated from `bos.config.json`, merging all plugin contracts into one file. All plugins import from this generated file. This works because all plugins share the same repo and build context.

In v2, plugins are independently deployed. `dashboard`'s web remote is built separately from `registry`'s backend. Yet `dashboard` needs typed access to `registry.listApps()`, `registry.getApp()`, etc.

Options to evaluate:
1. **Contract types published to a registry** — each backend plugin publishes its contract types (`.d.ts`) to a package registry (npm or a custom types registry). `dashboard` depends on `@everything/plugin-registry` as a devDependency. Pro: standard npm resolution. Con: version drift, publish step overhead.
2. **`app.ts` context types via virtual module** — `app.ts` resolves all plugin contracts at build time and produces a virtual module (`#every-plugin-types` or similar). The build tool (rsbuild) injects this as a virtual import. `dashboard` imports from `everything-dev/types` which resolves to the virtual module. Pro: single source of truth, types always match runtime composition. Con: custom build plugin needed.
3. **Effect.ts Tag-based contracts** — instead of importing types directly, plugins depend on `Context.Tag` values. `dashboard` does `yield* RegistryService` where `RegistryService` is a `Context.Tag` resolved at runtime by the host's composed Layer. Pro: Effect.ts idiomatic, no build-time type coupling. Con: only works for backend plugins (Effect services), not for web plugin routes.
4. **Type-only imports from published module** — each plugin exposes a `contract` export from its MF remote. `dashboard` imports `type { RegistryContract } from "registry/contract"`. The types exist at build time via npm link/workspace, but at runtime the MF remote supplies the implementation. Pro: simple. Con: requires build-time workspace linking for type resolution.

Key sub-questions:
- Do web plugins (not backend) need typed access to backend plugin contracts? Or only the host needs that?
- For full-stack plugins (plugins with both `src/` and `web/`), does the `web/` side need types from the `src/` side of other plugins?
- Can we use Effect.ts `Context.Tag` patterns to make plugin dependencies explicit and composable without codegen?
