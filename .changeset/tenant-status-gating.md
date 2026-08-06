---
"everything-dev": minor
"host": minor
---

Add tenant lifecycle status to the runtime and gate resolution on it.

- Add an optional `status` field (`active` | `suspended` | `pending_deletion`) to `BosConfigInput` so it survives config parsing
- Host `resolveRequestRuntime()` now reads the tenant's published config status and rejects suspended tenants (503) and pending-deletion tenants (410) before serving
- Tenant suspend/reactivate/delete republish the tenant config with the matching status so the host picks it up without an API round-trip
