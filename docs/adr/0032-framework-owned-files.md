# ADR 0032: Framework-owned files — inventory, marker, and the upstream-change protocol

Date: 2026-10-20
Status: Accepted

Depends on: ADR 0023 (ui stubs generated, not synced), ADR 0031 (package shape).

## Context

`bos sync` reconciles a fixed set of child-repo files from the parent template — the framework-owned set. Two problems compounded:

1. **The ownership knowledge had no single home.** The inventory lived as private data inside the sync engine (`FRAMEWORK_OWNED_SYNC_FILES` plus per-plugin regexes in `sync.ts`), with a second independent encoding in the sync fan-out loops and a third in init's copy patterns. The encodings had already drifted — the predicate matched a `tsconfig.contract.json` file that does not exist anywhere and is never synced.
2. **The per-file markers lied in both directions.** Six files carried a "BE CAREFUL MODIFYING THIS FILE — changes will be overwritten" header despite leaving the sync-owned set (ADR 0023), telling agents not to edit app-owned files; most genuinely owned files carried no marker at all. And the header text itself was the wrong message: it reads as "do not modify", when the actual semantics are *edit is allowed, template wins on the next sync, your copy is backed up, and an upstream change makes it permanent*. Agents consequently refused legitimate edits to framework-owned files.

Meanwhile the upgrade flow conflated version movement with template drift: a same-version upgrade (`v2 → v2`) still ran the full template sync, so framework-owned files could be rewritten even when the framework version had not changed.

## Decision

1. **One inventory, one home.** `services/scaffold/ownership.ts` is the authoritative definition of framework ownership: `FRAMEWORK_OWNED_SYNC_FILES`, the per-plugin predicate `isFrameworkOwnedSyncFile`, `RETIRED_SYNC_FILES`, `AGENT_SYNC_GLOBS`, and the canonical marker text `FRAMEWORK_OWNED_HEADER`. Sync, prune, the guardrail tests, and this ADR all reference it. The ghost `tsconfig.contract.json` branch is deleted. (The rspack entries stay: no current scaffold ships `rspack.config.js`, but children scaffolded earlier may still carry one, and the predicate protects it.)
2. **Three file classes, named exactly:**
   - **App-owned** — everything not in the inventory: routes, components, lib, `router.tsx`, `app.ts`, plugin `contract.ts`/`index.ts`. Sync never considers them.
   - **Framework-owned** — the inventory above: reconciled from the parent template by `bos sync` / `bos upgrade`, with three-way hash comparison, template-wins-on-conflict, and backups under `.bos/sync-backup/`.
   - **Generated stubs** — gitignored `*.gen.*` files emitted by dev/build/typecheck (ADR 0023). Never edited, never synced.
3. **Same-version upgrades never touch framework-owned files.** `upgradeTemplate` decides the sync policy at the one place that knows the version delta and passes it explicitly (`{ templateSync }`) into the migration phase: `templateSync: false` when the framework version is unchanged, `true` on a version change (and for the post-install re-exec). `bos sync` remains the explicit drift-pull for template changes that land without a version bump.
4. **The marker says what agents need.** Every commentable framework-owned file carries the canonical header: what owns the file, that local edits are allowed (with the backup semantics), and the upstream-issue URL. Non-commentable JSON (`package.json`, `bos.config.json`, `biome.json`, `.changeset/config.json`) stays unmarked — the inventory is its source of truth. Vendored agent-skill content under `.agents/skills/` and `docs/agents/` is framework-owned but carries no marker (verbatim upstream copies; `skills-lock.json` is the provenance record).
5. **The upstream-change protocol (ADR 0032's standard for changing the framework).** Local edits to framework-owned files are legitimate — make them, run everything, keep the repo green; sync will back the divergent copy up when the template eventually moves. But a local edit to framework behavior is a **fork claim**: to make it permanent, file an issue against the framework repo (https://github.com/NEARBuilders/everything-dev/issues) describing the change — the framework team implements it in the parent repo and ships it in package versions (PR + changeset), after which the child's local copy and the template converge. What belongs in the framework is anything a second app would need; what belongs in the app is anything only this app needs. Framework behavior ships in package versions, not file copies — the file-copy mechanism is the legacy this ADR documents and beta-v2 Phase 8 retires.

## Consequences

- The new headers change template bytes, so children's next version-change sync updates the owned files cleanly (their local copies match the snapshot); children with local edits to owned files take the backup path, as designed.
- `renderEnvFile` emits the marker for generated `.env.example` files, so the generator and the synced template agree.
- The guardrail test pins marker ↔ inventory agreement: a file carrying the marker must be in the inventory, and no file outside it may carry the marker.
- The upgrade renderer states the same-version no-op explicitly and prints the issue protocol on conflicts; the sync renderer shares the same outcome block.
