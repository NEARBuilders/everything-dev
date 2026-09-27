---
"ui": patch
---

Fix tenant UI bundle integrity verification: the node-config verify/fill helper now hashes the module entry (`<base>/remoteEntry.js`, matching the deploy pipeline and host) instead of the bundle base URL, which serves an HTML landing page and always mismatched. Adds SSR bundle verification (`<base>/remoteEntry.server.js`), an SSR verify/fill button, publish preflight for the SSR pair, and normalizes pasted entry URLs back to base URLs before publishing.
