---
"everything-dev": patch
"api": patch
---

Per-PUT retry and 4-way concurrency for bundle storage; storage timeout hint fires for all 408s.

- **Per-object retry** (`api`): `aws4fetch` signs and sends but never retries — one keep-alive reset over a slow uplink killed entire multi-hundred-file bundle batches (`fetch failed` mid-sequence, after earlier files had already PUT successfully). `S3StorageClient.put/get` now run through a retry helper (3 attempts, 250ms/500ms backoff) that retries transient failures — network errors (undici's `fetch failed`, with the `cause` code surfaced, e.g. `fetch failed (ECONNRESET)`) and 429/5xx responses — and fails fast on definitive rejections (401/403) with the R2 response body included.
- **4-way PUT concurrency** (`api`): the storage route uploads files through `Effect.forEach(..., { concurrency: 4 })` instead of sequentially — 736 sequential round-trips were minutes of pure latency.
- **Timeout hint** (`everything-dev`): the `BOS_STORAGE_UPLOAD_TIMEOUT_MS` hint now fires for the storage route's own 408 body ("Bundle upload timed out"), not just the general API timeout's "Request timeout".
- **Env docs**: `.env.example` regains the ADR 0020 storage section (BOS_STORAGE_* / CDN deploy vars) plus the new `BOS_STORAGE_UPLOAD_TIMEOUT_MS`.
