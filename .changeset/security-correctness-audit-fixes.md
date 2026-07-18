---
"api": patch
"host": patch
"everything-dev": patch
---

Security and correctness fixes from codebase audit:

- **Require `API_DATABASE_URL` in production** — Removed the `:memory:` PGlite default from the API plugin schema. Uses a Zod `refine()` that rejects `pglite:` URLs when `NODE_ENV=production`, preventing silent data loss on restart. Updated `drizzle.config.ts` fallback to throw in production.
- **Add warnings to empty catch blocks** — Added `console.warn` to 5 empty `catch {}` blocks across `config.ts` (_resolved.json parse, package.json name resolution), `orchestrator.ts` (manifest fetch failure), and `cli/upgrade.ts` (plugin config parse and file deletion), turning silent fallbacks into actionable diagnostics.
- **Add CSRF protection middleware** — Added `createCsrfMiddleware` to the host server that validates `Origin`/`Referer` headers against the allowed origins list for state-changing methods (POST/PUT/DELETE/PATCH), preventing cross-origin request forgery on cookie-authenticated endpoints.
