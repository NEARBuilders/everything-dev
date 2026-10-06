---
name: add-a-route
description: Add one API endpoint end to end in everything.dev — contract route with Zod schemas, Effect-native handler in the plugin router, UI call via useApiClient, route file rendering the data, typecheck, publish. Use when adding an API endpoint, wiring a new UI page to app data, or debugging the contract/handler/client chain.
metadata:
  sources: "api/src/contract.ts,api/src/index.ts,plugins/_template/src/contract.ts,plugins/_template/src/index.ts,packages/every-plugin/src/errors.ts,ui/src/routes,packages/everything-dev/skills/ui-integration/SKILL.md"
---

# Add a route

One endpoint, end to end. The slice below is complete — copy it, rename, and
it runs. Everything is typed from the contract: the handler's `input`/`context`,
the generated client, and the UI's response shape.

## Where the route lives

| The task in front of you | Put it in |
|---|---|
| App-shell glue (health, infra) | `api/src/contract.ts` + `api/src/index.ts` |
| A feature (things, registry, proposals, votes, chat) | a plugin under `plugins/<name>/` |

Feature routes live in plugins; `api/` is a slim shell. New plugins: copy
`plugins/_template/` (`everything-dev#plugin-development`).

## The slice

### 1. Contract (`plugins/<name>/src/contract.ts`)

```ts
import { oc } from "@orpc/contract";
import { z } from "zod";
import { FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";

export const WidgetSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export const contract = oc.router({
  getWidget: oc
    .route({ method: "GET", path: "/widgets/{id}" })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ widget: WidgetSchema }))
    .errors({ NOT_FOUND, UNAUTHORIZED, FORBIDDEN }),
});

export type ContractType = typeof contract;
```

Path params (`{id}`) bind to the Zod input keys automatically.

### 2. Handler (`plugins/<name>/src/index.ts`)

```ts
export default createPlugin.withPlugins<PluginsClient>()({
  // variables, secrets, context, contract — see the template
  createRouter: (builder) => ({
    getWidget: builder.getWidget.effect(function* ({ input, context, errors }) {
      if (!context.userId) {
        return yield* Effect.fail(errors.UNAUTHORIZED({ apiKeyProvided: !!context.apiKey }));
      }
      const widgets = yield* WidgetsService;
      const widget = yield* widgets.getWidget(input.id);
      return { widget };
    }),
  }),
});
```

The tag (`WidgetsService`) must be exposed from the returned `initialize`
layer. Handlers are Effect generators — see **Rules** below.

### 3. UI call (any component)

```ts
import { useApiClient } from "@/app";

const apiClient = useApiClient();
const { data } = await apiClient.template.listThings({ limit: 20 });
```

The client is namespaced by the plugin key in `bos.app.ts` — a `widgets`
plugin is `apiClient.widgets.*` — and typed from the contract;
`ui/src/lib/api-types.gen.ts` regenerates on `pnpm run typecheck` / `bos dev`.

### 4. Route file (`ui/src/routes/<area>.tsx`)

File-based routing — TanStack Router generates the tree. See
`everything-dev#ui-integration` for loaders, SSR, and the page-header/testid
conventions.

### 5. Verify, then publish

```bash
pnpm run typecheck    # regenerates types, then checks everything
pnpm run build        # the train — never per-workspace raw builds
pnpm run deploy       # preflight → build → upload → publish → image
```

## The tasks you will actually be given

**"Add a read-only endpoint for X."** Contract → handler → UI query. No auth
schema needed; still add `.errors({ NOT_FOUND })` for typed misses.

**"Add an endpoint only signed-in users can write."** Same slice, plus the
`context.userId` guard from step 2. For roles, orgs, or API-key permissions,
load `everything-dev#api-and-auth` for the middleware pattern.

**"The UI can't see the new route."** Types are generated: run
`pnpm run typecheck` (self-sufficient), or restart `bos dev`. If the client
name is wrong, the plugin key in `bos.app.ts` is the namespace.

## What comes back when it fails

| word | do |
|---|---|
| `Type 'DecoratedMiddleware'…` in `.use()` | middleware typing does not compose with `.use()` — use the local-middleware pattern (`plugins/proposals/src`) |
| `UNAUTHORIZED` type error | its `data` requires `{ apiKeyProvided: boolean }`; all-optional shapes still need explicit `data: {}` |
| Effect lint flags floating effects | `pnpm run lint:effect`; `tsc` clean is not enough |
| `ModuleFederationError` / `__webpack_modules__` | the deployed plugin's `mf-manifest.json` is older than the host's — `bos mf check`, then republish the plugin |
| 404 on the new route | the route lives in a plugin — the path is `/api/rpc/<pluginKey>/…` or `/api/<contract path>` |

## Rules to work by

- **`.effect(function* ...)`, never new `.handler(async)`.** Services come
  from `yield* Tag` in generators; `Context.get(context["effect/context"], Tag)`
  is reserved for streaming (async-generator) handlers.
- **`Effect.fail`, not throws.** Definitive failure exits are
  `return yield* Effect.fail(...)`; shared shapes come from `every-plugin/errors`.
- **No `Effect.provide(Tag, Layer.effect(...))` for persistent deps.** Build
  scoped services with `buildScoped(...)` inside `initialize` — transient
  scopes release immediately.
- **Typecheck before publish.** `pnpm run typecheck` regenerates all types.
