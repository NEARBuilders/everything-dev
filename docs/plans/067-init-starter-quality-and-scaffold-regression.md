# 067 — `bos init` starter quality: a born-healthy matrix driving the real init flow

Written against commit `b2410560` (2026-11-23). **v3 — revised twice in-session,
then executed same-day.** Phase 1 + 2 landed: the fixture
(`tests/helpers/child-fixture.ts`), the matrix (`init.matrix.test.ts` — 6
structure + 4 install cells, green), the boot gate (`init.boot.test.ts`), the
CI swap (`fresh-init-dev` vacuous job → `init-matrix` + `init-boot` on the
`ui-api` path gate), the born-healthy page in `docs/agents/testing.md`, and the
deletion ledger executed (8 files, ~1,590 lines → 2 matrix files + fixture).

**Defects the first real run caught** (the gate proving itself immediately):

| Defect | Consumer impact | Outcome |
|---|---|---|
| `generateDatabaseMigrations` ran `pnpm --dir api` from inside `api/` | every api-bearing `bos init` failed at the migrations leg | **fixed** (run from child root, `--dir <workspace>`) |
| ui pruner kept only the first barrel importer's names | advanced children failed typecheck (`Badge`/`InfoRow`/`SectionHeader` gone) | **fixed** (union semantics, `prune-barrel-union.test.ts`) |
| slim api template never exported `ContractType` | generated ui types didn't compile | **fixed** (export added) |
| `drizzle-orm` undeclared in the framework package | ui-only children: `bos` dead (`ERR_MODULE_NOT_FOUND`) | **fixed** (dependency declared) |
| inherited `ai` mount into stripped `_authenticated` | **every simple child fails `bos types gen`** | **fixed in the stacked follow-up** (#935 — engine + static model omit-with-warning; simple cell fully green, row deleted) |
| auth plugin publishes no `additionalExports` | no child passes ui typecheck (`Auth = any` stubs) | **producer fixed in the stacked follow-up** (#936 — `every-plugin.additionalExports` build knob; consumer republish pending, `KNOWN_DEFECTS` row stays until the auth plugin republishes) |
| advanced shipped parent-coupled routes (`deploys`→hosting api, `things`→votes/proposals) | routes exist but can never work in a child | **fixed** (`STARTER_PRODUCT_EXCLUSIONS` + coherence test) |
| children never received `tsconfig.base.json` | every `host`-override child failed `bos build` (`Tsconfig not found`) | **fixed** (`INIT_ROOT_PATTERNS`) |
| remote auth binds production-side in a child dev host → refused empty PGlite | `bos dev` host died for every child | **fixed** (`AUTH_ALLOW_PGLITE_DEFAULT=1` in `.env.example`) |

The boot gate (`init.boot.test.ts`) is green end to end for the advanced cell:
scaffold → framework links → install → types → **`bos build`** →
`upgrade --check` → `bos dev` boot → ui 200 / api answer → clean boot log →
graceful SIGTERM quit. The simple cell documents the mount defect's blocked
chain until issue 01 lands.

Deferred to follow-ups: the nightly published-source variant
(`BOS_INIT_SOURCE=published`), the browser smoke (Phase 3), the portfolio
consumer (Phase 5).


v1 added machinery (budget-parameterized helper, `start-stack.mjs --dir`, crawlers).
v2 made it a consolidation with a deletion ledger but kept two flaws: the gates ran
as ordered `it()`s over shared `beforeAll` state — an implicit state machine whose
ordering lives in runner semantics — and the fixture re-implemented the scaffold
sequence, which is what the existing nine files already do wrong. v3's premise:

1. **Drive the real flow.** `InitFlowService.run` already accepts hermetic inputs
   (`source` for offline scaffolding, `noInstall`, `level`, `overrides`) and exports
   its phases (`runPnpmInstall`, `runPnpmApproveAll`, `runTypesGen`,
   `generateDatabaseMigrations`). The fixture calls the production service; today's
   tests call a private re-implementation that silently drifts every time
   `init-flow.ts` gains a phase.
2. **No implicit state machine.** A scaffolded child moves
   `Scaffolded → Installed → Typed → Checked/Built → Booted`. That progression is
   *types* (state tokens minted by the step that produces them), the gates are
   `Effect` functions between tokens, and the report is *data* (`GateReport[]`)
   that vitest asserts — never runner ordering over mutated state.
3. **Minimal Effect.** `acquireRelease` for the two real resources (temp dir,
   booted dev server), a single tagged error for all gates, `Effect.retry`/`Effect.timeout`
   for the polling loops. No `Layer` stacks, no `Context.Service` tags, no service
   graph — nothing needs memoization or injection, so ceremony would be more code,
   not less. House conventions apply where they apply (`yield* new GateError({...})`,
   per AGENTS.md).

Scope: `packages/everything-dev/src/services/scaffold/`, the init test tiers, the
regression matrix. Companions: 003 (starter levels), 004 (slim API shell), 006
(init test-baseline hardening), 016 (shared Effect test helpers — this plan's
fixture is a consumer of its convention when it lands, never a parallel one), 056
(regression tiering doctrine).

## The two real defects (unchanged since v1)

1. **The consumer gate is dark.** `fresh-init-dev.test.ts` is
   `describe.skipIf(process.env.CI === "true")` (rc.30-era deliberate), but the
   `fresh-init-dev` CI job still runs it — GitHub always sets `CI=true`, the suite
   skips, the job burns ~10 min per PR proving nothing.
2. **The levels are only structure-tested**, by tests that re-implement the flow.
   Nothing builds a child, nothing boots one outside that dark gate, no test has
   rendered either starter level.

## The design

### State tokens, not a mutating dir

```ts
type Scaffolded = { readonly dir: string; readonly level: StarterLevel; readonly result: InitResult };
type Installed = Scaffolded & { readonly kind: "installed" };   // one-line brands suffice
type Typed = Installed & { readonly kind: "typed" };
type Booted = { readonly dir: string; readonly port: number; /* probe handles */ };
```

Steps (all in `tests/helpers/child-fixture.ts`, the only new module):

```ts
const scaffold = (o: ScaffoldOptions): Effect<Scaffolded, GateError>   // InitFlowService.run({ source: REPO_ROOT, noInstall: !o.install, ... })
const install  = (c: Scaffolded): Effect<Installed, GateError>          // runPnpmInstall + runPnpmApproveAll
const types    = (c: Installed): Effect<Typed, GateError>              // runTypesGen
const check    = (c: Typed): Effect<GateReport, GateError>             // runTypecheck
const build    = (c: Installed): Effect<GateReport, GateError>         // bos build
const boot     = (c: Scaffolded): Effect<Booted, GateError, Scope>     // acquireRelease: spawn bos dev → waitForHttp → SIGTERM/SIGKILL finalizer
```

The type graph *is* the state machine: `check` cannot be expressed without the
`Typed` token only `types` mints. Ordering is enforced by `yield*` in one
`Effect.gen` per lane — syntactically explicit, shard-proof, `--invert`-proof.

### One error, gates as data

```ts
class GateError extends Data.TaggedError("GateError")<{ gate: string; command: string; code: number; output: string }> {}
```

Every step exits via `yield* new GateError({...})` — one formatting site for
"gate X exited N" with full captured stdout/stderr, replacing the per-test
`expect(msg, custom).toBe(0)` plumbing. A lane returns `GateReport[]` (name,
status, duration). The vitest side is a pure fold: `beforeAll` runs the lane once
into `Exit<GateReport[], GateError>`; one `it` per known gate asserts its row, and
gates after a failure report *blocked* pointing at the failed gate's output —
granularity without runner-owned lifecycle. `fresh-init-dev`'s hand-rolled
polling/kill code (~80 lines: pipe accumulation, `waitForHttp` loop, SIGTERM→30s
timer→SIGKILL, close-handler races) collapses into `boot`'s acquireRelease plus
`Effect.retry`/`Effect.timeout` (~25 lines).

### The born-healthy contract — documentation, not code

One page in `docs/agents/testing.md` names the gates in order (the list below);
the lanes are `Effect.gen` compositions of the step functions. A tier is which
lane CI calls — no budget enum (v1, rejected), no configuration.

1. `bos init` exits 0 — snapshot, `bos.app.ts`, `bos.dev.ts`, `.env` exist; no stray lockfiles
2. `pnpm install` exit 0; nothing awaiting pnpm approval
3. `bos types gen` exit 0; generated types non-stub
4. `pnpm run typecheck` exit 0 per workspace
5. `bos build` exit 0, zero warnings (allowlist empty day one; entries need owner + issue)
6. `bos dev` boots: ui + api answer 200; boot log free of `ERROR` / `release-composition divergence` / `pool.end() called from`
7. Browser: scaffolded routes render + hydrate, zero console errors, zero failed requests, rendered anchors resolve
8. `bos upgrade --check` well-formed (exit 0/1, resolved semver, no `error`)

### The minimal-code boundary (v2 everything-dev ships ~zero new runtime code)

- **Nothing lands in `packages/*/src`** except fixes the red gates force. The
  fixture, matrix, and boot spec are test files.
- **Reuse inventory** — write none of this: `runCommand`/`runTypecheck`/stub
  writers (`tests/integration/typecheck-utils.ts`), framework tarball resolution
  (`framework-packages.ts`), child config fixtures (`tests/helpers/parent-config.ts`),
  the production scaffold phases (`src/services/scaffold/init.ts` exports). The
  fixture lives beside `parent-config.ts` in `tests/helpers/` — no export surface,
  no changeset, no dist concerns; `every-plugin/testing` (plan 016) is the future
  home for *shared* Effect primitives like `expectEffectFailure`, which this
  fixture consumes rather than redefines.
- The known deliberate exception: `waitForHttp` gets its single home inside the
  fixture (Effect retry/timeout) — today it exists only inline in `fresh-init-dev`.

## Phase 1 — The matrix (P0, M)

**`init.matrix.test.ts`** — `describe.each(["simple", "advanced"])` ×
`describe.each(["ui", "ui+api", "ui+api+host+plugin"])`, six structure cells
(`scaffold` with `install: false`) asserting today's `init.levels` / `init.structure`
/ `init.compose` / `init.api-shell` / `init-config-form` expectations (folded,
deduplicated), plus four install cells — `simple@ui`, `simple@ui+api`,
`advanced@ui+api`, `advanced@full` — running gates 2–4 + 8 via
`framework-packages.ts` tarball rewriting between scaffold and install.

**`init.boot.test.ts`** — one cell per level at `ui+api`: gates 5–6 (first child
`bos build` anywhere; dev boot with clean-log assertions lifted from
`fresh-init-dev`). The published-release variant (`source: "published"`, FastKV
passthrough) sits behind `BOS_INIT_SOURCE=published`, nightly only. The
published lane's framework-link rewrite (workspace `overrides:` block) stays a
gate-level interposition between scaffold and install — the fixture's step shape
allows it without special cases.

**Deletion ledger (execute literally; assertions that don't map 1:1 get listed in
the PR body with a reason, not silently dropped):**

| Delete | Lines | Absorbed by |
|--------|-------|-------------|
| `init.structure.test.ts` | 380 | matrix structure cells |
| `init.levels.test.ts` | 158 | matrix structure cells |
| `init.api-shell.test.ts` | 120 | matrix structure cells |
| `init-config-form.test.ts` | 129 | matrix cells |
| `init.full.test.ts` | 98 | matrix install cells |
| `fresh-init-dev.test.ts` | 320 | `init.boot.test.ts` + fixture |
| `init-prune-real-tree.test.ts` | 65 | matrix cells assert pruned-tree shape via the real flow |
| `init.compose.test.ts` | 63 | matrix structure cells |

Kept: `init.install-progress.test.ts` (spinner seam), `init.relative-directory.test.ts`
(CLI cwd seam), all unit tests (`init-route-exclusions`, `init-install`,
`init-child-deps`, `scaffold-root`). Net: ~1,590 → ~700 lines across 9→3 files,
gaining level × composition coverage, the real-flow property, first child build,
and the un-darkened boot gate.

## Phase 2 — CI wiring (P0, S): edit two files, add zero

Replace the vacuous `fresh-init-dev` job with `init-matrix` (same path gating,
25-min class): repo-source matrix + boot suites. Nightly adds
`BOS_INIT_SOURCE=published` per tiering doctrine. testing.md gets the
born-healthy page + tier-table row.

## Phase 3 — Browser smoke (P1, S): one spec

`tests/regression/browser/specs/scaffold-child.spec.ts`, one `scaffold` Playwright
project whose `webServer` boots `bos dev` in a CI-step-scaffolded dir (scaffold +
install too slow for webServer's budget). Per level: landing renders
(`data-testid` per convention; `waitUntil: "commit"` per the TanStack Router
rule), console-error and failed-request collectors assert empty, anchor sweep (a
`for` loop over rendered `a[href]`, not a crawler), advanced-only: `/login`
renders, unauthenticated `/dashboard` redirects.

## Phase 4 — Fix what's red (P1, sized by findings)

No speculative work; pre-registered classes: product-route leakage (anchor
sweep/structure cells), sidebar referencing pruned routes, gate-5 warnings
(allowlist with owner + issue, or one-line fix), README divergence (the smoke
*is* the README claim; fix the README). Demoted to conditional: orphaned-dep
pruning, OG/meta polish.

**Genericity rule:** the portfolio is a consumer of `simple`; its friction becomes
issues, never template special-cases.

## Phase 5 — The portfolio (P2, S — after Phase 3 is green)

`bos init --level simple` into a separate child repo (this repo is the framework
home), customize the authored surface (landing copy, about, child-owned
`projects` route, `bos.app.ts` identity fields), deploy per `docs/self-deploy.md`.

## Execution order + STOP conditions

Order: **1 → 2 → 3 → 4 → 5**. STOP and reassess if: gate 5 is unreachable day one
(inventory warnings, allowlist each with owner — never lower the bar silently);
install cells exceed the job budget (drop to two, push rest nightly); the
consolidation churns beyond the ledger; `InitFlowService.run` proves uncallable in
the hermetic shape (missing seam for `source`-only runs — then add the *smallest*
seam to the service rather than reverting to piecewise re-implementation, and file
the issue per the framework-owned protocol).

## Rejected designs (cumulative — recorded so they stay rejected)

- **`assertBornHealthy(dir, { budget })`** — tiers no lane exercises are dead
  config; lanes are compositions.
- **Ordered `it()`s over `beforeAll` state (v2)** — implicit state machine in
  runner semantics; replaced by state tokens + `GateReport[]` data.
- **Layer/context ceremony for the gates** — nothing here needs memoization or
  injection; `Layer` stacks and service tags would be more code and indirection.
  `acquireRelease` inside `Effect.scoped` is the whole need. (The production
  `InitFlowService` keeps its Layer — the fixture *calls* it via
  `materializeViaLayer`, doesn't reimplement it.)
- **`start-stack.mjs --dir`** — parent-shaped machinery for a 25-line child boot.
- **Per-route starter markers** — line-count wash churning live product code,
  re-opens plan 003's settled decision; leak class caught by the anchor sweep.
  One coherence assertion on the existing lists (every glob matches ≥1 file) covers
  staleness; freshness is review policy documented beside the lists.
- **Golden-file tree snapshots** — assert shape, not health; rot instantly.
- **Child `bos start` as a committed gate** — unverified for host-less children;
  `bos build` + `bos dev` carry the signal until a manual spike proves the path.
- **Rewriting `init-flow.ts`'s internal state machine** — its ~400-line
  `Effect.tryPromise` wrapping an imperative async body with phase mutations is a
  real implicit state machine, but rewriting it is runtime churn this plan forbids
  itself. The matrix pins its behavior from outside; that pin is precisely what
  makes a future in-house refactor safe. Recorded for that session, not this one.
- **create-next-app-scale flag permutations** — two levels × three compositions;
  new flags join only when they change what gets scaffolded.
