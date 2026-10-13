---
"everything-dev": patch
---

The remote host load fails loud on manifest fetch errors instead of silently falling back to the retired fixed-name `remoteEntry.js` (a 404 on the CDN): a transient CDN hiccup during the start stack's boot — a 403 challenge, a 5xx, a timeout — now names the URL, status, and cause in the failure, where before it surfaced as an unnamed `loadRemote` error. The start stack also persists its session log to `.bos/logs` (was discarded via `noLogs`), so a failed remote load in a container is diagnosable from its filesystem.
