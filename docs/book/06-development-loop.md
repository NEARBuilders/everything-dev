---
title: "06 · The development loop"
description: What bos dev actually does — preflight, ports, process supervision, logs — what hot reload reaches and what needs a restart, and the two rules that keep builds honest.
order: 60
tags:
  - book
---

# 06 · The development loop

`pnpm run dev` starts the whole runtime from source: host, UI, API, auth, and every
local plugin, with the same databases and the same composition code production uses.
It needs no `.env` and no external services. The loop is tuned so that the code you
edit is the code being served — and when it is not, the loop says so.

## What happens on boot

1. **Preflight** repairs retired state once and refuses unsafe setups — two services
   pointed at one PGlite directory, for example.
2. **The seed phase** runs when the config declares one, before anything serves.
3. **The prerequisite train** checks each framework package's dist and rebuilds only
   what is stale. A failure is loud; a silent skip shipping stale dists is not allowed.
4. **Ports** are allocated as one block, validated and acquired atomically.
5. **Units are spawned** and supervised until each reports ready.

## Ports are scoped resources

One base port derives the whole layout — host `N`, API `N+1`, auth `N+2`, UI `N+3`,
plugins from `N+10` — so the defaults are UI `3003`, API `3001`, auth `3002`. If the
preferred block is busy, the session takes the next one and says who holds the old
one; the drift is announced but never persisted. Only ports you pass explicitly are
remembered, and a pinned port that is occupied fails instead of moving. A port cannot
outlive the session that owns it. ([ADR 0012](../adr/0012-ports-as-scoped-resources.md))

`bos ps` lists the tracked processes; `bos kill` stops them, escalating from SIGTERM
to SIGKILL and verifying the ports are actually free.

## One supervision core, two policies

Every unit — a child process, the in-process host, or a bare readiness probe — ends
in `ready`, `failed`, or `down`. There is no fourth, silent state, and a failed start
never yields a handle.

| Mode | A failed unit means |
|---|---|
| `dev` | Restart on a bounded, jittered schedule; then a loud `failed` |
| `start` | The session fails and the container exits non-zero — the boot verdict the deploy smoke watches |

Readiness is an HTTP probe against each unit's readiness path, never a pattern
matched on log output. Production never restarts a failed unit: restarts exist to
keep development flowing, not to mask failure. ([ADR 0048](../adr/0048-the-boot-seam.md))

## Logs

Every process's output passes through one pipeline — normalize multi-line records,
classify by level and category, filter by level — and fans out to three sinks that
agree by construction: the screen tail and its export show the filtered stream; the
file under `.bos/logs/` receives everything. `--log-level` or `BOS_LOG_LEVEL=info`
restores the bootstrap chatter that is hidden by default; `DEBUG=1` shows all.
([ADR 0016](../adr/0016-unified-log-pipeline.md))

## What hot reload reaches

| You edit | Reaches the browser or API |
|---|---|
| UI source | On the next request — each compose is pinned to one build generation, so a rebuilt tree is served whole or not at all |
| A plugin's backend | Within seconds of its rebuild — the host adopts the new generation without a restart |
| The `api` or `auth` workspace | After a `bos dev` restart |

The last row is the one to remember. Host-mediated routes for `api` and `auth` mount
through the API handler, the MCP route, and the session middleware, so they stay
frozen at boot until the stack restarts.
([ADR 0049](../adr/0049-generation-scoped-ssr-composition.md),
[ADR 0051](../adr/0051-dev-plugin-adopt.md))

## Two resolution rules

Stale build output is the classic way for a monorepo to lie to itself. Two rules
close it:

- **Bundler-configuration code resolves from source.** A build config can never
  silently drop a setting because a package's dist is stale.
- **Shipped code resolves from dist, and the train guarantees freshness.** Build
  through the train — `pnpm run build [target]` — which refreshes every prerequisite
  first. Raw per-workspace builds bypass it and are unsupported.

Generated files (`*.gen.*` — route trees, types, entries) are rewritten by `dev`,
`build`, and `typecheck`. Never edit them, and never expect them to be committed.
([ADR 0018](../adr/0018-session-single-owner.md))

## Working against the platform instead of locally

To find out whether a bug is yours or the platform's, run with the piece in question
loaded remotely — `bos dev --ui remote`, `--api remote`, or `--proxy` — and see
whether it still reproduces against the pinned release.

## Check it

- `bos ps` — processes, roles, ports.
- `.bos/logs/` — the ground truth for anything that happened.
- `pnpm run typecheck` — regenerates types first, so it is self-sufficient.

## Further reading

- The [`everything-dev#dev-workflow`](../../packages/everything-dev/skills/dev-workflow/SKILL.md) skill — starting servers, hot reload, the service-descriptor architecture.
- [Seed phase](../seed-phase.md) — declaring idempotent seed steps.
- ADRs [0012](../adr/0012-ports-as-scoped-resources.md), [0016](../adr/0016-unified-log-pipeline.md), [0048](../adr/0048-the-boot-seam.md) — the dev session's three mechanisms; [0049](../adr/0049-generation-scoped-ssr-composition.md) and [0051](../adr/0051-dev-plugin-adopt.md) — hot reload; [0018](../adr/0018-session-single-owner.md) — the resolution rules.
- Next: [07 · Data](07-data.md).
