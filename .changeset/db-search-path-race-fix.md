---
"api": patch
"host": patch
"everything-dev": patch
"@every-plugin/template": patch
---

Fix host crash after login caused by a pg-pool search_path race.

- The `on("connect")` handler in `api/src/db/index.ts` and `plugins/_template/src/db/index.ts` ran `CREATE SCHEMA` and `SET search_path` concurrently with the first query on each fresh connection. pg-pool does not await `on("connect")`, so after idle connections closed (30s timeout) the next query (e.g. `listRootNodes`) could land before `SET search_path`, hitting `relation "nodes" does not exist` in the `public` schema. The concurrent `client.query()` calls also produced `Connection terminated` errors (the deprecation warnings at startup were the same root cause).
- Set `search_path` at the protocol level via the pool's `options` config (`-c search_path=<schema>,public`) so every connection has it before any query. Move `CREATE SCHEMA IF NOT EXISTS` to a one-time `pool.connect()` call before returning the driver, eliminating the race entirely.
- Add `uncaughtException` and `unhandledRejection` handlers in `host/src/program.ts` so a dropped DB connection logs an error instead of killing the host process (which cascaded to SIGTERM of all dev services).
- Fix Docker healthcheck to specify the correct database (`pg_isready -U everythingdev -d api_db` / `-d auth_db`), eliminating the `FATAL: database "everythingdev" does not exist` log spam every 3s.
- Harden `bos db:studio` local path to pass the resolved `*_DATABASE_URL` explicitly to the spawned drizzle-kit process, fixing the `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` error when dotenv `override: false` left a stale empty shell env value in place.
