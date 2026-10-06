# everything.dev skill

Use this when you want an agent to run, edit, and publish the **everything.dev** app — the open runtime for apps on NEAR. everything.dev runs on the everything.dev runtime platform (Module Federation host + oRPC API + Better-Auth with NEAR SIWN) and is composed at runtime from the authored `bos.app.ts` config.

There are two ways to work with this app:

1. **Talk to the app** — use the API via MCP or REST to read/write data without cloning anything.
2. **Clone and modify** — clone the repository, run locally, edit code, and publish.

## Read this page, then load ONE skill

Each skill below is self-contained: its `SKILL.md` covers the common case and routes to its own `references/` for the rest. **Load the skill for the task in front of you; do not load them all.**

Every skill is at `{origin}/skills/<package>/<skill>/SKILL.md` (the files it points to are relative to that URL), and loads with TanStack Intent from the npm package of the same name:

```bash
npx @tanstack/intent@latest load <package>#<skill>
```

Registry entry: `https://tanstack.com/intent/registry/everything-dev` (and `every-plugin`, `better-near-auth`).

| The task in front of you | Load |
|---|---|
| Talk to the running app without cloning it — MCP, REST, oRPC RPC, API keys, discovery | [`everything-dev#talk-to-the-app`](/skills/everything-dev/talk-to-the-app/SKILL.md) |
| Add an API endpoint end to end — contract, router, UI route, typecheck, publish | [`everything-dev#add-a-route`](/skills/everything-dev/add-a-route/SKILL.md) |
| Add or edit a UI route — file-based routing, API client, auth client, SSR, sidebar | [`everything-dev#ui-integration`](/skills/everything-dev/ui-integration/SKILL.md) |
| Build a new plugin in this repo — scaffold, contract/service/index, database, registration | [`everything-dev#plugin-development`](/skills/everything-dev/plugin-development/SKILL.md) |
| Test plugins with vitest and the plugin runtime | [`every-plugin#plugin-testing`](/skills/every-plugin/plugin-testing/SKILL.md) |
| Consume deployed plugins from an external app, child project, or script | [`every-plugin#plugin-client`](/skills/every-plugin/plugin-client/SKILL.md) |
| Understand the every-plugin machinery under a plugin — oRPC contracts, Effect services, Module Federation | [`every-plugin#plugin-development`](/skills/every-plugin/plugin-development/SKILL.md) |
| Add API routes, auth middleware, plugin-client composition, session handling | [`everything-dev#api-and-auth`](/skills/everything-dev/api-and-auth/SKILL.md) |
| Wire NEAR wallet sign-in into the UI — authClient.near actions, delegate actions | [`better-near-auth#client`](/skills/better-near-auth/client/SKILL.md) |
| Set up or debug the SIWN server plugin — NEP-413, nonces, verification | [`better-near-auth#siwn`](/skills/better-near-auth/siwn/SKILL.md) |
| Configure the gasless delegate-action relayer or debug relay failures | [`better-near-auth#relay`](/skills/better-near-auth/relay/SKILL.md) |
| Configure sub-account creation, contract deployment, lifecycle rollback | [`better-near-auth#subaccount`](/skills/better-near-auth/subaccount/SKILL.md) |
| Mount and consume the auth plugin in an everything-dev app | [`better-near-auth#auth-plugin`](/skills/better-near-auth/auth-plugin/SKILL.md) |
| Integrate better-near-auth with TanStack Router (SSR or CSR) | [`better-near-auth#tanstack`](/skills/better-near-auth/tanstack/SKILL.md) |
| Start dev servers, debug hot reload, understand the service-descriptor architecture | [`everything-dev#dev-workflow`](/skills/everything-dev/dev-workflow/SKILL.md) |
| Debug the `extends` chain, deep merge semantics, resolved-config lifecycle | [`everything-dev#extends-config`](/skills/everything-dev/extends-config/SKILL.md) |
| Scaffold a new app with `bos init`, sync from upstream, upgrade framework packages | [`everything-dev#init-upgrade`](/skills/everything-dev/init-upgrade/SKILL.md) |
| Publish the resolved config to FastKV, deploy, sync, upgrade | [`everything-dev#publish-sync`](/skills/everything-dev/publish-sync/SKILL.md) |
| Read and write the FastKV config registry — key layout, namespaces, integrity | [`everything-dev#registry`](/skills/everything-dev/registry/SKILL.md) |
| Build shared-host, shared-API super apps with tenant-specific UI composition | [`everything-dev#super-app`](/skills/everything-dev/super-app/SKILL.md) |
| Follow code style — naming, semantic Tailwind, no comments, import conventions | [`everything-dev#code-style`](/skills/everything-dev/code-style/SKILL.md) |
| Look up any `bos` CLI command — flags, options, environment settings | [`everything-dev#cli-reference`](/skills/everything-dev/cli-reference/SKILL.md) |

Two skills are read together more often than not:

- A plugin's shape in this repo ([`everything-dev#plugin-development`](/skills/everything-dev/plugin-development/SKILL.md)) and the machinery underneath it ([`every-plugin#plugin-development`](/skills/every-plugin/plugin-development/SKILL.md)). Start with the first; open the second when a build or runtime detail doesn't match.
- A new API endpoint ([`everything-dev#add-a-route`](/skills/everything-dev/add-a-route/SKILL.md)) and its auth middleware ([`everything-dev#api-and-auth`](/skills/everything-dev/api-and-auth/SKILL.md)). Open the second when the route needs a session, role, or API key.

## Facts every skill relies on

| | local dev | production |
|---|---|---|
| App origin | `http://localhost:3003` | your runtime domain |
| API base | `http://localhost:3001` | same origin as the app (`/api/*`) |
| MCP endpoint | `POST http://localhost:3001/api/mcp` | `POST <origin>/api/mcp` |
| Skill family | served by the UI dev server | `<origin>/skills/<package>/<skill>/SKILL.md` |
| Auth header | `x-api-key: api_...` (create at `/settings/api-keys`) | same |
| Runtime config | authored `bos.app.ts`, resolved under `.bos/` | published to FastKV (`apps/<account>/<gateway>/bos.config.json`) |

There is no environment parameter anywhere — the origin is the choice.

## Clone and modify

This repo is the **everything.dev base runtime** — the source of truth for the published framework packages (`every-plugin`, `better-near-auth`, `everything-dev`), the universal runtime image, and the everything.dev app itself (host, slim UI/API shells, plugins). It is not a generated child project.

After cloning, read **`AGENTS.md`** at the repo root — operational guidance, the TanStack Intent skills block, and regression test instructions. Then load the skill for the task in front of you from the table above.

To scaffold a **new app** instead of modifying this one, use `bos init` — `everything-dev#init-upgrade` walks it.

## Rules to work by

- **Never edit `*.gen.*` files.** They are regenerated by `bos dev`, `bos build`, and `bos typecheck`.
- **Build through the train.** `pnpm run build [target]` — raw per-workspace builds bypass the prerequisite graph and are unsupported.
- **Handlers are Effect.** New routes use `.effect(function* ...)` generators and access services with `yield* Tag`; no new plain `.handler(async)` routes with inline service access.
- **Semantic Tailwind only.** `bg-background`, `text-muted-foreground` — never hardcoded colors. Files are kebab-case. No comments in implementation.
- **Typecheck before you publish.** `pnpm run typecheck` generates types first and is self-sufficient.
- **Authored config is `bos.app.ts`.** The resolved config under `.bos/` is generated; never commit it.

## Public entry points

- `/` — landing
- `/about` — renders the repo README
- `/skill` — this page rendered
- `/skill.md`, `/llms.txt` — raw doc endpoints
- `/skills/<package>/<skill>/SKILL.md` — the skill family
- `/.well-known/mcp.json` — MCP discovery
- `/.well-known/version` — deployed fingerprint + per-slot pins
- `/api` (Scalar docs), `/api/spec.json` (OpenAPI), `/api/mcp` (MCP server)
