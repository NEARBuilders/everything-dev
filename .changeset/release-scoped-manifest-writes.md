---
"everything-dev": minor
---

Release-scoped platform-manifest writes: immutable versioned slots, truth gate on every deploy (#573)

The train's platform-release-manifest leg is now release-scoped (`computeOwedWork` on the single pointer read — the preflight npm gate guarantees npm is published in-train, so the pointer is the release classifier):

- **Release deploys** write the immutable `platform-versions/<version>.json` slot plus the `platform.json` pointer flip in the same atomic write as the config — a red smoke rolls all of it back (the rollback restores the pointer from its own history in the same write).
- **Non-release deploys** write no manifest keys at all.
- **Immutable slots**: an SRI-identical republish succeeds idempotently; a divergent republish hard-fails with a "burned version" error — never reuse a version.
- **No skip path**: the pointer read failing fails the deploy loud (an unknown state must never silently classify a release as non-release — the #568 window class).
- **Truth gate on every production deploy**: the shared-singleton cross-check runs against the composed manifest on non-release deploys too — drifted shared deps block until the next rc.
- The preflight npm-gate message drops "re-run the Release workflow first" — the train owns the npm leg.

The train's decision threads to the image leg (`releaseLeg`), so version + floating image tags move on the release deploy only — one decision point, no duplicate detection reads.
