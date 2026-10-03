---
"everything-dev": patch
"host": patch
---

Dev-stack origin/precedence fixes, log ergonomics, and composed-SSR hardening.

- **Generated env wins at spawn time**: the planner's `envGenerated` (CORS_ORIGIN, DB URLs) is now provided to the orchestrator and overlaid on the spawned services' env — a stale `CORS_ORIGIN` pinned in `.env` can no longer break Better Auth's trusted origins when dev ports drift (e.g. host on :3008 while `.env` says :3000, which made every post-login session check fail with "Something went wrong before the app layout could render").
- **bos-owned `.env` lines auto-refresh** on port drift (only keys the generator owns; user-added lines untouched), with a `[env]` log line per change. `loadProjectEnv` now runs before the env merge so preflight sees the real values.
- **Auth origin diagnostics**: the host logs the effective Better Auth origin + trustedOrigins at boot and warns when `CORS_ORIGIN` does not include the host origin.
- **SSR error visibility**: every SSR response carries an `x-request-id`; composition/stream failures log it, the CSR-shell fallback renders it, and the router's `defaultOnCatch` logs caught render errors server-side. The shell also escapes the error message and page title (HTML injection).
- **Manifest fetch cache**: remote plugin manifests are TTL-cached (30s) with a last-good snapshot fallback — one flaky plugin host no longer 500s every SSR request, and the digest variant cache no longer sits behind per-request fetches.
- **Variant cache invalidation**: composed SSR variants key on the structural digest PLUS a deployment fingerprint (SSR integrity in prod, local manifest mtime in dev), so code-only redeploys and dev rebuilds recompose instead of serving a stale tree forever. A server-side digest cross-check fails loudly if the engine's digest disagrees with the manifest inputs.
- **Share-scope + module-cache fixes**: expose loads bypass the MF runtime module cache when a remote's entry URL changed (no more mixed-version composed trees after integrity bumps), and share-scope initialization is serialized across concurrent loads.
- **Composition guards**: cross-plugin path collisions under the same parent are hard errors (also enforced per-workspace at manifest generation, as the generator docblock always claimed), and layout routes declaring options composition would drop (loader/beforeLoad/head/staticData) fail loudly instead of being silently ignored.
- **Log ergonomics**: multi-line log entries are prefixed per line in `.bos/logs` (Effect's pretty-printed JSON no longer breaks the `[source]` prefix), MF registration/constructor spam is demoted out of logs and the TUI unless `DEBUG=1`, and a new `bos logs [service] [--follow] [--tail N]` command reads the dev session log.
