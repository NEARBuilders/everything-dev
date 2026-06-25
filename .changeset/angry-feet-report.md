---
"everything-dev": minor
---

Generate docker-compose.yml and .env.example Redis services for `_REDIS_URL` secrets (e.g. `CACHE_REDIS_URL`), with `redis:7-alpine`, append-only persistence, and `redis-cli ping` healthchecks.

Persist port assignments to `.bos/infra-state.json` so adding new database or Redis services never shifts existing ports.

Remove alphabetical sort of additional `_DATABASE_URL` secrets — secrets now follow the order they appear in `bos.config.json`.

Add `.env` staleness detection: warns when `DATABASE_URL`/`REDIS_URL` values in `.env` differ from the generated `.env.example`.
