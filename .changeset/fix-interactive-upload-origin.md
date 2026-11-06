---
"everything-dev": patch
---

Interactive `bos deploy` bundle-upload resolution (#666): the upload origin now
defaults to the platform upload service (`https://upload.everything.dev`) when
the effective CDN is the platform CDN, instead of reusing the `bos login`
session's app-site URL (which 404s uploads after a full build). The preflight
probe distinguishes an app host from the upload service via the guarded
`POST /api/storage/bundles` route and fails fast with the fix. `bos deploy` /
`bos publish` now load the project `.env` (shell-exported variables still win),
so scaffolded defaults like `BOS_STORAGE_ORIGIN` apply to interactive deploys.
