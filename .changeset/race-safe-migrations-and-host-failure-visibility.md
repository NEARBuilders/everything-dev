---
"everything-dev": patch
"host": patch
---

Make host/plugin failures visible and stop one failed plugin from taking down the API.

Production incident: at boot, `proposals`/`votes`/`template` plugins failed their `CREATE SCHEMA IF NOT EXISTS "drizzle"` migration on the shared journal schema (concurrent boot migrations race on `pg_namespace`; `IF NOT EXISTS` is not race-safe). The API plugin then died because its initialize unconditionally called the failed template plugin's client factory (failed plugins get a throwing stub). The host served `/api/*` as 503, so the BindingResolver's self-fetch of `/api/tenants/bindings` failed and every tenant-domain request (e.g. `chicago.citynode.app`) broke, while Railway healthchecks stayed green.

- API plugin initialize now tolerates failed dependency plugins: the template client is optional and template-backed routes return their existing clean "not included in this deployment" errors instead of crashing the whole API.
- Journal migration init (`CREATE SCHEMA`/`CREATE TABLE`) is retried with backoff and tolerates duplicate-object/unique-violation races in `api`, `proposals`, `votes`, and the `_template` scaffold (shared `isRetryableMigrationError` predicate in `everything-dev/db`).
- `/health` now returns a JSON summary (`status`, `api`, `auth`, error detail) instead of hardcoded `OK` — always 200, so Railway healthchecks stay green and the UI keeps serving, but the degraded state is observable.
- When the API plugin fails to load, the host logs a prominent startup banner listing available/failed plugins and the consequences (all `/api/*` → 503, tenant bindings unavailable), and the `/api/*` 503 stub body now includes the plugin-load error detail.
- BindingResolver failure handling: HTTP 503 from `/api/tenants/bindings` is reported as "API plugin is not available on this host" with a pointer to `/api/_health`, failures are negative-cached for 10s to avoid refetch storms, and stale bindings are still served when available.
- Plugin bootstrap errors are never empty again: `unwrapErrorMessage` falls back through error name, `_tag`/JSON, and finally `"unknown error"`, and any plugin declaring a `*_DATABASE_URL` secret now gets a masked DB-URL hint in the failure log (previously auth/API only).
