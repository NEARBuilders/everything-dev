---
"everything-dev": minor
"every-plugin": minor
---

The database seam (ADR 0033): `everything-dev/db` gains `databaseLayer(tag, url, { pluginId, schema, migrations?, namespace? })` — the plugin author's whole database surface (driver acquireRelease, migrate-on-boot with the journal-scoped advisory lock, drift detection) providing the typed drizzle db on the plugin-owned tag, which is the swap seam: a different drizzle setup or a totally different storage situation is any other Layer for your own tag. `PluginInitializeInput` gains `pluginId: string` (the host's own id — no more `PluginIdTag` reads in plugin code; the tag stays provided for children's vendored layers). All workspaces' `src/db/` shrinks to a ~15-line plugin-owned `db/layer.ts` with namespaced tag ids (`"votes/Database"` etc.) — `src/db/index.ts` and `src/db/migrate.ts` are folded in and deleted, and `lib/context.ts` joins the db paths in leaving the sync-owned inventory (the drizzle-kit config stays owned — identity-driven wiring carrying journal policy). No codemod: existing children's trio copies keep working; port via the prompt in `everything-dev#init-upgrade`.
