# 0044 — Per-identity PGlite data dirs

Date: 2026-11-05 · Status: accepted

## Context

ADR 0038 made the zero-config local database a persistent, file-backed PGlite
data dir and claimed the api and its in-process plugins could *share* one dir
(`pglite:.bos/db`), schema-isolated under `plugin_<slug>`. That topology is
corrupt (issue #787): PGlite is a single-connection, single-instance engine —
every instance keeps a private buffer cache and there is no cross-instance
coordination. The dev host loads all plugins in-process, each plugin's
`databaseLayer` opens its own driver for the process lifetime, and every
driver resolved the same relative default against the same cwd — so a fresh
scaffold ran 3–4 independent embedded Postgres backends on one set of
database files. Concurrent instances checkpoint stale pages over each other's
committed data, producing heap/index divergence: a unique-index entry
survives while its heap tuple is gone, so `SELECT` sees an empty table while
`INSERT` fails with `duplicate key` — first SIWN sign-in broke on an *empty*
`user` table, after multi-second stalls.

Two adjacent sharp edges:

- The scaffolded `.env` pinned every workspace to the same dir (the
  "frozen at init" contract), so operator `.env`s carried the corrupting
  shape verbatim.
- The relative default resolved against the process cwd, so plugin
  subprocesses (cwd = temp dir) silently got throwaway copies while the
  in-host instance persisted — undocumented and surprising.

## Decision

- **Every workspace opens its own data dir.** The default is
  `pglite:.bos/db/<slug>` (`pgliteDefaultUrlForSlug(slug)`; the slug matches
  the `pluginMigrationSlug`/`normalizeDatabaseSlug` naming used for schemas,
  journals, and secret names). Collisions are impossible by package-name
  uniqueness. The shared-database topology is unchanged where it was always
  real: plugin `*_DATABASE_URL` secrets fall back to `API_DATABASE_URL` on
  `postgres://`, with `plugin_<slug>` schema isolation and pooled
  connections coordinating server-side.
- **The driver refuses double-opens.** `createDatabaseDriver`'s pglite
  branch keeps a process-level registry of open data dirs, keyed by the
  decoded absolute path (`pglite:.bos/db/x`, `pglite:file:///abs/x`, and
  relative spellings of one dir all collide). A second concurrent open
  throws with a remediation message instead of corrupting silently;
  sequential close→reopen stays legal; in-memory instances are exempt (they
  never share state). The guard also decodes `file://` URLs before
  `mkdirSync` — handing the raw URL to mkdir created a literal `file:`
  junk directory (pre-existing bug, fixed here).
- **`bos dev` repairs the broken pins once.** When two or more
  `*_DATABASE_URL` secrets in `.env` share the legacy `pglite:.bos/db`
  literal, each is rewritten to its per-identity subdir — the same one-time
  idempotent repair pass as the compose-era migration. Only the exact legacy
  literal is rewritten; operator-authored pglite URLs are left alone, and a
  rewrite is skipped when its target dir is occupied by a pin that stays
  (a safe partial repair beats a new collision).
- **Preflight tripwire.** After the repair, any remaining composition where
  two or more secrets resolve to the same pglite dir fails `bos dev`
  preflight loudly. In-memory dirs are exempt.
- **The regression-env dev-data guard widens.** Any `pglite:.bos/db` URL —
  the bare root or any `<slug>` subdir — is refused as developer data.

## Consequences

- The zero-config pglite default is per-identity islands; cross-workspace
  data sharing goes through pluginsClient (in-process RPC), never direct
  cross-schema SQL — the only coordination that ever actually worked on
  pglite.
- `PGLITE_DEFAULT_URL` is now the layout *base* (`pglite:.bos/db`), kept for
  legacy-pin matching and repair; drivers must use
  `pgliteDefaultUrlForSlug`. The per-identity default is runtime resolution,
  so an explicit `.env` pin still wins.
- Cross-process sharing of one dir still relies on pglite's own file locking
  (tools vs a running dev stack). The guard is process-local by design; this
  ADR does not change the cross-process story.
- Tier-3 — one shared PGlite instance per dir with schema-qualified
  namespaces — remains the future direction if shared-dir topology on pglite
  is ever wanted: today's driver does session-level `SET search_path`, which
  would leak across plugins on a shared single connection. Sharing safely
  first needs transaction-scoped `search_path` or drizzle `pgSchema`.
- Surface changes: `PGLITE_DEV_DATABASE_URL` is gone (use
  `pgliteDefaultUrlForSlug(normalizeDatabaseSlug(secret))`); frozen plugin
  defaults, dev overlays, and scaffold templates pin per-identity dirs.

## References

- Issue #787 (repro, corruption signature, fix tiers).
- ADR 0038 (pglite-only local db — the data-dir topology is superseded
  here), ADR 0033 (db seam), ADR 0019 (migration journal locking).
