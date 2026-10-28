---
"everything-dev": patch
---

Unify the five hand-rolled semver comparators into one rc-aware module (utils/semver): the platform compat gate now orders prerelease versions (a child pinned below the release's prerelease compat floor or ahead of the published release is flagged instead of silently passing), exact shared-dep pins are enforced in the deploy truth gate, and a version with a longer prerelease no longer fails caret constraints it satisfies.
