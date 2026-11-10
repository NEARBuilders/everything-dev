---
"everything-dev": minor
---

One committed artifact — the lock absorbs the sync baseline (ADR 0047, #844)

- `bos.lock.json` gains an optional `template.sync` section (`{ syncedAt, files }`): the template sync baseline, absorbed from `.bos/sync-snapshot.json`. The annotation is carried forward by every writer (`bos lock`, the deploy train's persist leg), never produced by `lockfileOf`, and never enters the pointer or lockfile digest.
- `bos sync`/`bos upgrade` now conflict when a locally-modified template file has no recorded baseline — the previous fallback classified it `updated` and let the template win silently. The error names the remedies: `bos lock` + commit, or one `--force` (backed up).
- `bos upgrade`'s migration phase absorbs a legacy `.bos/sync-snapshot.json` into the lock and deletes the file (reported under migrated files). Lock-less repos keep the legacy file, now local-only.
- The template `.gitignore` drops the `.bos` negations — `.bos/` is local-only runtime state; the single committed artifact is `bos.lock.json`.
