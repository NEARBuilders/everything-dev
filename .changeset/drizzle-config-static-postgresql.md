---
"everything-dev": patch
---

Drizzle-kit configs are static `dialect: "postgresql"` — remove `drizzleCredentialsFor`. drizzle-kit 0.31 has no `pglite` dialect (its config schema validates against `postgresql|mysql|sqlite|turso|singlestore|gel`), so the URL-scheme-driven dialect switch produced configs that failed drizzle-kit's own validation and never typechecked against `defineConfig`. Every workspace `drizzle.config.ts` now hardcodes `dialect: "postgresql"` and passes the resolved `*_DATABASE_URL` through as-is — any plain `postgres://` DSN works unmodified. The zero-config `pglite:.bos/db` default remains a runtime-driver concern only (boot migrations); `db:push`/`db:studio`/`db:migrate` require a configured postgres URL and fail loudly at connect time otherwise.
