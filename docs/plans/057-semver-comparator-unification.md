# Plan 057: Unify semver comparison and range satisfaction — one rc-aware module, five call sites

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- packages/everything-dev/src/services/status.ts packages/everything-dev/src/services/deploy/owed.ts packages/everything-dev/src/services/platform/manifest.ts packages/everything-dev/src/services/federation/service.ts packages/everything-dev/src/services/deploy/platform-manifest.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (behavior changes: gates start rejecting versions they previously passed — that is the point, but it must be planned)
- **Depends on**: none
- **Category**: bug / tech-debt
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/638

## Why this matters

The platform ships exclusively in prerelease mode (`.changeset/pre.json`; every published framework version looks like `2.0.0-rc.N`). Five hand-rolled version comparators/range-checkers answer "is this version compatible?" — and they disagree. The worst case is the **platform compat gate** (`checkPlatformCompat`, which guards the release-pin lifecycle per ADR 0034): its comparator parses the prerelease segment but never compares it, so `1.60.0-rc.1` vs `1.60.0-rc.7` — the most common comparison on this repo's rc train — returns **equal**. A second checker silently accepts any exact pin (`=1.2.3` always passes). Every new gate copies one of the five variants and inherits a fresh bug. One shared module fixes all of them at once.

## Current state

Five implementations, four files:

1. **The reference implementation (correct)** — `packages/everything-dev/src/services/status.ts:88-102`, `compareSemver(a, b)`: rc-aware; unparseable inputs compare **equal** (return 0 — documented: "the update check must never fire on versions it cannot order"). Its `comparePrerelease` helper (`status.ts:65-86`) implements the semver spec: release outranks prerelease, numeric identifiers compare numerically, longer prerelease lists outrank shorter equal prefixes.

```ts
// status.ts:94-102
export function compareSemver(a: string | undefined, b: string | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < left.core.length; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i]! < right.core[i]! ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}
```

2. **Also correct** — `packages/everything-dev/src/services/deploy/owed.ts:145-176`, `compareVersions(a, b)`: a second, independently written rc-aware comparator. Semantically equivalent to status.ts's (numeric-when-numeric identifiers at :170-172, release-vs-prerelease at :164-165, longer-list-wins at :175). Callers: the deploy "owed work" decision.

3. **THE BUG (prerelease-blind)** — `packages/everything-dev/src/services/platform/manifest.ts:207-227`. `parseSemver` captures the prerelease group (`...(match[4] ? { prerelease: match[4] } : {})` at :216) but `compareSemver` only diffs major/minor/patch:

```ts
// platform/manifest.ts:220-227 — prerelease is parsed but NEVER compared
function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return a === b ? 0 : a < b ? -1 : 1;   // lexicographic fallback — unique to this copy
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
```

   It is used by `checkPlatformCompat` (`platform/manifest.ts:247-266`): `< minChild` (compat floor) and `> frameworkVersion` (newer-than-release) checks.

4. **THE SECOND BUG (exact pins always pass)** — `packages/everything-dev/src/services/federation/service.ts:200-231`, `satisfiesConstraint(version, constraint)`:

```ts
// federation/service.ts:203-207 — any non-caret constraint that reaches here returns TRUE
if (!["^", "~", ">", "<", "=", "x"].some((c) => trimmed.startsWith(c))) {
  return version === trimmed;
}
const m = /^\s*\^\s*(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
if (!m) return true;                    // ← "=1.2.3", "~1.2.3", ">1.0.0" all silently pass
```

   So an exact shared-dep pin `=1.2.3` (or a `~`/`>`/`<` pin) written into the platform manifest's `sharedDeps` is **always satisfied**. Additionally, the prerelease fill `const c = cPre[i] ?? "0"` (:219-220) makes a longer version prerelease *fail* a constraint it should pass (`1.0.0-rc.1.1` fails `^1.0.0-rc.1`; node-semver accepts it).

5. **Fifth consumer** — `packages/everything-dev/src/services/deploy/platform-manifest.ts:99-118`, `platformTruthViolations` calls `satisfiesConstraint(version, pin.version)` at :108 — this is the deploy train's truth gate ("a stale install publishes a manifest that lies about the uploaded bytes"). Same always-true bug applies to any exact pin it checks.

**Repo conventions to follow**: no comments in implementation code (house rule); typed errors via `Data.TaggedError`; table-driven vitest suites. Exemplar for a small pure utils module with tests: `packages/everything-dev/src/utils/timing.ts` and its test file. This work must stay consistent with ADR 0034 (`docs/adr/0034-platform-release-manifest.md`) — quote for context: "the child's framework version must sit inside the release's compat window, and strict singletons must agree exactly with the release's pins" (comment at `platform/manifest.ts:241-245`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (also regenerates gitignored `.gen.ts` files) | `pnpm run typecheck` | exit 0 |
| Lint (Biome + Effect rules) | `pnpm run lint` | exit 0 |
| Framework package tests | `pnpm run test:framework` | all pass |
| Targeted suite | `pnpm --filter everything-dev test` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/everything-dev/src/utils/semver.ts` (create)
- `packages/everything-dev/src/utils/semver.test.ts` (create)
- `packages/everything-dev/src/services/status.ts` (delete local impl, import shared)
- `packages/everything-dev/src/services/deploy/owed.ts` (delete local impl, import shared)
- `packages/everything-dev/src/services/platform/manifest.ts` (delete local impl, import shared)
- `packages/everything-dev/src/services/federation/service.ts` (delete local impl, import shared)
- `packages/everything-dev/src/services/deploy/platform-manifest.ts` (import shared — no local impl there)

**Out of scope** (do NOT touch, even though they look related):
- `packages/everything-dev/src/services/deploy/image.ts:102-127` (`computeImageTags` parses prerelease for image tag naming — no comparison; unifying it changes image tags)
- `packages/everything-dev/src/services/workspace/shared-deps.ts` (`extractSemverExact` — extraction only, no comparison)
- The gate *policies* (what counts as a violation) — this plan fixes ordering/satisfaction mechanics only; see "Behavior changes to expect" below.

## Git workflow

- Branch: `feat/semver-unification`
- Commit style: conventional commits, e.g. `fix(everything-dev): unify semver comparators into utils/semver — compat gate becomes rc-aware`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `packages/everything-dev/src/utils/semver.ts`

Export exactly three functions:

- `compareSemver(a: string | undefined, b: string | undefined): number` — port `status.ts`'s implementation verbatim (it is the reference: spec-correct prerelease ordering, unparseable → 0, no lexicographic fallback).
- `satisfiesConstraint(version: string, constraint: string): boolean` — rewrite with these rules:
  - empty constraint → true
  - `^x.y.z(-pre)?` → same major, `>= x.y.z`, plus the prerelease rules below
  - `~x.y.z` → same major.minor, `>= x.y.z`
  - `=x.y.z` or bare `x.y.z` → exact match
  - `>v` / `<v` → strict comparison via `compareSemver`
  - **Prerelease rule (fixing the `?? "0"` bug):** a constraint with a prerelease segment matches versions `>= constraint` whose prerelease compares `>=` the constraint's — implement by reducing both sides to `compareSemver(version, normalizedFloor) >= 0` where `normalizedFloor` carries the constraint's prerelease; do NOT pad missing identifiers with `"0"`. If you find yourself inventing identifier padding, STOP — see STOP conditions.
  - a version with a prerelease segment does NOT satisfy a constraint without one (preserve current behavior at `federation/service.ts:229`).
- `satisfiesRange(version: string, range: string): boolean` — only if you find multi-constraint strings (`"||"`-separated) in any call site; if no call site needs it, do not create it.

Keep the module comment-free (house rule); name things so the docstrings in the call sites keep explaining intent.

**Verify**: `pnpm --filter everything-dev exec tsc --noEmit -p tsconfig.json 2>&1 | head -5` → no errors mentioning `utils/semver` (the file compiles standalone).

### Step 2: Table-driven tests in `packages/everything-dev/src/utils/semver.test.ts`

Model the file structure after `packages/everything-dev/src/utils/timing` tests if present, otherwise a plain vitest describe/it table. Required rows (each an assertion that would have failed on the old copies):

compareSemver:
- `2.0.0-rc.9 < 2.0.0-rc.10 < 2.0.0-rc.11 < 2.0.0` (the rc-train ordering — the core bug)
- `1.60.0-rc.1` vs `1.60.0-rc.7` → not equal
- `1.0.0` vs `1.0.0-rc.1` → 1.0.0 is newer
- `1.0.0-rc.1` vs `1.0.0-rc.1.1` → rc.1.1 is newer (longer identifier wins)
- `1.0.0-rc.1` vs `1.0.0-rc.1.beta` → numeric outranks alphanumeric (rc.1.beta is newer)
- unparseable (`"abc"`, `undefined`) vs anything → 0
- `1.0.0-alpha` vs `1.0.0-alpha.1` → alpha.1 newer

satisfiesConstraint:
- `("1.2.3", "=1.2.3")` → true; `("1.2.4", "=1.2.3")` → **false** (the always-true bug)
- `("1.2.3", "1.2.3")` → true (bare = exact)
- `("1.5.0", "^1.2.3")` → true; `("2.0.0", "^1.2.3")` → false
- `("1.2.0", "^1.2.3")` → false
- `("1.2.9", "~1.2.3")` → true; `("1.3.0", "~1.2.3")` → false
- `("1.0.0-rc.7", "^1.0.0-rc.1")` → true; `("1.0.0-rc.0", "^1.0.0-rc.1")` → false
- `("1.0.0-rc.1.1", "^1.0.0-rc.1")` → true (the `?? "0"` bug)
- `("1.0.1", "^1.0.0-rc.1")` → false (stable does not satisfy a prerelease constraint)
- `("1.0.0-rc.1", ">1.0.0-rc.0")` → true
- empty constraint → true

**Verify**: `pnpm --filter everything-dev test -- semver` → all new tests pass.

### Step 3: Swap call site 1 — `status.ts`

Delete `status.ts`'s local `compareSemver` + `comparePrerelease` + `parseVersion` (keep anything else in the file intact) and import from `../utils/semver`. Preserve the existing JSDoc on the export. Callers inside the package (`cli/status.ts:25`, `cli/commands/inspect.ts:49,78`) need no changes — the export signature is identical.

**Verify**: `pnpm run typecheck` → exit 0.

### Step 4: Swap call site 2 — `owed.ts`

Same treatment for `compareVersions` (`owed.ts:147-176`). If other `owed.ts` internals use `compareVersions` keep the import local to the file. Note: `compareVersions` and `compareSemver` are the same function — pick ONE name in the shared module (`compareSemver`) and alias at the import if the local name reads better.

**Verify**: `pnpm run typecheck` → exit 0.

### Step 5: Swap call site 3 — `platform/manifest.ts` (this is the behavior change)

Replace `platform/manifest.ts:220-227`'s local `compareSemver` with the shared import. `checkPlatformCompat` (`:247-266`) now gains prerelease ordering. The unparseable fallback changes from lexicographic-string to return-0 — that is the intended reference semantics ("never gate on versions you cannot order").

**Verify**: `pnpm --filter everything-dev test -- platform-manifest` → existing tests at `tests/unit/platform-manifest.test.ts:119-155` still pass. Some may now fail *because they encoded the old blind behavior* — if so, that is expected: update the test expectation to the rc-aware answer and note each changed expectation in the commit message. Do not weaken a test that asserts a correct rc ordering; do not "fix" the implementation to match an old assertion without reporting it (STOP condition).

### Step 6: Swap call sites 4+5 — `federation/service.ts` and `deploy/platform-manifest.ts`

Replace `satisfiesConstraint` in `federation/service.ts:200-231` with the shared import (its callers: `checkFederationCompat` shared-dep checks at `federation/service.ts:387-521` and `platform/manifest.ts:289` inside `checkPlatformCompat`). Replace the usage in `platformTruthViolations` (`deploy/platform-manifest.ts:108`) with the same import.

**Verify**: `pnpm run typecheck && pnpm run test:framework` → exit 0, all pass.

### Step 7: Full gates

**Verify**:
- `pnpm run lint` → exit 0
- `pnpm run test:framework` → all pass
- `grep -rn "compareVersions\|compareSemver\|satisfiesConstraint" packages/everything-dev/src --include="*.ts" | grep -v "utils/semver"` → only import lines and call sites, no local `function` definitions

## Behavior changes to expect (put these in the PR description)

1. **Compat floor becomes rc-aware**: a child pinned *older* rc than the release floor (e.g. child `rc.1` vs floor `rc.3`) now fails `checkPlatformCompat` where it silently passed. Correct behavior; expect it to surface stale children on the next `bos upgrade --check`.
2. **Newer-than-release becomes rc-aware**: a child pinned to a *newer* rc than the release (e.g. child `rc.7` vs release `rc.5` — the normal mid-train state right after the root republishes) now fails the `platformVersion > frameworkVersion` check. **Operator story (decided in the audit that produced this plan): treat it as a violation with a message pointing at `bos upgrade`** — during the pin-lifecycle window the child's re-pin is the fix, and silence here is what let #546-class skew through. If the message reads as if the child must downgrade, reword the message (out of scope to change policy).
3. **Exact shared-dep pins are enforced**: `=x.y.z` pins in the release manifest now actually reject mismatched built versions in `platformTruthViolations` and `checkFederationCompat`. If any published manifest currently uses `=` pins, the first deploy after this lands will fail loud — that is the truth gate working. Check `.bos/platform-manifest.json` (gitignored cache) / the published manifest for `=` pins before shipping; report findings.

## Test plan

- New: `packages/everything-dev/src/utils/semver.test.ts` (Step 2 rows).
- Existing: `tests/unit/platform-manifest.test.ts:119-155` and `tests/integration/platform-upgrade-e2e.test.ts:451` — must pass, with only expectation updates justified by the rc-aware semantics (documented per Step 5).
- Verification: `pnpm run test:framework` → all pass, including the new file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm run test:framework` exits 0
- [ ] `pnpm run lint` exits 0
- [ ] `grep -rn "function compareSemver\|function compareVersions\|function satisfiesConstraint" packages/everything-dev/src` returns only the `utils/semver.ts` definition(s)
- [ ] `packages/everything-dev/src/utils/semver.test.ts` exists and passes the Step 2 rows
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts (drift).
- An existing test asserts rc-blind ordering and its *intent* is unclear (i.e. you cannot tell whether it encodes the old bug or a real product requirement).
- Implementing `satisfiesConstraint`'s prerelease rule requires identifier padding or heuristic guessing — report the cases instead of inventing semantics.
- The rc-aware "newer than release" check (behavior change 2) turns out to fire in a CI/deploy path on every run (i.e. the operator story above is wrong for a live automation) — report which path.
- You find a sixth comparator or a range grammar (`||`, `x-ranges`, `>=`+`<` pairs) used by any caller.

## Maintenance notes

- Every future version-gate must import from `utils/semver` — a reviewer should reject any new inline version comparison. Consider a lint rule later (deferred; not this plan).
- `checkPlatformCompat`'s call sites are `handlers/upgrade.ts:579` (mf-check) and `:683` (platform manifest route) — if those move, only the import path matters.
- Deferred follow-up: the two "correct" comparators in `status.ts`/`owed.ts` accepted `undefined` (status) vs `string` (owed) — the shared module keeps the `string | undefined` union; callers that always pass strings need no change.
