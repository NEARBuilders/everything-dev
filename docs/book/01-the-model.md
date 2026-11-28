---
title: "01 · The model"
description: One authored file declares a runtime, a generic host composes it at runtime, and every byte it runs is verified. The five ideas the platform rests on.
order: 10
tags:
  - book
---

# 01 · The model

everything.dev is an **open runtime for apps on NEAR**. A runtime is a published
configuration: one authored file declares what the app is, a generic host composes it
from independently deployed pieces at boot, and nothing it executes is taken on
trust. The platform is the framework that makes that loop — author, publish, compose,
verify — the same for every app built on it.

## The chain

```text
bos.app.ts
   │ bos deploy
   ▼
FastKV registry
bos://<account>/<gateway>
   │ resolved at boot, through extends
   ▼
host process ── loads ──▶ remote bundles
(universal image)         on the CDN
```

One authored file is the whole argument. `bos deploy` publishes it to the registry
under a NEAR account; the host resolves it through its `extends` chain at boot,
fetches what the chain says is published, and serves. The host never contains
app-specific code.

## Five load-bearing ideas

**1. One authored file is the whole argument.**
[`bos.app.ts`](../../bos.app.ts) declares the runtime: account, domain, which
workspaces fill which position, which variables and secret *names* each needs. Every
other artifact — the resolved config, the lockfile, the generated types, the runtime
map — derives from it. Production URLs and integrity hashes are pipeline state and
are never authored. ([ADR 0005](../adr/0005-app-ts-authored-descriptor.md))

**2. The host is generic; apps are data.**
One universal image serves every runtime. Identity selects the config:
`BOS_ACCOUNT` and `BOS_GATEWAY` name the registry entry to boot. No app builds its
own host, and no app ships an image.
([ADR 0021](../adr/0021-universal-runtime-image.md))

**3. Composition happens at runtime.**
The UI, the API, auth, and plugins are **remotes** — named positions filled by
bundles loaded over Module Federation. A plugin owns its route *content* (ordinary
TanStack route files); the host owns the route *graph* and builds it from each
remote's manifest. A plugin deploys on its own schedule without rebuilding the apps
that compose it. ([ADR 0007](../adr/0007-runtime-composition-ssr.md),
[ADR 0008](../adr/0008-manifest-composition.md))

**4. `extends` is inheritance, and the child wins.**
A runtime extends a parent and overrides only the remotes it cares about; everything
else is inherited. A runtime that extends another can still become the root of a new
tenant namespace on its own domain.

**5. Nothing is trusted transitively.**
The config lives on-chain, signed by the account that owns it. Bundle bytes are
content-addressed and pinned by SRI *inside that config*. The image is digest-pinned.
Each plane's bytes are verified against a pin recorded in a *different* plane, so
compromising any one of them is not enough.
([ADR 0036](../adr/0036-three-pin-planes.md))

## Fast bytes and slow bytes

The three planes move at different speeds, and that is a feature:

| Plane | What it holds | How it moves |
|---|---|---|
| Config | The resolved runtime config | An atomic, signed registry write — minutes |
| Bundles | UI and plugin bytes on the CDN | Content-addressed uploads, switched by a config publish — minutes |
| Image | Node, dependencies, host and API logic | A smoke-gated rebuild — rare |

An app change — a UI route, a plugin — is a config publish: no image, no instance
change. A runtime CVE is one image rebuild that patches every runtime at once.

## Runtime tiers

| Tier | Instance | Bundle bytes |
|---|---|---|
| Root runtime | The universal image | The CDN — the single distribution source |
| `*.<root>` shared-host tenant | None — the root host resolves it per request | Base workspaces from the root, its own UI override from the CDN |
| Own-domain child | The universal image with its own identity | Its own workspaces, uploaded at publish |
| Sandbox | Planned — not built | — |

## Check it

- `bos config` prints the resolved config the host will compose.
- `bos manifest` shows the platform release the runtime resolves to.
- `/.well-known/version` on a deployed runtime reports its fingerprint and per-remote digests.
- The registry key is public: `apps/<account>/<gateway>/bos.config.json`.

## Further reading

- [How it all fits](../agents/how-it-fits.md) — the same chain, drawn, with the verification spine.
- ADRs [0005](../adr/0005-app-ts-authored-descriptor.md), [0007](../adr/0007-runtime-composition-ssr.md), [0021](../adr/0021-universal-runtime-image.md), [0036](../adr/0036-three-pin-planes.md).
- The [`everything-dev#init-upgrade`](../../packages/everything-dev/skills/init-upgrade/SKILL.md) skill, to scaffold an app on the platform.
- Next: [02 · Anatomy of a runtime](02-anatomy.md).
