---
title: "11 · Tenancy and direction"
description: How one platform serves many apps — lineage, tenants, the shared host — where hosting is going, and the directions the platform has recorded but not finished.
order: 110
tags:
  - book
---

# 11 · Tenancy and direction

Everything.dev is both an app and the base that other apps extend. This chapter is
about that second role: how apps relate, what a tenant may change, and which parts of
the picture are destination rather than present.

## Lineage and tenancy

Three config fields carry the whole model:

| Field | Meaning |
|---|---|
| `extends` | The lineage edge — which runtime this one inherits from |
| `account` | The tenant namespace root for the active runtime |
| `domain` | The public ingress — where it is served, not what it inherits |

A runtime can be a child in lineage and still be a tenant root operationally, on its
own domain. Nested namespaces — a sub-tenant under its parent's account — are the
intended shape, but the resolver does not implement the full nested model today.

## The shared host

Many tenants can share one host instance, one API, and one auth service, differing
only in the UI they show. The host boots once from a base runtime and resolves each
tenant per request:

| A tenant may override | Fixed to the base |
|---|---|
| The UI (`app.ui`) | The host, the API, auth |
| An existing plugin's UI and sidebar entry | Server-side plugin loading and route mounting |

Tenant SSR is granted per tenant, and the host reads each tenant's bindings from the
API, cached briefly. The alternative — an own-instance child on its own domain —
overrides anything, because it is its own runtime.

Because passkeys are bound to the gateway origin, a tenant on a custom domain signs
users in with a NEAR wallet or device link rather than a passkey; the cross-app
wallet claim covers wallets created elsewhere.
([ADR 0013](../adr/0013-passkeys-bound-to-gateway-origin.md),
[ADR 0039](../adr/0039-cross-app-wallet-claim.md))

## Hosting, today and next

Today the platform runs on Railway. The root runtime is image-backed: the deploy
train pushes the image, smoke-tests it, and redeploys the service against its digest.
A child's instance is the same image with the child's identity, so its deploy is
just a redeploy.

The recorded direction is to stop treating hosting as per-app CI plumbing
([ADR 0035](../adr/0035-deploy-console-hosting-adapter.md), *proposed*):

- one thin **hosting adapter** is the only coupling to a substrate — deploy, report,
  restart, stop — so Docker, Railway, or another provider is a wiring change;
- a **reconciler** converges each instance to the latest published composition,
  making *publish the deploy* and removing per-child infrastructure credentials;
- rollback republishes the previous verified snapshot first, then restarts against it.

Until it lands, a child's Railway leg depends on its token: with none the leg is
skipped and the running instance keeps its boot-time config; with a project token it
redeploys; with a workspace token it also repoints the service to the pinned release.

## Where the repository is going

| Direction | Status | What it says |
|---|---|---|
| Verifiable apps and a runtime composer | Accepted, phased | The repository decomposes into standalone apps plus a thin composer that consumes them only through typed clients, with an `every-app` seam between module and composer |
| Renderer-agnostic UI readiness | Accepted, in progress | Contracts move to Effect Schema through Standard Schema, data access flows through `lib/queries/`, logic leaves `.tsx` — so a future renderer rewrites views only |
| Published source archives | Accepted | A runtime may publish its workspace source beside its dists; `bos import` prefers the archive over GitHub |
| Deploy console and reconciler | Proposed | Above |
| Sandboxes, an import-map browser plane, a TanStack Start host | Deferred | Recorded as plans, re-entered when a concrete need appears |

([ADR 0027](../adr/0027-apps-decomposition-every-app.md),
[ADR 0050](../adr/0050-renderer-agnostic-ui-readiness.md),
[ADR 0030](../adr/0030-published-source-archives.md))

The distinction matters when you plan: **accepted** means the decision is made and
work may be partial; **proposed** means the design exists but is not committed;
**deferred** means deliberately parked. Each ADR states its own status, and the
[plans index](../plans/README.md) tracks the execution.

## Check it

- `bos manifest` — the release this runtime resolves to through its chain.
- `bos config` — the merged result of the lineage.

## Further reading

- The [`everything-dev#super-app`](../../packages/everything-dev/skills/super-app/SKILL.md) skill — setting up a base runtime with tenant apps.
- ADRs [0027](../adr/0027-apps-decomposition-every-app.md), [0035](../adr/0035-deploy-console-hosting-adapter.md), [0050](../adr/0050-renderer-agnostic-ui-readiness.md).
- [Target state](../plans/target-state/README.md) and the [decision maps](../plans/wayfinder/beta-v2-map.md) — the longer view and the open questions.
- Next: [12 · Contributing](12-contributing.md).
