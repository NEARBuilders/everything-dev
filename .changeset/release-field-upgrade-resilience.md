---
"everything-dev": patch
---

The authored config's `platform:` pin field is renamed to `release:` — run `bos upgrade` to migrate; the upgrade rewrites the key surgically and stamps the current chain release.

`bos upgrade` no longer dies on the pin it exists to move: the release is chosen fresh from the registry (never from the offline cache), the target release's version record is verified before anything mutates, and a child authored against a release whose record is absent upgrades anyway — the stranded-pin state is repaired, not refused.

The upgrade install now handles pnpm's supply-chain holdback: a stale lockfile entry naming a fresh framework release is repaired automatically (exclude posture reconciled, lockfile regenerated, one retry) instead of failing with the raw `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` dump.

Fixes the version-record read double-prefixing its registry key (`apps/a/g/apps/a/g/...`), which made every pinned release unresolvable while its record sat published — the stranded-pin incident.
