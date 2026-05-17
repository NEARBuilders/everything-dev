---
name: super-app
description: Build shared-host, shared-API super apps with tenant-specific UI composition. Use when setting up a base runtime plus custom tenant apps, configuring fixed-core multi-tenancy, or reasoning about what tenants can override today.
metadata:
  sources: "host/src/services/tenant-runtime.ts,host/src/program.ts,host/src/services/federation.server.ts,packages/everything-dev/src/config.ts"
---

# Super Apps

Use this skill for the shared-host pattern where one runtime owns the host, auth, API, and base plugin set, while many tenant apps extend that runtime and swap UI-facing pieces per request.

## Mental Model

- The base runtime is the server core and trust boundary.
- Tenant apps are published BOS configs that extend the base runtime.
- The host resolves the tenant config from the request hostname.
- In fixed-core mode, the host, auth, API, and server-side plugins stay fixed to the base runtime.
- Tenant-specific UI composition is applied per request.

Example mapping:
- `linktree.com` -> base runtime `bos://linktree.near/linktree.com`
- `alice.linktree.com` -> tenant runtime `bos://alice.near/linktree.com`

## What Works Today

Supported tenant overrides in fixed-core mode:
- `app.ui`
- existing `plugins.<id>.ui`
- existing `plugins.<id>.sidebar`

Still fixed to the base runtime:
- `app.host`
- `app.api`
- `app.auth`
- server-side plugin loading and router mounting

Not part of this mode:
- tenant-specific API overrides
- tenant-specific auth overrides
- introducing new plugin IDs dynamically per tenant
- full per-request host/plugin/auth/api hot swap

## Setup Flow

### 1. Create the base runtime

The base runtime owns the shared host and API surface:

```bash
bos init --overrides ui,api,host
```

This app is the one you deploy as the shared host.

### 2. Publish the base runtime

The base runtime must be published before tenants can extend it:

```bash
bos publish --deploy
```

### 3. Create a tenant app that extends the base runtime

Tenant `bos.config.json`:

```json
{
  "extends": "bos://linktree.near/linktree.com",
  "account": "alice.near",
  "domain": "linktree.com",
  "repository": "https://github.com/example/alice-app",
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

You can also override existing plugin UIs and sidebar entries for tenant-specific navigation.

## Host Env For Tenant Mode

The shared host uses these env vars to resolve tenants:

```bash
NETWORK_ID=mainnet
ALLOW_OVERRIDE=ui,plugins.*
TENANT_WHITELIST=alice.near,bob.near
ALLOW_UNTRUSTED_SSR=false
```

Meaning:
- `NETWORK_ID` controls whether subdomains resolve to `.near` or `.testnet`
- `ALLOW_OVERRIDE` controls which tenant config sections can affect request-scoped composition
- `TENANT_WHITELIST` controls which tenants may use SSR
- `ALLOW_UNTRUSTED_SSR=true` allows SSR for any valid tenant with SSR config

## Resolution Rules

Tenant resolution is convention-based:
- bare domain serves the base runtime
- a single subdomain label resolves to a tenant account
- nested labels are rejected in tenant mode

The tenant config must:
- exist in FastKV
- extend the base runtime
- resolve to the expected tenant account
- provide integrity for overridden remote UIs

## Security Model

- Tenant UI overrides are integrity-checked before trust is established.
- Integrity verification uses bounded streaming, not full-response buffering.
- Asset requests use stale-while-revalidate verification to avoid latency spikes.
- HTML and SSR requests use blocking verification.
- SSR module cache identity includes `ssrIntegrity`, not just the SSR URL.

## Recommended Workflow

For the base runtime:

```bash
bos dev --host remote
bos publish --deploy
```

For a tenant UI app:

```bash
bos dev --host remote --api remote
bos publish --deploy
```

After publishing config changes that affect the base host runtime, restart the host process so it reloads the latest base config snapshot.

## When To Load Other Skills

- Use `everything-dev#init-upgrade` for scaffold/sync/upgrade mechanics.
- Use `everything-dev#extends-config` for deep-merge and resolved-config semantics.
- Use `everything-dev#publish-sync` for publish and deploy steps.
- Use this `super-app` skill when the question is specifically about the shared-host, shared-API multi-tenant architecture.
