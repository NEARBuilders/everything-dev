---
"everything-dev": patch
---

Fix `db studio` for local plugins: `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.

drizzle-kit loads drizzle.config.ts through its bundled tsx CJS transform, which defines `import.meta.url` but not `import.meta.dirname` — so plugin configs derived their migration slug from `npm_package_name ?? "unknown"`, looked up a nonexistent secret (`UNKNOWN_DATABASE_URL`), and silently fell back to a `pglite:` pseudo-URL that the pg driver parsed into a passwordless connection.

The database tooling is rebuilt around explicit database identity:

- New pure primitives in `everything-dev/db`: `workspaceIdentityFromModuleUrl` / `workspaceIdentityFromWorkspaceDir` (slug, secret name, journal coordinates, workspace dir — derived once from the workspace `package.json`) and `resolveDatabaseUrl` (env → nearest `.env` → loud error for connection-requiring drizzle-kit commands → in-memory pglite placeholder only for `generate`/`check`).
- All workspace drizzle configs (`api`, `auth`, `proposals`, `votes`, `_template`) now derive identity from their own module location and fail loudly when the database secret is missing, instead of silently migrating an empty in-memory database.
- `DatabaseBindings` and `DrizzleKit` Effect services: typed resolution of plugin → database binding and a single spawn choke point that materializes the canonical secret into every drizzle-kit child process (also fixes the latent same bug in `db repair`).
- `bos db studio` now runs through the services; behavior of the CLI output is unchanged.
