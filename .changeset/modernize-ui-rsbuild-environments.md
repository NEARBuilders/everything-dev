---
"everything-dev": patch
---

Modernize the ui plugin remote rsbuild configs to environments-based dual-target builds.

- `plugins/auth/ui` and the core `ui` workspace now use one `rsbuild.config.ts` with `environments: { web, node }`. The `web` environment emits `remoteEntry.js` (client MF remote); the `node` environment emits `dist/ssr/remoteEntry.server.js` (commonjs container for SSR composition). Both load through the official `@module-federation/rsbuild-plugin` — `target: "node"` applies the upstream SSR recipe (node runtime plugin, CJS container, `async-node` chunk loading) instead of hand-rolled rspack config.
- Shared singleton contracts unify on `createUiSharedDeps` (`react`, `react-dom`, `@orpc/*`, `@tanstack/react-query/router`), so the core ui remote now also enforces strict version identity (previously `strictVersion: false` locally).
- Client builds of the core `ui` remote and plugin ui remotes emit rspack `crossOriginLoading: "anonymous"`, so async-chunk load errors from cross-origin plugin remotes surface with real detail instead of a masked `Script error.`.
- Dev keeps two rsbuild dev processes (`--environment web` / `--environment node`): the SSR dev origin must be the artifact root — with one combined dev server the MF runtime anchors the node environment's `publicPath` at the shared origin root and the node chunks resolve onto the web environment's JSONP chunks (`self is not defined`). The dedicated `ui-ssr` / `plugin-ui-ssr:<id>` dev services and `uiSsr` port allocations remain.
- `packages/everything-dev` federation tests re-encode the shared-instance invariants (one composition instance per process; integrity bumps re-register the remote in place), and the regression browser suite gains a bounded composed-SSR readiness probe (`REGRESSION_SSR_PROBE_TIMEOUT_MS`, default 90s) for early, diagnostic exits when the stack cannot start.
