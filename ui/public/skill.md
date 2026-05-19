# everything.dev skill

Use this when you want an agent to understand, run, edit, and publish an `everything.dev` app.

## TanStack Intent

- Registry entry: `https://tanstack.com/intent/registry/everything-dev`
- Load with TanStack Intent: `npx @tanstack/intent@latest load everything-dev`
- If the agent supports registry URLs directly, point it at the registry entry above.

## What this project is

- `everything.dev` is a runtime-composed app platform on NEAR.
- `bos.config.json` is the canonical runtime manifest.
- The host is the runtime shell and trust boundary.
- The UI is loaded at runtime through Module Federation.
- The API is loaded at runtime through `every-plugin`.
- Public metadata can describe the runtime, but should not replace `bos.config.json`.

## What an agent should be able to do

- read the runtime model and explain how the app is assembled
- initialize a new app or tenant that extends a base runtime
- run the app locally
- edit the UI in `ui/src/`
- change or add routes, components, and styles
- publish the app with the user's own account
- keep the same gateway or domain pattern while swapping account ownership

## Core model

- The base runtime owns the shared host, auth, API, and base plugin set.
- Tenant apps extend that base runtime and override UI-facing pieces.
- In fixed-core mode today, tenants can override:
  - `app.ui`
  - existing `plugins.<id>.ui`
  - existing `plugins.<id>.sidebar`
- In fixed-core mode today, these stay fixed to the base runtime:
  - `app.host`
  - `app.api`
  - `app.auth`
  - server-side plugin loading and router mounting

## Super app mental model

- bare domain -> base runtime
- one subdomain label -> tenant runtime
- tenant config must extend the base runtime
- tenant UI integrity must be present for trusted overrides

Example:

- `bos://linktree.near/linktree.com` is the base runtime
- `bos://alice.near/linktree.com` is a tenant runtime on the same gateway

## Run locally

```bash
cp .env.example .env
bun install
bun run dev
```

Useful variants:

```bash
bos dev --host remote
bos dev --host remote --api remote
bos start --no-interactive
```

## Edit the UI

- main UI code lives in `ui/src/`
- routes live in `ui/src/routes/`
- reusable components live in `ui/src/components/`
- app shell and runtime helpers live in `ui/src/app.ts`, `ui/src/router.tsx`, and `ui/src/routes/__root.tsx`
- use semantic Tailwind classes such as `bg-background`, `bg-card`, `text-foreground`, and `text-muted-foreground`

## Init a base runtime

```bash
bos init --overrides ui,api,host
bos publish --deploy
```

This creates and publishes the base runtime that tenants can extend.

## Create a tenant on the same gateway or domain

Use a tenant `bos.config.json` like this:

```json
{
  "extends": "bos://linktree.near/linktree.com",
  "account": "alice.near",
  "domain": "linktree.com",
  "app": {
    "ui": {
      "name": "ui",
      "development": "local:ui",
      "production": "https://cdn.example.com/alice-ui",
      "integrity": "sha384-..."
    }
  }
}
```

Rules:

- change `account` to the user's own NEAR account
- keep `domain` or gateway the same when you want the same shared-host pattern
- publish the base runtime first
- then publish the tenant runtime that extends it

## Publish

```bash
bos publish --deploy
```

If config changes affect the base host runtime, restart the host so it reloads the latest base config snapshot.

## Host env for tenant mode

```bash
NETWORK_ID=mainnet
ALLOW_OVERRIDE=ui,plugins.*
TENANT_WHITELIST=alice.near,bob.near
ALLOW_UNTRUSTED_SSR=false
```

## Good tasks for an agent

- explain runtime inheritance and composition
- scaffold a super app
- turn a project into a shared-host base runtime
- create a tenant app that extends a base runtime
- debug why tenant UI overrides are not applying
- wire a new page or design into `ui/src/routes/`
- publish updates without changing the shared domain model

## Public entry points

- `/`
- `/about`
- `/skill`
- `/skill.md`
- `/README.md`
- `/llms.txt`

## Tone

Prefer runtime-first explanations.
Treat the project as a living runtime surface, not a fixed demo.
Keep NEAR and Module Federation context intact.
