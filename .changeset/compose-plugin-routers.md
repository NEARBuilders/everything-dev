---
"host": patch
---

Only expose the API plugin's router publicly on `/api`

Plugin routers (registry, projects, etc.) are no longer mounted as separate HTTP endpoints on `/api/<plugin>`. Only the API plugin contract is served, providing a single unified OpenAPI spec at `/api/spec.json` and Scalar docs at `/api`. Other plugins remain accessible internally via `pluginsClient` for server-to-server composition.

**Breaking changes:**
- `/api/<plugin>` routes (e.g. `/api/registry`, `/api/projects`) no longer serve plugin REST/RPC endpoints
- `/api/rpc/<plugin>/<procedure>` paths no longer route to plugin RPC procedures
- Individual plugin OpenAPI specs and docs pages are no longer available
- When the API plugin is unavailable, all `/api/*` routes return 503 instead of per-plugin 503s