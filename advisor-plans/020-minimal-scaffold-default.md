# Plan 020: Minimal scaffold as the default `bos init` path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes the default path of a user-facing command)
- **Depends on**: 014 (ResolvedChainContext — the minimal path resolves the chain for catalogs)
- **Category**: product direction (ticket #90)
- **Planned at**: 2026-09-15, decision recorded on #90

## Decision (recorded on ticket #90)

1. **Default `bos init` → minimal scaffold** (config-only, 4 files, no downloads) —
   even when the parent chain declares a `repository`. **Sparse fetch** (download the
   parent tarball once, extract only the selected override workspaces' patterns)
   happens only when the user explicitly vendors source for a workspace.
   **`--full`** preserves today's behavior as an opt-out.
2. **Snapshot semantics for config-only children**: a **config snapshot** —
   `sha256` of the resolved parent config + resolved workspace catalog + the
   child's override/plugin selection — written to `.bos/sync-snapshot.json` in
   place of the per-file map. `bos status` reports `lastSync`; `bos sync` on a
   config-only child compares the parent's current config hash and reports drift
   as a proposal (it never file-merges a child that has no framework files).
   Children that vendor source (sparse path) get the normal per-file snapshot for
   the extracted patterns — that is how "ui-only children update UI templates".
3. **Plugin selection stays config-only by default**: selecting plugins copies
   their config entries into the child's `bos.config.json` (remote loading via
   Module Federation, types from deployed manifests). Plugin **source** is only
   fetched when explicitly vendoring (sparse path), which is the local-plugin-dev
   case.

## Current state

- `resolveSourceDir` (`everything-dev/src/cli/init.ts:173-210`) returns `""` only when
  no ancestor declares a repository → the minimal scaffold
  (`scaffoldMinimalProject`, `init.ts:1118-1231`) is unreachable for the common case
  (a parent published from GitHub).
- The handler gates on `isMinimalScaffold = sourceDir === ""`
  (`everything-dev/src/plugin.ts:1474`); the tarball branch alone writes a sync
  snapshot (`plugin.ts:1541`) and personalizes AGENTS.md (`:1549-1551`).
- `downloadTarball` (`init.ts:339-403`) always downloads and fully extracts the repo
  tarball; `copyFilteredFiles` then glob-filters the selected patterns.
- `SyncSnapshot` (`cli/snapshot.ts`) is `{ parentRef, timestamp, files }`;
  `status.ts:85-96` reports `lastSync: snapshot?.timestamp` → `undefined` for
  minimal children today.

## Steps

1. **Input surface**: add `full` (boolean, default `false`) and a source-vendoring
   notion to `InitOptionsSchema` (`contract.ts:266-276`) — e.g.
   `vendorSource: ("ui" | "api" | "host" | "plugins")[]` — and to the interactive
   prompt (`prompts.ts:90-136`): after "What do you want to customize?", ask
   "Copy source for the selected workspaces? (default: no — remotes load at
   runtime)".
2. **Handler gating** (`plugin.ts:1460-1552`): replace
   `isMinimalScaffold = sourceDir === ""` with
   `useMinimal = !input.full && !input.vendorSource?.length`. The minimal branch runs
   `scaffoldMinimalProject` regardless of `sourceDir`; keep `resolveSourceDir`
   available for the sparse/full branches (it should be skipped entirely — no
   tarball download — when `useMinimal`, per plan 014's call-count budget).
3. **Sparse fetch**: when vendoring source and `sourceDir` resolves to a tarball,
   pass the selected patterns (`buildInitPatterns` output) to the extraction —
   `tar.extract({ file, cwd, onReadEntry })` filtering entry names, or extract to a
   temp dir and glob as today but only for the selected patterns (either satisfies
   "download once, extract only what's selected"; pick after benchmarking in-step).
   `--full` extracts everything as today.
4. **Config snapshot**: extend `SyncSnapshot` with optional `configHash: string`
   and make `files` optional. `scaffoldMinimalProject` (or the handler's minimal
   branch) computes the hash from the resolved parent config + resolved catalog +
   selection, and writes the snapshot. `status.ts` unchanged (timestamp present).
   `syncTemplate` (`sync.ts:412-706`): when the snapshot has `configHash` and no
   files, recompute the parent hash and report drift ("parent runtime changed since
   init: <fields>") instead of running the file loop; exit without rewriting
   anything.
5. **AGENTS.md for minimal children**: `personalizeAgentsMd`
   (`init.ts:1613-1629`) early-returns when no AGENTS.md exists. Ship a default
   child AGENTS.md template inside `everything-dev` (the intent-skills block +
   child instructions that `buildChildAgentsMd` produces) and write it for minimal
   children, so they get agent guidance + `bos sync` ownership markers.
6. **Chain resolution**: thread plan 014's `ResolvedChainContext` so the minimal
   path resolves the chain (parent config + catalogs) with one FastKV fetch per
   unique ancestor and zero tarballs.

## Verification

- `bun run --cwd packages/everything-dev test`:
  - `init.install-progress.test.ts` (scaffoldMinimalProject) still green.
  - New: handler-level test — parent config **with** `repository` set, no
    `vendorSource`, no `full` → minimal branch taken, no tarball download
    (stub `downloadTarball`, assert zero calls).
  - New: `vendorSource: ["ui"]` → exactly one tarball download, only `ui/**` +
    root patterns extracted.
  - New: minimal child → `.bos/sync-snapshot.json` has `configHash`, no `files`;
    `bos status` reports `lastSync`; `bos sync` reports drift when the parent
    config hash changes and exits clean when it matches.
  - `init.structure.test.ts` / `init.full.test.ts` (CI) unchanged for `--full`.
- `bun typecheck`, `bun lint`, `bun run build` in `packages/everything-dev`.
- Manual: `bos init` from a published parent (this runtime) — should complete in
  seconds with no tarball activity; `bos dev` boots against the parent's remotes.

## STOP conditions

- Extraction filtering proves materially slower or flakier than full extract for
  realistic parents — fall back to "download once, full extract, glob as today"
  (the download is the dominant cost; note it and continue).
- The config-hash drift UX conflicts with env-specific extends
  (`env-specific-extends.test.ts` semantics) — stop for design review rather than
  special-casing inside sync.
- Any behavior change to `--full` runs — that path is frozen as the compatibility
  escape hatch.
