---
"everything-dev": minor
---

`bos clean` — the local-only rule's exit valve (ADR 0047, #844)

One command that removes regenerable `.bos` state and refuses the artifacts that are truth or identity:

- **Removes**: `logs/` (except files touched within the last hour — a live session is appending), `bundles/` (regression container staging), `regression/` (seeds + image staging), `generated/`, `bundle-cache/`, `snapshot/`, `sync-backup/`, `import-backup/`, `compose-retired/`, `manifest.json` (release-manifest cache), `bos.resolved-config.json`, `build-cache.json`.
- **Never touches**: `db/` (PGlite data), `session.json` (credentials — that's `bos logout`), `infra-state.json` (machine port prefs), `deploy-state.json` (cleaning the skip-unchanged accelerator would silently cost full re-uploads). The guarded set is reported as `kept` with its reason.
- `--dry-run` reports per-category bytes without deleting; `--config-dir` targets another checkout.
- Route `POST /clean` in the CLI contract; the partition (`planClean`/`executeClean` in `services/clean.ts`) is the unit-tested contract surface.
