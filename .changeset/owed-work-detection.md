---
"everything-dev": minor
---

Owed-work detection: the train derives release work from live state (#571)

New `detectOwedWork` reads two facts — npm registry (a publishable version npm does not serve yet) and the FastKV platform-manifest pointer (trailing the repo's framework version, or absent) — never git history. Unknown states (npm unreachable, FastKV read failure) read as not-owed and never block, matching the preflight npm gate's tolerance. The root's build leg now runs the detection: release deploys move version + floating image tags, non-release deploys push `sha-<short>` only (`conditionImageTags`) — version tags stay append-only, the property pinned children's digest derivation depends on. An owed-on-one-side-only state with a completed release cycle on record (the #568 silent-skip window) is drift: the train fails loudly naming both facts before the image pushes.
