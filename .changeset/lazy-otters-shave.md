---
"api": patch
---

Add a starter test suite for the API plugin: vitest config, an integration harness (`tests/setup.ts`) that boots the plugin runtime over HTTP with typed oRPC clients and injectable auth/org context, integration tests for public and authenticated routes, and PGlite-backed unit tests for `TenantsService`. The root `test:api` script now runs real tests instead of erroring with "no test files found".
