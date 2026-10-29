# Plan 058: Encode the tsgo/oxlint lockstep mechanically — Renovate rules, exact typescript pin, vendored-Effect staleness guard

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- package.json pnpm-workspace.yaml .github/renovate.json scripts/`
> On any mismatch, compare the "Current state" excerpts against the live files before proceeding; on a conflict, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / tech-debt (supply-chain/tooling hardening)
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/639

## Why this matters

The repo's TypeScript toolchain is a version triple that must move in lockstep: `@effect/tsgo` patches the installed `typescript` (tsgo) binary and Oxlint with its Effect language-service plugin, and its supported-components matrix is narrow (per `node_modules/@effect/tsgo/README.md`: oxlint `1.81.0`/`1.82.0`, oxlint-tsgolint `7.0.2001`). Today the only defense is tribal knowledge ("bump all three together; reject PRs that don't") — and worse, the Renovate config **automerges patch bumps of devDependencies**, so a lone `oxlint 1.82.0 → 1.82.x` PR is the *configured default path* to breaking `pnpm run prepare` and every workspace's patched `tsc`. Separately, the vendored Effect clone is dual-pinned (prepare script tag vs catalog) with no cross-check: bumping the catalog `effect` pin does NOT re-clone `repos/effect`, so the `@effect/oxc` link silently points at stale sources.

## Current state

- `package.json:5` — the prepare script:

```json
"prepare": "test -d repos/effect/.git || git clone --depth 1 --branch effect@4.0.0-rc.117 https://github.com/Effect-TS/effect.git repos/effect; effect-tsgo patch --oxlint"
```

  Note: `effect-tsgo patch --oxlint` is the final command, so a patch failure DOES fail prepare (do not "add" verification that already exists). The real gap is `test -d repos/effect/.git ||` — an existing clone is never checked against the catalog pin.
- `package.json:85,90,91` — `@effect/tsgo ^0.45.0` (devDependencies, caret), `oxlint 1.82.0` (exact), `oxlint-tsgolint 7.0.2001` (exact).
- `package.json:103` — `"@effect/oxc": "link:repos/effect/packages/tools/oxc"` — the link target is the gitignored vendored clone.
- `pnpm-workspace.yaml:65` — catalog `effect: 4.0.0-rc.117` (exact). `pnpm-workspace.yaml:83-84` — overrides `"@effect/platform-node": 4.0.0-rc.117`, `"@effect/platform-node-shared": 4.0.0-rc.117` — a **third place** the rc pin lives.
- `pnpm-workspace.yaml:74` — catalog `typescript: ^7.0.2` (caret — will silently accept a `7.1.x` that tsgo's patch may not support; the tsgo README matrix lists `7.0.2` and `7.1.0-dev…`).
- `.github/renovate.json:48-52` — the dangerous rule:

```json
{
  "matchDepTypes": ["devDependencies"],
  "matchUpdateTypes": ["patch"],
  "automerge": true
}
```

  There is NO packageRule grouping `@effect/tsgo`/`oxlint`/`oxlint-tsgolint`. Renovate packageRules: later rules win over earlier ones for matching updates.
- CI installs with `--ignore-scripts` and runs `pnpm run prepare` explicitly (`.github/workflows/ci.yml` — two jobs call `pnpm run prepare` before lint/typecheck); nothing validates the triple beyond the patch command itself.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Validate renovate config parses | `pnpm exec renovate-config-validator .github/renovate.json` | exit 0 (if renovate CLI unavailable, validate JSON syntax: `node -e "JSON.parse(require('fs').readFileSync('.github/renovate.json','utf8'))" && echo OK`) |
| Run the new staleness guard | `node --import tsx scripts/check-effect-pin.ts` | exit 0, prints the resolved tag |
| Full prepare (after guard wiring) | `pnpm run prepare` | exit 0 |
| Lint | `pnpm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `.github/renovate.json` (add group rule; exclude the triple from the devDeps-patch automerge rule)
- `pnpm-workspace.yaml` (pin `typescript` exactly)
- `scripts/check-effect-pin.ts` (create)
- `package.json` (prepare script gains the guard invocation)

**Out of scope**:
- Bumping any of the three toolchain packages (this plan only encodes the *rule* that they move together).
- Restructuring `repos/` vendoring (the upstream Effect dev toolchain's design; the repo adopted it deliberately).
- Renovate schedule/limits/minimumReleaseAge policy.

## Git workflow

- Branch: `feat/toolchain-lockstep-guards`
- Commit style: conventional commits, e.g. `chore(ci): enforce tsgo/oxlint lockstep in Renovate + guard vendored Effect tag`

## Steps

### Step 1: Group rule in `.github/renovate.json`

Add this packageRule **before** the `matchDepTypes: devDependencies` patch-automerge rule (Renovate applies the last matching rule's value per setting — a later `automerge: false` wins over the earlier `automerge: true`, but ordering the group first and adding an explicit exclusion keeps intent readable):

```json
{
  "matchPackageNames": ["@effect/tsgo", "oxlint", "oxlint-tsgolint"],
  "groupName": "effect tsgo toolchain (lockstep — bump together)",
  "automerge": false,
  "separateMajorMinor": false
}
```

Then make the devDeps-patch automerge rule explicitly not catch the group (belt and suspenders so future rule edits can't silently re-enable it):

```json
{
  "matchDepTypes": ["devDependencies"],
  "matchUpdateTypes": ["patch"],
  "automerge": true,
  "matchPackagePatterns": ["!oxlint", "!oxlint-tsgolint", "!@effect/tsgo"]
}
```

**Verify**: `node -e "JSON.parse(require('fs').readFileSync('.github/renovate.json','utf8'))" && echo OK` → `OK`.

### Step 2: Pin `typescript` exactly in `pnpm-workspace.yaml`

Change `pnpm-workspace.yaml:74` from `typescript: ^7.0.2` to `typescript: 7.0.2`. tsgo patches the installed binary; a caret-resolved `7.1.x` would break the patch outside anyone's control. Bumps of this pin should ride the same manual PR as `@effect/tsgo`.

**Verify**: `grep -n "typescript:" pnpm-workspace.yaml` → shows `typescript: 7.0.2`.

### Step 3: Create `scripts/check-effect-pin.ts`

A small read-only guard script (match the style of sibling scripts like `scripts/skills-check.mjs`):

1. Read `pnpm-workspace.yaml`, extract the catalog `effect:` value (expected today: `4.0.0-rc.117`) and the `overrides` values for `@effect/platform-node` / `@effect/platform-node-shared`. All three must be **identical** — fail with a message naming each location if they differ.
2. Resolve the vendored clone's actual tag: run `git -C repos/effect describe --tags --exact-match` (fall back to `git -C repos/effect rev-parse HEAD` output as `<missing-tag>`). Compare against the catalog value in the `effect@<version>` form (`effect@4.0.0-rc.117`). On mismatch: fail with instructions — `git -C repos/effect fetch --tags && git -C repos/effect checkout effect@<pin>` or "delete repos/ and re-run pnpm run prepare".
3. If `repos/effect` does not exist at all, print an informational line ("vendored clone absent — prepare will create it") and exit 0 (first-clone case is not drift).

Use `yaml` (already a root dependency) to parse the workspace file; do not regex YAML.

**Verify**: `node --import tsx scripts/check-effect-pin.ts` → exit 0 with the resolved tag printed; then deliberately test the failure path: `git -C repos/effect checkout -q effect@4.0.0-rc.116 2>/dev/null || true; node --import tsx scripts/check-effect-pin.ts` → non-zero exit with the mismatch message. Restore: `git -C repos/effect checkout -q effect@4.0.0-rc.117`.

### Step 4: Wire the guard into `prepare`

Change `package.json:5` so the guard runs before the clone/patch (and can also *replace* the stale clone):

```json
"prepare": "node --import tsx scripts/check-effect-pin.ts; test -d repos/effect/.git || git clone --depth 1 --branch effect@4.0.0-rc.117 https://github.com/Effect-TS/effect.git repos/effect; effect-tsgo patch --oxlint"
```

(Keep the guard non-fatal in the absent-clone case so a fresh checkout's first `pnpm install` still works; the guard exits 0 in that case by design, so plain `;` chaining is correct.)

**Verify**: `pnpm run prepare` → exit 0. Then simulate the drift it exists to catch: `git -C repos/effect checkout -q effect@4.0.0-rc.116; pnpm run prepare` → prepare exits non-zero with the guard's message (do NOT let prepare continue to clone/patch with a stale tree). Restore with `git -C repos/effect checkout -q effect@4.0.0-rc.117 && pnpm run prepare` → exit 0.

### Step 5: Gates

**Verify**:
- `pnpm run lint` → exit 0
- `git status` → only the four in-scope files modified

## Test plan

- The guard script is verified by the Step 3/4 manual checks (positive + drift + absent-clone paths). If the repo's convention favors a vitest wrapper for scripts, add `scripts/check-effect-pin.test.ts` covering the YAML-extraction helper only (pure function: given workspace YAML text → `{catalog, overrides}`); keep the git subprocess out of unit tests. Model after any existing `scripts/*.test.mjs` if present; otherwise skip the unit test — the manual verification is the gate.
- Renovate config has no local test runner; the JSON-parse validation is the gate. Note in the PR body that the next Wednesday run should show one grouped PR for the triple instead of separate automerged ones.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -A4 '"effect tsgo toolchain' .github/renovate.json` finds the group rule with `"automerge": false`
- [ ] The devDeps patch-automerge rule contains the three `!`-exclusions
- [ ] `grep -n "typescript:" pnpm-workspace.yaml` shows the exact pin (no caret)
- [ ] `node --import tsx scripts/check-effect-pin.ts` exits 0
- [ ] `pnpm run prepare` exits 0
- [ ] `pnpm run lint` exits 0
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The installed `@effect/tsgo`'s supported-components matrix (check `node_modules/@effect/tsgo/README.md`) no longer lists the installed oxlint/oxlint-tsgolint versions — the triple is already out of lockstep before this plan; report the actual matrix.
- The catalog `effect` value and the prepare-script tag disagree **today** (the drift already happened) — report both values; do not silently re-clone.
- Renovate's schema rejects `matchPackageNames` combined with the exclusion pattern syntax (Renovate config formats change); report the validation error instead of inventing alternative syntax.
- `pnpm run prepare` fails on the patch step for reasons unrelated to the guard (toolchain mismatch introduced upstream).

## Maintenance notes

- When bumping the toolchain: one PR bumps `@effect/tsgo`, `oxlint`, `oxlint-tsgolint` **and** (if required by the new tsgo) the exact `typescript` catalog pin together; the vendored Effect tag only changes when the `effect` catalog pin changes.
- The guard's three-way rc-pin check (catalog + both overrides) will catch the most likely drift: a Renovate catalog PR updating `effect` but not the overrides.
- Reviewer scrutiny: confirm the exclusion list in the automerge rule matches the group's package names exactly.
- Deferred: deriving the prepare-script clone tag FROM the catalog (one pin instead of two) — needs a script that edits `package.json` or the clone command reading YAML at runtime; propose as follow-up only if the guard proves noisy.
