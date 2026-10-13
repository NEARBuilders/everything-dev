---
"api": minor
"everything-dev": minor
"@everything-dev/upload-app": minor
---

Move artifact-control out of `api`/`host` ownership and into a dedicated plugin package. The shared artifact-control client/server helpers remain in `everything-dev`, and the plugin now owns the `/api/storage/bundles` route and its runtime wiring.

The standalone upload service now requires production storage credentials plus `BOS_STORAGE_AUTH_ORIGIN` for API-key verification, with a bootstrap-key fallback for first deploys and break-glass access.
