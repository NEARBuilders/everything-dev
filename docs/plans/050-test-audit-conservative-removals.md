# 050 — Test audit: remove dead, tautological, and exactly-duplicated tests

Written against commit `d1bc2e3c` (2026-10-11). Produced by a `/improve` test-audit session (all test surfaces; conservative posture — HIGH-confidence removals only). Findings verified by hand against the cited files; every removal below is a pure deletion with a green-suite verification gate.

## Context

The repo's test-value rules (AGENTS.md, "Test value rules") ban tautology tests, prefer E2E for user-observable behavior, and reserve unit tests for what E2E can't reach. A full audit (~283 vitest + 15 Playwright + ~17 Go spec files) found the suites are unusually clean — **no wide-scale redundancy exists** — but it did find:

- tests that contain **no assertions** and can never fail,
- tests that **re-implement the logic inline** and assert on their own local variables,
- **exact duplicates** of assertions made elsewhere against the same code path,
- **dead helpers** with no importers.

What remains in scope for other plans: CI wiring gaps (plan 051) and aggressive/judgment-call options (plan 052).

## What to remove

Each item lists the exact file/lines and the verification evidence. Delete precisely what is listed — do not delete neighboring tests that share the file.

### A. Dead tests (can never fail / no assertions)

**A1. `packages/every-plugin/tests/unit/type-diagnostics.test.ts` — DELETE the whole file.**
Both `it` blocks contain zero `expect()` calls — only `as`-cast type annotations (stripped by esbuild at runtime, so never verified) and `console.log`. A "Type Diagnostics" scratch pad; it cannot fail even if the `RegisteredPlugins` augmentation breaks.

**A2. `packages/everything-dev/tests/unit/materializer.test.ts:75-80` — DELETE the `it("Layer.succeed shape matches the Tag.Service contract")` block.**
Its body is `expect(Layer.isLayer(InfraMaterializerLive)).toBe(true)`, which is always true for any Layer value; the test's own comment concedes the type system guarantees it. The neighboring test (`:65-73`) already exercises the layer for real.

### B. Tautology tests

**B1. `packages/every-plugin/tests/integration/mf-loading.test.ts:20-28` — DELETE the `it("should test name transformation logic")` block.**
The test re-implements the name transformation inline (`pluginId.toLowerCase().replace(...)`) and asserts on its own local variables — no code from `src/` executes. The real normalization is covered by `tests/unit/identity.test.ts` and `tests/unit/normalize.test.ts`. Leave the other five tests in the file alone.

**B2. `host/tests/integration/runtime-remote.test.ts:97-99` and `:101-105` — DELETE the two tests in `describe("Remote runtime smoke config")`.**
- `:97` asserts `scenarios.length).toBeGreaterThan(0)` — the helper `host/tests/helpers/runtime-remote.ts:138-163,173-198` returns a hardcoded 3-element array unconditionally, so this can never fail. It is also the *only* test from this file that executes in the `deploy.yml` deploy-smoke job (`pnpm --filter host test:integration:remote`, deploy.yml:260) — today that CI step verifies nothing.
- `:101-105` filters `!candidate.available` and asserts `skipReason` is truthy — but `available` is defined as `!skipReason` (helper `:180,188,196`), so it restates a construction invariant.

Note: the suite these live in is itself dead-by-config-drift (it reads a `bos.config.json` that this repo no longer has — the authored config is `bos.app.ts`; see plan 052 for the repair-or-retire decision). Removing B2 is correct regardless of that decision.

### C. Exact-duplicate coverage

**C1. `packages/everything-dev/tests/integration/env-specific-extends.test.ts:5-65` — DELETE the entire `describe("env-specific extends resolution")` block (8 tests).**
It calls the pure function `resolveExtendsRef` with no fs/network and duplicates `packages/everything-dev/tests/unit/merge.test.ts:419-465` (`describe("resolveExtendsRef")`) nearly 1:1 (string-extends, dev/prod/staging selection, prod-fallback, first-defined-fallback, undefined/empty). Keep the second block (`:68+`, "env-specific extends in merge scenario") — that part has real fs fixtures and is not duplicated.

**C2. `packages/everything-dev/tests/integration/extends-chain.test.ts` — DELETE these four tests:**
- `:121-134` "child overrides parent scalars via extends" ≡ merge.test.ts:11-22 (same fixture, same account/domain/repository assertions)
- `:136-152` "null-sentinel does not inherit parent plugins" ≡ merge.test.ts:167-183 (byte-identical fixture)
- `:172-198` "deep merges app.api.shared..." ≡ merge.test.ts:38-66 (unit version is a strict superset — also asserts `strictVersion`)
- `:200-225` "secrets arrays are unioned across extends" ≡ merge.test.ts:203-226 (identical fixture and assertions)

Keep the rest of the file (real-fs resolved-config, circular detection, catalog-chain, multi-level merge — genuine integration value). Two further partial dupes (`:227-248`, `:267-283`) are listed as aggressive options in plan 052 — do not touch them in this plan.

**C3. `packages/everything-dev/tests/unit/storage-upload.test.ts:73-89` — DELETE `it("throws with the response status when the upload fails")`.**
Exact same failure mode as `storage-upload-retry.test.ts:53-60` ("does not retry a non-retryable status"): 403 → rejects `/403/` with exactly one fetch call. Keep the retry file's version (the retry file owns retry semantics); the neighboring tests in storage-upload.test.ts are distinct and stay.

**C4. `packages/every-plugin/tests/integration/plugin-lifecycle.test.ts:86-99` — DELETE `it("should handle validation errors with real plugin")`.**
Duplicate of `tests/integration/error-handling.test.ts:58` ("should handle missing required config"): same `usePlugin("test-plugin", { secrets: {} })`, same `validate-secrets` / `retryable: false` assertions.

**C5. `tests/regression/http/error_response_test.go:82` — DELETE `TestUnauthenticatedRouteReturnsJSONUnauthorized`.**
Exact duplicate of the `unauthorized` case in `TestErrorKindMapping` (same file, `:20` case entry): same URL `/api/errors?kind=unauthorized`, same 401 + `UNAUTHORIZED` + non-empty message + no-HTML assertions.

**C6. `tests/regression/http/openapi_test.go:65` — DELETE `TestOpenAPIDocValidJSON`.**
Asserts only 200 + parseable JSON on `/api/spec.json`; `TestOpenAPISurface` (`:33-41`) already fetches and parses the same body into a typed doc.

### D. Dead helpers (no importers — verified repo-wide grep)

**D1. `host/tests/helpers/bundled-host.ts` — DELETE the file.** Zero importers. Do NOT touch its sibling helpers (`ports`, `static-dist-server`, `test-env`) — those are used by other tests.

**D2. `tests/regression/browser/helpers/onboarding-seed.ts` — DELETE the file.** `seedOnboardingCodes()` has no consumer (no spec covers onboarding; grep matches only the definition).

**D3. `tests/regression/browser/helpers/seeded.ts:79` — DELETE the `loadSeedData()` export (and its `SeedData` type if it becomes unused).** The only reader of `.bos/regression/seed.json`; no spec imports it. The rest of `seeded.ts` is heavily used — leave it. While there, fix the stale error text at `seeded.ts:40` ("Run Go HTTP regression tests first" — the Go suite writes no cookie files; `global-setup.ts`/`member-seed.ts` do).

## Steps

1. Delete A1, D1, D2 (whole files).
2. Delete the precise blocks in A2, B1, B2, C1–C4, D3 per the line references above (re-grep the test names if line numbers drifted past `d1bc2e3c`; match on the quoted `it`/`describe` titles, never on line numbers alone).
3. Delete C5, C6 (Go test functions).
4. Verification, per workspace:

```bash
pnpm --filter every-plugin test:all        # every-plugin unit+integration green
pnpm run build everything-dev && pnpm --filter everything-dev test   # green (build first: tests import dist)
pnpm --filter host test                    # green (NODE_ENV=production pin inside the script)
pnpm run test:regression:http              # Go suite green, count drops by 2
pnpm run typecheck                         # clean — proves no deleted file was secretly imported
```

5. Grep for stragglers: `grep -rn "type-diagnostics\|bundled-host\|onboarding-seed\|loadSeedData\|seedOnboardingCodes" --exclude-dir=node_modules .` → zero hits (outside this plan).

## Done criteria

- All five verification commands green.
- The four deleted test names appear nowhere in the repo.
- `git diff --stat` shows only deletions in the files listed above (plus the one stale-comment fix in D3).

## Out of scope

- Any CI wiring change (plan 051).
- Deleting or repairing the host `runtime-remote` suite as a whole (plan 052 decision).
- Every MED/LOW-confidence finding (plan 052).
- The gitignored `.release/` staging mirror (cosmetic; no action).

## Maintenance note

The pattern to watch for in review: tests whose mock setup is the only thing under test (B-class) and integration files that re-test pure functions (C1/C2 grew when integration scaffolding was copied before unit coverage existed). When adding a test, first check whether `merge.test.ts` (config merging) or the existing suite already asserts the same branch.

## Escape hatches

- If `pnpm --filter host test` fails after B2 because `scenarios` is now unused in the file, remove the now-dead import — that is the only permitted code-touch beyond deletions.
- If any Go deletion breaks `go vet`/imports (e.g. a helper used only by the deleted test), remove that helper in the same commit.
- If a cited test turns out to have been already renamed/moved (drift past `d1bc2e3c`), STOP and report the new location instead of improvising.
