---
"everything-dev": patch
---

Release-train sequence hardening: Deploy's preflight npm gate now waits for the Release workflow's publish instead of refusing in the same-push race window (bounded 15-min poll, cache-busted version endpoint, registry outage still warns without blocking); the changesets version PR fast-paths its CI even through the merge queue when the batch diff is release-mechanical (`scripts/version-only-diff.mjs` — version/internal-range package.json lines, changelogs, `.changeset/**`, lockfile, generated catalog baseline); the Release workflow engages auto-merge on the version PR for zero-touch releases (the `hold-release` label parks a big scope in the same release), and its concurrency drains superseded runs so the bot-branch force-push race self-heals.
