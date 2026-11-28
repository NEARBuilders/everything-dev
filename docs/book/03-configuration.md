---
title: "03 · Configuration"
description: bos.app.ts, extends, the dev overlay, the release pin, the lockfile — what you author, what derives from it, and which file owns which change.
order: 30
tags:
  - book
---

# 03 · Configuration

Configuration is one authored TypeScript file per app, plus one committed lockfile
that freezes what it resolved to. The rule underneath every mechanism in this
chapter: **authored values are few and deliberate; everything else derives.**

## The authored descriptor

[`bos.app.ts`](../../bos.app.ts) is the one file an app writes. It names the runtime
and declares which workspace fills each position in the composition:

```ts
import { App, Plugin, UI } from "everything-dev/descriptor";

export default App({
  name: "my-app",
  account: "my-app.near",
  domain: "my-app.example",
  extends: "bos://dev.everything.near/everything.dev",
  ui: UI({ path: "ui" }),
  plugins: {
    votes: Plugin("votes").path("plugins/votes", {
      secrets: ["VOTES_DATABASE_URL"],
    }),
  },
});
```

| You author | You never author |
|---|---|
| Identity: `account`, `domain`, `title` | Production URLs |
| The composition: which workspace fills which remote | Integrity hashes and version pins per bundle |
| `variables` — public values that ship in the published config | The resolved config |
| `secrets` — *names* only; values arrive at boot from the environment or the secrets vault | The lockfile's digests |
| The release the app tracks: `release: "<framework-version>"` | The image digest |

Variables and secrets are different kinds of thing. A variable is published and
readable by anyone (a SIWN recipient, a permission catalog); a secret is declared by
name, set with `bos secrets set` or an environment variable, and never echoed back.

## Inheritance

| Relationship | Rule |
|---|---|
| Child and parent (`extends`) | Deep-merged, child wins per key; `secrets` lists are unioned |
| A plugin the child declares | The child's entry replaces the parent's entry for that id; other plugins are inherited; `null` removes one |
| `bos.dev.ts` and `bos.app.ts` | The dev overlay wins — in development only, and it is never published |
| A `local:` workspace reference | Workspace-relative; stripped from the published payload so a child never inherits it |
| An authored value and a derived one | The derived value is written by the pipeline; authoring it is a mistake |

`extends` names a parent — a `bos://<account>/<gateway>` reference (one per
environment, or one for all) or an imported `App` value — and a chain can be several
runtimes deep. A plugin attachment can extend on its own:
`Plugin("notes").extends("bos://<account>/<app>#plugins.notes")` takes that app's
plugin, and its UI unless you set `ui: false`. A child inherits everything it does
not declare: the host, the API, auth, the plugins, the CDN, the permission catalog.
That is what lets an app be a few dozen lines.

## The release pin

`release:` records the one framework version an app tracks. Everything else follows
from the resolved release manifest: the dependency catalog, the image the app runs,
the source `bos sync` pulls from, and the inherited remotes' exact bytes. One field
in, no hand-correlated pins out. Absent means the latest release via `extends`.
([ADR 0034](../adr/0034-platform-release-manifest.md))

## The lockfile

`bos.lock.json` sits beside `bos.app.ts` and is committed. It is derived — never
hand-edited — and it is the **only committed runtime state**. It freezes two things:

- the **composition** — every remote's digest, the release, the shared-singleton versions;
- the **sync baseline** — per-file template hashes that `bos sync` compares against.

Everything under `.bos/` is local-only: the resolved config, logs, ports, caches.
`bos lock --check` fails CI when the lockfile no longer matches a fresh resolution —
the same role `pnpm install --frozen-lockfile` plays for dependencies.
([ADR 0042](../adr/0042-composition-lockfile.md),
[ADR 0047](../adr/0047-one-committed-artifact.md))

## Two roots

An app has two directories that can differ:

- the **app root** — the directory holding the `bos.app.ts` / `bos.dev.ts` pair. Every
  app fact anchors here: `.bos/` state, `.env*`, `local:` workspace paths.
- the **workspace root** — the nearest `package.json` declaring workspaces. It owns the
  catalog, the lockfile, `node_modules`, and framework package dists.

In a generated app they are the same directory. In a repository that keeps the app in
a subfolder they are not, and the CLI resolves each concern against the right one.
([ADR 0022](../adr/0022-two-roots-app-and-workspace.md))

## Check it

- `bos config` — the resolved config, with inherited values merged in.
- `bos lock --check` — the committed lockfile against a fresh resolution.
- `.bos/bos.resolved-config.json` — exactly what resolution produced.

## Further reading

- ADRs [0005](../adr/0005-app-ts-authored-descriptor.md), [0022](../adr/0022-two-roots-app-and-workspace.md), [0023](../adr/0023-ui-stubs-generated-not-synced.md), [0032](../adr/0032-framework-owned-files.md) (file ownership), [0042](../adr/0042-composition-lockfile.md), [0047](../adr/0047-one-committed-artifact.md).
- The [`everything-dev#extends-config`](../../packages/everything-dev/skills/extends-config/SKILL.md) skill — deep-merge semantics and the resolved-config lifecycle.
- The [`everything-dev#init-upgrade`](../../packages/everything-dev/skills/init-upgrade/SKILL.md) skill — scaffolding, syncing, and upgrading.
- [Seed phase](../seed-phase.md) — declaring idempotent seed steps in the same file.
- Next: [04 · Composition](04-composition.md).
