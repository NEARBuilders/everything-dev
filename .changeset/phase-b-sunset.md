---
"everything-dev": minor
---

Sunset the DB bundle flow and Zephyr (plan 043 Phase B, ADR 0011) — the image is the deployment.

- Delete the platform bundle storage: the `bundle_objects` table (migration squashed pre-release), the `BundleStorage` service, `POST /api/storage/bundles`, the oRPC `serveBundle` route, and its host bodyLimit scoping. `/bundles/*` is served from the runtime image's filesystem via `BOS_BUNDLE_DIR` (Phase A) — with it unset, bundle URLs no longer fall through to any storage route.
- Remove Zephyr entirely: the `withPluginDeploy`/`withZephyr` attach points, `BOS_CDN_PROVIDER`/`DEPLOY`/`FORCE_COLOR` env wiring, deploy-output parsing (`[BOS_DEPLOY]` lines, `ZE…` errors, retry backoff), the `deploy.cdn` config field, the `--cdn` flag, and zephyr build plugins from the catalog and all workspaces. `bos publish --deploy` unconditionally writes deterministic `https://<domain>/bundles/<account>/<gateway>/<workspace>/` URLs.
- `bos plugin publish <key>` now builds the plugin and writes its deterministic bundle URL (no deploy script, no integrity hash).
- Workspace `deploy` scripts are removed — `bos build --deploy` is the only deploy path.
