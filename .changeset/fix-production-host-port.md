---
"everything-dev": patch
---

Fix hardcoded port 3000 in production runtime config causing binding resolver to fail.

- `buildRuntimeConfig` hardcoded `host.url` and `host.port` to `http://localhost:3000` in production, ignoring `process.env.PORT`. When Railway (or any platform) sets `PORT` to a different value, the HTTP server listened on the correct port but `config.host.url` still pointed at 3000. The binding resolver uses `config.host.url` to fetch `/api/tenants/bindings` from itself, hitting the wrong port and getting 503.
- Now reads `process.env.PORT` with a fallback to `DEFAULT_HOST_PORT` (3000) for both `hostListeningUrl` and `host.port`.
- Also fixes Dockerfile `HEALTHCHECK` and `CMD` to use `${PORT:-3000}` so the container probes and starts on the platform-injected port.
- Removes remote image reference from `railway.toml` so Railway builds from the local Dockerfile instead of pulling a stale prebuilt image.
