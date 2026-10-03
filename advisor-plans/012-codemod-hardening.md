# Plan 012: Harden the Effect-provide codemod — one replacer, no stale offsets, run once

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/everything-dev/src/cli/upgrade.ts packages/everything-dev/tests/unit/upgrade-scoped-layer.test.ts packages/everything-dev/src/cli/snapshot.ts`
> If any in-scope file changed since this plan was written (plan 006 touches `upgrade.ts` — its `LEGACY_DIST_IMPORT_REWRITES` edit is expected drift), compare "Current state" against live code; on a mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: MED
- **Depends on**: done/001-buildscoped-helper.md (the codemod may emit `buildScoped` after 001 lands — see Step 4)
- **Category**: bug / tech-debt
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

The `bos upgrade` codemod rewrites legacy `Effect.provide(Layer)` call sites into the Effect 4 scoped-layer pattern. Two problems: (1) **latent file corruption** — `rewritePipeEffectProvideForm` iterates calls in reverse but slices the result using offsets computed against the ORIGINAL source; when a later call's tag text sits earlier in the file than an earlier call's pipe expression, the earlier edit shifts those offsets and the splice corrupts the file. (2) The two rewriters (`rewriteTwoArgEffectProvideForm` ~lines 1014-1082 and `rewritePipeEffectProvideForm` ~lines 1011-1048) are near-duplicates that build the byte-identical replacement string at lines ~1034 and ~1080. (3) This one-time migration surgery runs on **every** `bos upgrade`, forever, over `plugins/*/src/index.ts` and `api/src/index.ts` — every future upgrade re-runs regex surgery on user source with skip-warnings as the only safety net.

## Current state

- `packages/everything-dev/src/cli/upgrade.ts:1011-1048` — `rewritePipeEffectProvideForm`: reverse iteration + stale-offset slicing. The replacement built at ~1034:

```ts
`Layer.buildWithScope(${layerExpr}, yield* Effect.scope).pipe(Effect.map((context) => Context.get(context, ${tag})))`
```

- `upgrade.ts:1014-1082` — `rewriteTwoArgEffectProvideForm`: same scan/derive/warn shape, self-contained per-match edits (no offset bug), identical replacement string at ~1080.
- `upgrade.ts:949-956` — `deriveTagFromLayerExpr` hard-codes naming conventions `XxxLive → XxxTag` / `XxxLayer → XxxTag`.
- `upgrade.ts:1231-1232` — `rewriteLegacyPluginScopedLayerPatterns(...)` runs on every upgrade, forever.
- `upgrade.ts` also contains `balancedParenEnd(source, openIdx)` — a balanced-paren scanner; NOTE its convention: pass the index AFTER the opening paren; it returns the index of the matching close paren.
- `packages/everything-dev/tests/unit/upgrade-scoped-layer.test.ts:29-310` — covers single-call-per-file cases ONLY; no multi-call interleaved fixture (the offset bug's trigger).
- `packages/everything-dev/src/cli/snapshot.ts` — the sync snapshot mechanism that records upgrade state for child projects (the natural home for a "codemod already applied" marker — read it to find the marker format before Step 4).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420+ pass (2 skipped) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success |

## Scope

**In scope**:
- `packages/everything-dev/src/cli/upgrade.ts` (the two rewriters, the shared replacement builder, the one-shot gate)
- `packages/everything-dev/src/cli/snapshot.ts` (only to read/record the one-shot marker)
- `packages/everything-dev/tests/unit/upgrade-scoped-layer.test.ts` (+ new fixtures)

**Out of scope**:
- `rewriteLegacyDistImports` (plan 006 owns it).
- Any other codemod rewriters in upgrade.ts beyond the two Effect-provide forms.
- The deriveTag naming-convention coupling (a heuristic that is fine to keep — flag improvements in the report, don't redesign).
- Actually running `bos upgrade` against this repo (this repo is the parent; the codemod targets child projects).

## Git workflow

- Branch: `improve/012-codemod-hardening`.
- Commit style: `fix(everything-dev): codemod offset corruption + one-shot gating` (tests-first commits welcome).
- Do NOT push unless instructed.

## Steps

### Step 1: Write the failing fixture (the offset bug)

Add a test to `upgrade-scoped-layer.test.ts` with ONE source file containing TWO pipe-form `Effect.provide` calls whose regions INTERLEAVE textually: call A's `Layer` expression appears BEFORE call B's tag text in the file, while A's `pipe(...)` close sits AFTER B's (construct concretely: `const a = makeService(AThingsLive).pipe(Effect.provide(AContext))` near the top and `const b = ... Effect.provide(BContext))` such that reverse-ordered edits shift A's offsets — mirror the loop/slice logic at `upgrade.ts:1011-1048` to construct a genuinely interleaved case). Assert the current output is corrupted (characters lost/duplicated, or non-compilable result). Record the corrupted output in your report.

**Verify**: the new test FAILS against current code (red — this is the bug being pinned).

### Step 2: Consolidate into one replacer

Extract a single replacement path both forms feed:
- One `buildScopedLayerReplacement(layerExpr, tagExpr)` returning the replacement string (or, if plan 001 has landed, the `buildScoped(Tag, Layer)` call form — prefer that and note it).
- One candidate-normalizer producing `{ tag, layer, range } | { warn }` for both the two-arg and pipe forms.
- A replacer that **rebuilds the output string per edit** (accumulate edits into a fresh string, or re-scan offsets after each splice) — never slices with offsets computed against a prior state. Apply edits in FORWARD document order over the original source using end-anchored splices (safe because each edit range is derived from the original and edits don't overlap — assert non-overlap and warn-and-skip otherwise, matching the existing warn semantics).

**Verify**: the Step 1 fixture now PASSES (green); the full existing single-call fixtures pass unchanged; `cd packages/everything-dev && bun run test` → green.

### Step 3: Gate the rewrites as one-shot

- In `snapshot.ts`, define a snapshot marker (follow the existing marker format — e.g. a key like `codemods: { effect4ScopedLayer: true }`) recorded after the rewriters run.
- In `upgrade.ts:1231`, skip `rewriteLegacyPluginScopedLayerPatterns` when the marker is present; write the marker after a successful run.
- Migration for existing snapshots: absence of the marker means "not yet applied" — the first upgraded-run applies (idempotent rewrites: they match nothing once sources are migrated) and then records it. Assert idempotency in a test: run the rewriter twice on the same fixture, second run makes zero edits and writes the marker.

**Verify**: new tests — marker present → rewriter skipped; marker absent → runs, writes marker, second run no-ops; `bun run test` → green.

### Step 4: Full gates + build

`cd packages/everything-dev && bun run build`; `bun typecheck && bun lint`.

**Verify**: all green per the commands table.

## Test plan

- The interleaved two-call fixture (Step 1→2) — the corruption regression.
- Existing 10 single-call fixtures unchanged.
- One-shot marker tests (Step 3): skip-when-marked, write-after-run, idempotent second run.
- Optional: a fixture mixing one two-arg and one pipe-form call in the same file (exercises the shared replacer across forms).

## Done criteria

- [ ] Interleaved fixture passes; corruption no longer reproducible
- [ ] `grep -c "Layer.buildWithScope(" packages/everything-dev/src/cli/upgrade.ts` → replacement string appears exactly once (in the shared builder) or zero times (if emitting `buildScoped`)
- [ ] One-shot marker honored: tests prove skip/write/idempotency
- [ ] `bun typecheck`, `bun lint`, everything-dev suite (420+) pass
- [ ] Changeset added (everything-dev patch/minor)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- You cannot construct an input where the stale-offset path actually corrupts output (the bug may be unreachable due to a guard you find) — then pin the interleaved case as a passing regression test instead, report the guard, and skip the replacer rebuild's urgency (still do the consolidation + gating).
- The snapshot format in `snapshot.ts` resists a codemod marker without a format migration — report the options rather than inventing a parallel state file.
- Rewriting the replacer breaks more than the two intended forms' fixtures.

## Maintenance notes

- The codemod is transitional: after one minor-version window with the one-shot marker in the wild, DELETE the rewriters entirely (note it in the changeset as time-boxed code).
- Reviewer: scrutinize the non-overlap assertion — silent overlap-skip must warn like the existing skip paths, not drop edits quietly.
- If plan 001 landed before this plan, the emitted form is `buildScoped(...)` — keep a fixture asserting that form so the two plans' outputs stay aligned.
