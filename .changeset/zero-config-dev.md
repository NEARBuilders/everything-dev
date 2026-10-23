---
"everything-dev": minor
---

Zero-config dev: `bos dev` with no `.env` boots the full stack on ephemeral pglite — no compose, no ceremony.

- `bos dev` no longer creates `.env` from `.env.example`. When no `*_DATABASE_URL`/`*_REDIS_URL` is supplied (shell or `.env`), nothing conventional is generated: plugins fall back to their boot-schema pglite defaults, the DB preflight has nothing to probe, and compose stays down. `BETTER_AUTH_SECRET` is generated per-run (dev-only, not persisted — the boot log says so).
- The generated `.env.example` leaves substrate URLs empty with an opt-in hint; `.env` present with the URLs set → today's behavior exactly (preflight probes them, compose auto-starts).
- `plugins/auth` gains the same pglite default the other boot schemas already had (`AUTH_DATABASE_URL`), so auth boots without a URL in dev too.
- `bos start` warns when no database URL is set — in production that means ephemeral pglite and data will not survive restarts.
