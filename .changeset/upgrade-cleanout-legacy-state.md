---
"everything-dev": minor
---

The upgrade migration deletes legacy state for real (issue #921): it absorbs a legacy `.bos/sync-snapshot.json` into `bos.lock.json`'s `template.sync` only after verifying the lock carries the baseline (an unparseable legacy file beside a lock without a baseline is left in place), deletes children's unowned `.changeset/` directories and scrubs their retired `changeset`/`version`/`release` scripts, and logs every deletion. `bos upgrade --dry-run` now previews the full cleanout plan (snapshot, `.changeset/`, retired scripts) before anything is written.
