# ADR 0026: pnpm workspace, node runtime — one toolchain for parent and scaffolded children (v2 clean break)

Date: 2026-10-04
Status: Accepted

## Context

Bun is currently load-bearing in four distinct roles, and they have different
migration costs:

1. **Installer + lockfile** — `bun install --frozen-lockfile`, `bun.lock`,
   `bunfig.toml` (`linker = "hoisted"`, `ignore-scripts = true`), catalogs
   under `workspaces.catalog` in the root `package.json`.
2. **Script runner** — every root/child script chains through `bun run`,
   `bun run --cwd X`, `bunx playwright`.
3. **TS-from-source dev runtime** — `bun --conditions=development cli.ts`
   runs the CLI without a build step; the orchestrator's spawn chain
   (`bun run` → bin scripts → bun children) inherits the `development`
   condition so framework packages resolve source over stale dist
   ([ADR 0018](./0018-session-single-owner.md)).
4. **Image base** — `oven/bun:1.4.2-alpine` for every Dockerfile stage;
   the universal runtime image's `CMD` is `bun run start`
   ([ADR 0021](./0021-universal-runtime-image.md)).

Three audit facts make the migration cheaper than the coupling suggests:

- **Zero Bun API usage.** No `Bun.*` globals or `bun:` imports exist in
  `host/`, `ui/`, `api/`, `plugins/`, or the framework packages. Bun is only
  ever an installer and a process runner; nothing depends on bun semantics.
- **The node-side conditions mechanism already exists.** The service
  descriptor for the host already sets `NODE_OPTIONS=--conditions=development`
  for node-based spawns. `NODE_OPTIONS` propagates through every child
  process regardless of runtime, so the ADR 0018 source-resolution guarantee
  ports to node uniformly — the bun-flag chaining in the orchestrator can be
  deleted rather than ported.
- **`bunfig.toml` is two lines** and maps directly to pnpm configuration.

Meanwhile the strategic pressure: the platform expects app units (ui/host/api)
to vary by stack — Solid UIs, native shells, alternate runtimes — and each
stack needs its **own singleton-alignment catalog** (react19 today, solid
later) while sharing server-side alignment (Effect, oRPC, pg). pnpm's named
catalogs are the ecosystem-standard shape for exactly this; bun's catalog
implementation would fork the alignment story from the ecosystem. Nx was
considered for orchestration and **rejected**: the prerequisite train
([ADR 0022](./0022-two-roots-app-and-workspace.md)) already encodes this
repo's freshness semantics (two roots, condition-based source resolution, MF
manifest pinning), and the train *is the product* — `everything-dev` sells
orchestration of exactly this shape to every scaffolded child. A second
orchestrator would make the parent build differently from its own children
and fail the deletion test.

## Decision

1. **pnpm is the only package manager — parent and all scaffolded children.**
   `bos init` emits a pnpm child (`packageManager` field, `pnpm-workspace.yaml`,
   pnpm-lock handling, `pnpm --filter` scripts). This is a **v2 clean break**:
   `everything-dev` ships as 2.0.0, v1 children have no upgrade path.

2. **node is the only runtime.** Bun is retired entirely: no `bunfig.toml`,
   no `bun.lock`, no `oven/bun` images, no `bun run`/`bunx` in any script.
   TS-from-source runs through `node --import tsx`; `tsx` is already a root
   devDependency. The uniform conditions mechanism is
   `NODE_OPTIONS=--conditions=development`, set by the orchestrator's spawn
   environment; the bun-flag special case is deleted.

3. **Catalogs move to `pnpm-workspace.yaml`.** The flat catalog migrates
   verbatim first; splitting into named alignment catalogs (`react19`,
   `server`, …) is the follow-up seam for multi-stack unit adapters.

4. **`@effect/oxc` becomes a `link:` dependency** on the vendored
   `repos/effect` package, replacing the `prepare`-script symlink hack.
   pnpm's default **isolated** linker is the target posture (matches the
   supply-chain goals in the security model); `node-linker=hoisted` is the
   budgeted escape hatch — and may be retained for the image's runtime stage
   specifically, whose prod-builder prunes a hoisted `node_modules` tree.

5. **The universal image is node-based** (`node:` + corepack pnpm). The
   runtime stage's node_modules provisioning strategy (prune-and-copy vs
   `pnpm deploy --prod`) is re-derived in the image ticket; the acceptance is
   behavioral equivalence, not implementation identity. `pnpm publish`
   replaces `catalog:` ranges at release time; changesets keeps its role.

6. **Stray-bun guardrails.** `bun install` auto-migrates `pnpm-lock.yaml` and
   rewrites workspace/catalog state back into `package.json` — a silent
   revert of this ADR. Guardrails: the `packageManager` field, a CI step
   asserting no `bun.lock` exists, and an AGENTS.md warning.

## Consequences

- One toolchain end to end: `pnpm install && pnpm dev` is the whole onboarding
  story for parent and children; the "bun runtime vs pnpm install" hybrid and
  its double-adapter cost are avoided.
- The orchestrator's spawn logic gets simpler (one code path, node-first);
  the `--conditions=development` guarantee holds through env propagation
  rather than bun CLI chaining.
- Existing v1 children (pre-2.0.0 scaffolds) must re-init or hand-migrate;
  acceptable because v2 has not shipped.
- The Dockerfile's manifests-first-COPY NOTE must be re-verified under pnpm's
  resolution semantics — the one place a silent behavioral difference is
  plausible; gated by the full regression suite.
- Every workspace manifest keeps `catalog:` references unchanged; the catalog
  *location* moves but the per-package protocol does not.
- Follow-ups this ADR enables but does not execute: named catalogs per
  alignment domain; the stack-adapter interface in `every-plugin`
  (`framework` × `environment`) for federated UI variants.
