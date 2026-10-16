---
"@everything-dev/upload-app": patch
"everything-dev": patch
---

Unblock full-workspace CDN deploys from the Cloudflare proxy timeout. The upload service raises the per-request stat/put fan-out against object storage from 4 to 16 (a 324-file batch no longer exceeds the ~100s proxy window), the upload client retries Cloudflare 522/524 failures (server-side SRI dedupe makes retries idempotent) and maps a 524 to a "upload smaller batches" hint instead of raw HTML, and `uploadWorkspaceDist` caps requests at 100 files regardless of the byte budget so a large dist can never concentrate enough per-file stat/put round trips in one request to blow the proxy timeout.
