---
"everything-dev": minor
---

Rename `@everything-dev/artifact-control-plugin` to `@everything-dev/upload-app` and move it to `apps/upload` — the app-shaped home for the upload service (ADR 0027). The storage port grows `stat`/`list` (ListObjectsV2 with continuation pagination, in-memory parity) and persists per-file SRI as object metadata, so byte-identical re-uploads are skipped as confirmed no-ops (response gains `unchanged`). New inspection routes behind `bundles:read`: `GET /api/storage/bundles` (object listing), `GET /api/storage/versions` (version manifests), `GET /api/storage/integrity` (manifest + entry verification). The client (`createUploadClient`) drops the fabricated session id/finalizedAt — the server never persisted them. The deploy train now hard-errors when no `BOS_STORAGE_ORIGIN` is set with uploads planned (the gateway fallback no longer serves uploads); CI workflows pin `https://upload.everything.dev`.
