---
"@every-plugin/template": minor
---

Move the things CRUD into the template plugin as a DB-backed demonstration of database best practices, replacing the in-memory `Map` store while keeping the existing streaming demos.

- Add drizzle infrastructure under `src/db/`: `things` table schema, PGLite/Postgres driver, scoped `DatabaseTag`/`DatabaseLive` layer, and a migration runner with a generated initial migration
- Add `ThingsService` (Effect `Context.Tag`) with `createThing`, `getThing`, `deleteThing`, and a new `listThings` (type filter + offset cursor pagination); errors are typed `Effect<_, ORPCError>` (`NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`)
- Build the service via `tools.buildService` so the database pool lifecycle is bound to the plugin scope
- Rename the `apiKey` secret to `TEMPLATE_API_KEY` and add a `TEMPLATE_DATABASE_URL` secret (defaults to in-memory PGLite); all secrets now follow the uppercase convention
- Add dependency scripts `db:generate`, `db:push`, and `db:studio`

Streaming demonstrations (`search`, background events via `MemoryPublisher`) are preserved.