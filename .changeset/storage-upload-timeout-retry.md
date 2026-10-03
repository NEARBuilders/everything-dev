---
"everything-dev": patch
"host": patch
---

Fix bundle-upload timeouts that broke CDN publishes mid-deploy.

- **Storage upload timeout**: `/api/storage/bundles` is exempt from the general 30s API timeout and gets its own much longer budget (`BOS_STORAGE_UPLOAD_TIMEOUT_MS`, default 10 min). Large batched uploads (receiving + SRI-hashing + storing the `ui` dist) routinely exceeded 30s, so the host aborted mid-upload with `500 {"error":"Request timeout"}` and the publish died after partially re-uploading workspaces — leaving the CDN serving bytes that no longer matched the published config's SRI hashes.
- **Upload retries**: `uploadBundle` retries up to 3 attempts with backoff on retryable failures (network errors, 408/429/5xx); non-retryable statuses (401/403/413) fail immediately as before. Retries are idempotent (the storage route overwrites by workspace+path and recomputes SRI server-side). A timeout failure now hints at `BOS_STORAGE_UPLOAD_TIMEOUT_MS`.
- **Build warning**: `loadAppDescriptorConfig`'s runtime-resolved dynamic import is marked `webpackIgnore` so bundlers stop warning "Critical dependency: the request of a dependency is an expression".
