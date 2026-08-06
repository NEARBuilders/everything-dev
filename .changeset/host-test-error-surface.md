---
"host": minor
"api": minor
"@every-plugin/template": patch
---

Remove `_viewer` paths from the host and add structured error testing surface.

- Remove `_viewer` route, `renderBosViewer`, `isViewerFramePath`, and viewer-specific CSP/font-src conditionals from the host; always apply `frame-ancestors 'none'`
- Rate limiter no longer skips the `/health` path, protecting it from DDoS
- Add `testError` route to the core API shell with six error kinds (`unauthorized`, `forbidden`, `not_found`, `conflict`, `bad_request`, `internal`), returning structured JSON errors with correct status codes and content types
- Add `testError` route to the `@every-plugin/template` plugin as a demonstration
- Append template plugin's thing routes (`/api/things`) to the API router with `requireAuth`, restoring the host-level `/api/things` surface via `_plugins.template()` passthrough
- Add regression tests verifying structured error responses, security headers (CSP/CSRF/X-Frame-Options), body-size limiting, and rate limiting
- Add router-composition note to `plans/orpc-v2-effect-migration.md` (Phase 1.7) for future direct-router merging in `every-plugin`
