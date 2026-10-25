---
"everything-dev": patch
---

Stop rewriting the authored `bos.app.ts` during sync/upgrade: template sync no
longer runs `personalizeConfig` in sync mode (it only wrote back the child's own
values while re-serializing the file — dropping hand formatting, comments, and
remote-only attachments like a published `auth` block), and the upgrade's
platform-pin stamp is now a surgical line edit that replaces only the
`platform: "…"` property, failing loud with the version to set by hand when no
safe anchor exists instead of re-serializing. Explicit composition commands
(`bos plugin add/remove`, `bos config registry use`) keep re-serializing, but
the descriptor round-trip no longer drops a remote-only `auth` attachment (no
local path) — previously the whole auth block with its variables was silently
deleted. `bos upgrade --check` now prints what drifted (platform, package and
catalog deltas) before exiting, and the `platform-drift` job was removed from
the reusable `consumer-ci` workflow — the drift alarm is manual only and never
a merge blocker.
