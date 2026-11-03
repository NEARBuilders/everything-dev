---
"everything-dev": patch
---

Upgrade coherence: exact-pinned release catalogs, fail-loud install drift, a drizzle-config sync guarantee, and the retired postinstall typegen scrubs from child roots.

- The platform release manifest freezes its catalog to the exact versions the release was built with (workspace package versions for framework rows, lockfile resolutions for range rows; unknowable rows keep their authored range). Children install these rows verbatim, so `pnpm install --force` during `bos upgrade` can no longer float a framework package past the release its platform pin names — the mixed tree that synced rc.30 template bytes (calling the since-removed `drizzleCredentialsFor`) against rc.31 packages and failed every build. Both publish homes (FastKV + in-image) compose through the same `resolveExactCatalog`, keeping the byte-identity invariant.
- `bos upgrade` fails loud before the migration phase when the installed framework version escapes the release target, naming the drifted rows and the remedy; legacy range rows only violate when the installed version escapes the range, so pre-exact trees keep upgrading.
- Template sync now maps `plugins/<key>/drizzle.config.ts` for plugins that carry a config without `src/db` (config-only plugins were stranded on stale template bytes), and a guardrail test pins every plugin copy byte-identical to the api template.
- `migrateChildRootPackageJson` deletes the retired `postinstall: bos types gen` script by value on the next migration — it ran before the child's local workspace packages were built and crashed with a stack trace on every fresh install; `bos dev`/`build`/`typecheck` regenerate types.
