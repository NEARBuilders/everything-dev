# Plan 035: Derived OpenAPI mounts — plugins declare HTTP prefixes, host stops hardcoding them

> **Executor instructions**: Follow step by step; run every verification
> command. Update your status row in `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat <merge-base>..HEAD -- host/src/routes/api.ts`.
> Prerequisite: plan 029 merged (platform CDN) — the hardcoded `app.all("/bundles/*", …)`
> second mount of the api `OpenAPIHandler` is the concrete instance this plan
> generalizes.

## Status

- **Priority**: P3
- **Effort**: S-M
- **Risk**: LOW-MED
- **Depends on**: done/029-platform-cdn.md
- **Category**: architecture
- **Planned at**: 2026-09-19, recorded during plan 029 execution

## Why this matters

Plan 029 introduced the first non-`/api` HTTP mount of a plugin's oRPC
contract: the host mounts the API's `OpenAPIHandler` a second time at
`/bundles/*` so tenants can serve Module Federation bundles from
`https://<site>/bundles/<account>/<gateway>/…`. That mount is a hardcoded
one-off in `host/src/routes/api.ts`. Plan 032 (sandbox) will likely need
another (e.g. `/sandboxes/*`), and any remote plugin might later want a
public file/asset prefix.

Composition model after 029: **file/binary transport is an oRPC contract
concern** (contract routes with `{+param}` catch-all paths), while host mounts
remain prefix-symmetric. This plan closes the loop: the host should not grow a
handcoded mount per prefix — plugins should declare the prefixes their
contracts expose, and the host derives the mounts.

## Design sketch

- Contract metadata: an `openapi.prefix` (or a dedicated `meta` field, e.g.
  `mount: { prefix: "/bundles" }`) on the API plugin's contract router.
- Host: at `setupApiRoutes`, scan each loaded plugin's router (or its
  published manifest) for declared prefixes; for each, register the same
  generic mount the `/bundles` one-liner uses today
  (`handleOrpc(c, handler, prefix, effectContext)`).
- Keep `ResponseHeadersHandlerPlugin` handler-level (already generic after 029).
- Security review per prefix: session middleware scope, body limits, and
  public/GET semantics must be declared per mount, not defaulted — a mount is
  a public ingress by default decision that deserves explicit metadata.

## Scope

**In scope**: `host/src/routes/api.ts` (derived mounts), contract metadata
plumbing in `every-plugin`/`@orpc` usage, tests for mount derivation.
**Out of scope**: replacing `pluginsClient` (in-process composition),
`servicesTag` (non-HTTP-shaped host needs — auth), or per-request tenant
runtime resolution (separate design line in `plans/`).

## Verify

- `bun run --cwd host test` green (plus the known 2 deploy-gated
  `runtime-remote` failures — see README verification gates).
- `bos publish --deploy --cdn platform` E2E still serves bundles identically.

## STOP conditions

- If oRPC contract metadata cannot express per-mount security declarations
  (public vs authed, body limit) without a new custom meta plugin — report and
  scope a `MetaPlugin` design first; do not ship prefix derivation without
  per-mount security metadata.
