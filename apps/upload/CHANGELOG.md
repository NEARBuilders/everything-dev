# @everything-dev/upload-app

## 1.0.0-rc.2

### Patch Changes

- 6902c4b: Unblock full-workspace CDN deploys from the Cloudflare proxy timeout. The upload service raises the per-request stat/put fan-out against object storage from 4 to 16 (a 324-file batch no longer exceeds the ~100s proxy window), the upload client retries Cloudflare 522/524 failures (server-side SRI dedupe makes retries idempotent) and maps a 524 to a "upload smaller batches" hint instead of raw HTML, and `uploadWorkspaceDist` caps requests at 100 files regardless of the byte budget so a large dist can never concentrate enough per-file stat/put round trips in one request to blow the proxy timeout.
- Updated dependencies [0e4c4d7]
  - every-plugin@3.0.0-rc.6

## 1.0.0-rc.1

### Minor Changes

- 07d8b2b: Move artifact-control out of `api`/`host` ownership and into a dedicated plugin package. The shared artifact-control client/server helpers remain in `everything-dev`, and the plugin now owns the `/api/storage/bundles` route and its runtime wiring.

  The standalone upload service now requires production storage credentials plus `BOS_STORAGE_AUTH_ORIGIN` for API-key verification, with a bootstrap-key fallback for first deploys and break-glass access.

- 394c536: Rename `@everything-dev/artifact-control-plugin` to `@everything-dev/upload-app` and move it to `apps/upload` — the app-shaped home for the upload service (ADR 0027). The storage port grows `stat`/`list` (ListObjectsV2 with continuation pagination, in-memory parity) and persists per-file SRI as object metadata, so byte-identical re-uploads are skipped as confirmed no-ops (response gains `unchanged`). New inspection routes behind `bundles:read`: `GET /api/storage/bundles` (object listing), `GET /api/storage/versions` (version manifests), `GET /api/storage/integrity` (manifest + entry verification). The client (`createUploadClient`) drops the fabricated session id/finalizedAt — the server never persisted them. The deploy train now hard-errors when no `BOS_STORAGE_ORIGIN` is set with uploads planned (the gateway fallback no longer serves uploads); CI workflows pin `https://upload.everything.dev`.

### Patch Changes

- Updated dependencies [77bb92e]
  - every-plugin@3.0.0-rc.4
