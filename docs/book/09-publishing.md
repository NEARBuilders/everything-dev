---
title: "09 · Publishing"
description: How a runtime reaches its users — the on-chain registry, the deploy train, immutable artifacts, the release manifest, and how a child app ships without ever building an image.
order: 90
tags:
  - book
---

# 09 · Publishing

Publishing turns an authored config and a set of builds into a live runtime. It is
one command, it is atomic where it counts, and a failed run leaves the previous
release fully live.

## The registry

Runtime configs live in **FastKV**, a key-value contract on NEAR, under
`bos://<account>/<gateway>`. Two properties shape everything built on it:

- **The namespace is the signer.** A value is readable under an account only if that
  account signed the write. Publishing *is* proving ownership, and a leaked publish
  key can only damage its own namespace.
- **Writes are indexed, not executed.** The write is recorded from the transaction
  itself, so `bos publish` submits it and then treats the **read-back** as the only
  authoritative success check.

Four typed keys hang from each runtime, and nothing builds those paths by hand:

| Key | Content |
|---|---|
| `apps/<account>/<gateway>/bos.config.json` | The runtime config |
| `apps/<account>/<gateway>/manifest.json` | A thin tag — the current release's version and digest |
| `apps/<account>/<gateway>/versions/<v>.json` | The immutable record for one release, written once |
| `apps/<account>/<gateway>/deploys/<ts>.json` | One audit record per deploy |

([ADR 0001](../adr/0001-fastkv-registry-namespace-signer.md),
[ADR 0040](../adr/0040-registry-wire-cutover.md))

## Who signs

`bos login` is the usual path: one browser trip that mints a scoped deploy key and a
registry key limited to the account's own namespace. CI carries a scoped
function-call key as a secret. A runtime without a wallet can publish through a
**custody wallet** — a TEE-held key registered at login — whose account becomes the
deploy's machine identity.

## The deploy train

`bos deploy` runs a sequence of stages and legs, ordered so that no failure can leave
a half-deployed runtime:

**preflight → build → upload → publish → image → smoke → redeploy**

- **Preflight** checks config, signing, and storage credentials before anything builds.
- **Build** runs through the prerequisite train.
- **Upload** writes content-addressed artifacts: hashed entrypoints, immutable
  chunks, and a version manifest carrying the SRI of every file.
- **Publish** writes the config with read-back confirmation.
- **Image** is pushed *before* anything is published, so a failed push cannot leave a
  partially published deploy.
- **Smoke** boots that exact image against the just-published config. A red smoke
  rolls the config back before failing the job.

**The deploy unit is additive.** New bytes go live under new names; the publish is
the pointer switch. An aborted train is therefore a no-op rather than a broken site.
([ADR 0020](../adr/0020-child-bundle-storage-r2.md))

## Releases

The platform moves on a release train. A **platform release manifest** records, for
one framework version, the catalog, the exact shared-singleton versions, the image
reference, and the template inventory. An app pins it with one field — `release:` —
and everything derives: the dependencies, the image, the sync source, and the exact
bytes of every inherited remote. A root publish cannot move what a pinned app runs;
`bos upgrade` is the only thing that moves it.

Releases are cut with changesets. A changeset against `everything-dev` means "cut a
release including everything merged so far"; the version PR it opens is merged by
hand, and that merge *is* the release.
([ADR 0034](../adr/0034-platform-release-manifest.md))

## Children never ship images

A child app's deploy is: build its own workspaces, upload them, publish its config.
Its instance runs the universal image and picks up the new config on redeploy,
because the runtime boots identity-driven from the registry. The same image, the same
host code — only the config differs.

## Check it

- `bos manifest` — the release the runtime resolves to; `--check` adds the compatibility gate.
- `bos upgrade --check` — exits non-zero when a newer release is available.
- `/.well-known/version` — a deployed runtime's fingerprint and per-remote digests.
- The registry keys above are public — read them.

## Further reading

- [Self-deployed production](../self-deploy.md) — the step-by-step guide to shipping on your own account.
- [The publish-to-user deploy flow](../agents/deploy-flow.md) — what a publish changes, rollback, and what a failing deploy looks like.
- The [`everything-dev#publish-sync`](../../packages/everything-dev/skills/publish-sync/SKILL.md) and [`everything-dev#registry`](../../packages/everything-dev/skills/registry/SKILL.md) skills.
- ADRs [0001](../adr/0001-fastkv-registry-namespace-signer.md), [0020](../adr/0020-child-bundle-storage-r2.md), [0021](../adr/0021-universal-runtime-image.md) (the universal image), [0034](../adr/0034-platform-release-manifest.md), [0040](../adr/0040-registry-wire-cutover.md).
- Next: [10 · Verification](10-verification.md).
