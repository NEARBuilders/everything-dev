---
"every-plugin": minor
"everything-dev": minor
---

Immutable version directories — parent republishes can no longer rot pinned slots (#826)

Workspace deploys now dual-write every dist file into a content-addressed `versions/<dirId>/…` directory beside the existing flat slot-root layout, and the version manifest declares its directory via a new `dir` field. Pin resolution prefixes artifact coordinates (`entryUrl`, `browserManifestUrl`, `ssrEntryUrl`) with the manifest's directory, so a child pinned to an older slot keeps loading the old deploy's entry **and** its expose chunk, chunks, and manifests from the same frozen directory — a parent republish that overwrites the fixed-name files at the slot root no longer produces mixed builds (`__webpack_modules__[r] is not a function`). Legacy manifests without `dir` resolve exactly as before.

- `versionDirPath(files)` derives the directory from the dist's file map (content-addressed: identical bytes → identical directory → unchanged redeploys skip the copy entirely via the previous pin's `dir`)
- The upload service treats `versions/**` as write-once: an upload whose bytes differ from the stored object fails with a new `CONFLICT` (409) error, mirroring the platform "version is burned" rule; identical bytes stay an idempotent skip
- Serving classification treats everything under `versions/` as immutable (cache-control `immutable`), independent of filename hashing
- Staged (in-image) dists ignore the directory — the staged namespace materializes flat, so staged resolution passes `{ ignoreDir: true }`
