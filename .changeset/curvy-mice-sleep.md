---
"host": patch
---

refactor(host): clean up auth type boundaries and inlined private functions

- Moved HonoEnv definition from lib/auth.ts into program.ts, where the app
  is assembled. services/auth.ts now uses a self-contained AuthMiddlewareEnv.
- Inlined toAuthClientContext and resolveAuthEntry into their sole call sites.
- Simplified AuthServices to a direct re-export from generated types.
- Tightened registerAuthHandler's app parameter from `{ on: any }` to `Hono<AuthMiddlewareEnv>`.
