---
title: "05 · Plugins"
description: What a plugin is — contract, handlers, services, optional UI, docs, and database — how it is built and published, and how plugins call each other.
order: 50
tags:
  - book
---

# 05 · Plugins

A plugin is a self-contained module that contributes one feature to every runtime
that composes it: API routes, always; optionally UI pages, documents, and a
database. It is built, published, versioned, and deployed on its own.

## Anatomy

| File | Job |
|---|---|
| `src/contract.ts` | The API surface: oRPC routes and their Zod schemas. Imports nothing local |
| `src/index.ts` | `createPlugin` — variables, secrets, context, the contract, and the router |
| `src/service.ts`, `src/services/` | Domain logic as Effect services |
| `src/lib/context.ts` | The request-context schema, typed to the plugin's generated auth types |
| `src/db/` | `schema.ts`, `migrations/`, and a ~15-line `layer.ts` — when the plugin stores data |
| `ui/` | TanStack route files — when the plugin has pages |
| `docs/` | Markdown — when the plugin publishes documents |
| `drizzle.config.ts` | Database tooling config — framework-owned |

The contract is the source of truth for everything downstream: its type declaration
is emitted into `plugin.manifest.json`, and consumers — the UI's typed client, the
OpenAPI spec, MCP tools — are generated from it.

## The definition

```ts
export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({ baseUrl: z.url() }),
  secrets: z.object({ VOTES_DATABASE_URL: z.string() }),
  context: ContextSchema,
  contract,
  initialize: (config) =>
    Effect.gen(function* () {
      return Layer.mergeAll(
        Layer.succeed(
          VotesService,
          new VotesService(config.variables.baseUrl),
        ),
        VotesRepository.Live.pipe(Layer.provide(DatabaseLive(config))),
      );
    }),
  createRouter: (builder) => ({
    list: builder.list.effect(function* ({ input, context, errors }) {
      if (!context.userId) return yield* Effect.fail(errors.UNAUTHORIZED());
      const votes = yield* VotesService;
      return yield* votes.list(input, context.userId);
    }),
  }),
});
```

Three things to notice:

- **`variables` and `secrets` are schemas.** Values come from the runtime's config
  and environment; a missing or malformed one fails at boot with a named error.
- **`initialize` returns a Layer.** The runtime builds it in the plugin's lifecycle
  scope, so scoped resources — database pools, publishers, background fibers — are
  released when the plugin unloads. There is no `shutdown` hook; teardown is a
  finalizer.
- **Handlers are Effect generators.** A handler resolves its services with
  `yield* Tag` and fails with a contract error. `Context.get(context["effect/context"], Tag)`
  is reserved for streaming handlers.

A service is a `Context.Service` class tag with its implementation in a static
`Live` layer. That is also the test seam: provide a fake layer instead of mocking
modules.

## Calling another plugin

Plugins never import each other. The host loads every non-API plugin first and hands
the API a **`pluginsClient`** map — one typed entry per plugin, carrying both a
client and the plugin's raw router. A handler calls a sibling through that map, in
process, with no HTTP hop; a plugin can even mount a sibling's routes directly.
Types come from the sibling's published manifest, so a plugin that is not in this
repository typechecks against its deployed contract.

The same boundary applies to data: a plugin's database tag is plugin-local.
Cross-plugin reads go through `pluginsClient`, never through another plugin's
tables.

## Building and publishing

A plugin's build is three one-line scripts — `every-plugin build`, `dev`, `deploy` —
and usually no bundler config. The framework composes the standard rspack stack,
emits the manifest, and derives Module Federation wiring from `package.json`. A
workspace that needs a real customization spreads the generated config; one that
declares a `velite.config.ts` gets its content compiled in the same build.
([ADR 0002](../adr/0002-plugin-build-composition.md),
[ADR 0003](../adr/0003-every-plugin-cli-package-contract.md))

`bos plugin publish <key>` runs the full deploy train scoped to one plugin —
preflight, build, upload, pin, publish. An app then attaches it with one entry in
`bos.app.ts`; a **remote-only** plugin needs no local source at all.

## Storage, by choice

The default is `databaseLayer` — Drizzle on Postgres or PGlite, migrating on boot —
supplied by the framework and scaffolded once into the plugin. It is a suggested
default, not a mandate: the plugin owns its `db/` files and can replace them with
any other Layer for its own tag. [07 · Data](07-data.md) covers what the default
gives you. ([ADR 0033](../adr/0033-database-seam.md))

## Check it

- `bos plugin list` — the plugins composed by this runtime, local and remote.
- `.bos/generated/runtime-map.json` — each backend with its version and contract hash.
- `pnpm --filter <plugin> test` — the plugin's own suite.

## Further reading

- Start from the scaffold: [`plugins/_template`](../../plugins/_template/) — every pattern above, working.
- The [`everything-dev#plugin-development`](../../packages/everything-dev/skills/plugin-development/SKILL.md) skill (the plugin in its app) and the [`every-plugin#plugin-development`](../../packages/every-plugin/skills/plugin-development/SKILL.md) skill (the machinery underneath).
- The [`every-plugin#plugin-testing`](../../packages/every-plugin/skills/plugin-testing/SKILL.md) and [`every-plugin#plugin-client`](../../packages/every-plugin/skills/plugin-client/SKILL.md) skills.
- ADRs [0003](../adr/0003-every-plugin-cli-package-contract.md), [0031](../adr/0031-package-shape.md) (contract → handlers → services), [0033](../adr/0033-database-seam.md), [0054](../adr/0054-content-collections-framework-primitive.md).
- Next: [06 · The development loop](06-development-loop.md).
