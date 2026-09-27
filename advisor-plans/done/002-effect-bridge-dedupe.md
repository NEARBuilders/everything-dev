# Plan 002: Deduplicate `runEffect`/`flattenError` onto the every-plugin bridge

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- plugins/_template/src/lib/context.ts plugins/apps/src/lib/context.ts plugins/votes/src/lib/context.ts plugins/proposals/src/lib/context.ts plugins/proposals/src/index.ts packages/every-plugin/src/effect-bridge.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

`runEffect`/`flattenError` are implemented once in the framework (`packages/every-plugin/src/effect-bridge.ts`, publicly exported) and then copy-pasted byte-identically into four plugin `lib/context.ts` files. `api/src/lib/context.ts` already proves the import-from-framework path works in production. Worse, `plugins/proposals/src/index.ts:23-33` carries a **sixth, diverged** copy whose error text differs from its own lib copy — the same failure produces different client-visible messages depending on which handler caught it. Any fix to error bridging must currently be applied in 6 places across 5 files.

## Current state

- `packages/every-plugin/src/effect-bridge.ts:4-36` — the canonical implementation (excerpt):

```ts
export function flattenError(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message];
    let cause: unknown = error.cause;
    while (cause instanceof Error) { parts.push(cause.message); cause = cause.cause; }
    return parts.join(": ");
  }
  return String(error);
}

export async function runEffect<A, E>(effect: Effect.Effect<A, E>) {
  const exit = await Effect.runPromiseExit(effect as Effect.Effect<A, unknown>);
  if (Exit.isFailure(exit)) {
    const squashed = Cause.squash(exit.cause);
    if (squashed instanceof ORPCError) { throw squashed; }
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: flattenError(squashed) });
  }
  return exit.value;
}
```

- `plugins/_template/src/lib/context.ts:17-44` — a private copy of both functions (identical logic, typed `runEffect<A>(effect: Effect.Effect<A, unknown>)`). The file header says: "BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`. Prefer upstream changes at https://github.com/nearbuilders/everything-dev" — **this repo is the upstream**, so the fix belongs here and syncs outward.
- Same copies: `plugins/apps/src/lib/context.ts:17-44`, `plugins/votes/src/lib/context.ts:17-44`, `plugins/proposals/src/lib/context.ts:17-44`.
- `plugins/proposals/src/index.ts:23-33` — a sixth, diverged local `runEffect` (keeps the typed error channel, throws the raw `squashed.message` instead of the flattened chain).
- Counterexample that proves the import works: `api/src/lib/context.ts` re-exports from `"every-plugin"`.
- Conventions: plugin files import framework symbols from the `"every-plugin"` root or its facades (`"every-plugin/effect"`, `"every-plugin/orpc"`, `"every-plugin/zod"`) — see `plugins/_template/src/lib/context.ts:8-10` imports.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all workspaces) | `bun typecheck` | exit 0, all ✓ |
| Lint | `bun lint` | exit 0 |
| _template tests | `cd plugins/_template && bun run test` | 22 pass |
| apps tests | `cd plugins/apps && bun run test` | 6 pass |
| votes tests | `cd plugins/votes && bun run test` | 1 pass |
| proposals tests | `cd plugins/proposals && bun run test` | 10 pass |
| every-plugin build (dist) | `cd packages/every-plugin && bun run build` | "Build complete" |

## Scope

**In scope**:
- `plugins/{_template,apps,votes,proposals}/src/lib/context.ts`
- `plugins/proposals/src/index.ts` (delete the local `runEffect` at lines ~23-33)
- `plugins/_template/tests/**` only if imports break

**Out of scope**:
- `packages/every-plugin/src/effect-bridge.ts` — do not change the canonical implementation in this plan.
- `api/src/lib/context.ts` — already correct.
- `plugins/auth` — it does not carry the copy.

## Git workflow

- Branch: `improve/002-effect-bridge-dedupe`.
- Commit style: `refactor(plugins): re-export runEffect/flattenError from every-plugin`.
- Do NOT push unless instructed.

## Steps

### Step 1: Replace the template copy (the sync source)

In `plugins/_template/src/lib/context.ts`, delete the local `flattenError` (lines 17-28) and `runEffect` (lines 30-44) and replace with a re-export, keeping the `ContextSchema`/`Context` definitions:

```ts
import { z } from "every-plugin/zod";
import type { AuthContext } from "./auth";

export { flattenError, runEffect } from "every-plugin";

export const ContextSchema = z.custom<AuthContext>();
export type Context = AuthContext;
```

(If `plugins/_template/src` elsewhere imports these from `./lib/context`, the re-export keeps those imports working.)

**Verify**: `cd plugins/_template && bun run typecheck 2>/dev/null || bunx tsc --noEmit` → exit 0; then `bun run test` → 22 pass.

### Step 2: Apply the same replacement to apps, votes, proposals lib copies

Identical edit in `plugins/{apps,votes,proposals}/src/lib/context.ts`.

**Verify**: `cd plugins/apps && bun run test` → 6 pass; `cd plugins/votes && bun run test` → 1 pass; `cd plugins/proposals && bun run test` → 10 pass.

### Step 3: Delete proposals' diverged sixth copy

In `plugins/proposals/src/index.ts:23-33`, delete the local `runEffect` and import from `./lib/context` (or directly from `"every-plugin"`). This changes proposals' handler error text from the raw squashed message to the flattened cause chain — that is the intended convergence (the lib copy and every other plugin already produce the flattened form). Check the proposals tests for assertions on exact error message strings; update them to the flattened form if any assert on the old raw message.

**Verify**: `cd plugins/proposals && bun run test` → 10 pass; `grep -n "INTERNAL_SERVER_ERROR" plugins/proposals/src/index.ts` → no local implementation remains.

### Step 4: Full gates

**Verify**: `bun typecheck && bun lint` → exit 0. Then `cd packages/every-plugin && bun run build` (dist refresh; consumers read dist in MF contexts).

## Test plan

- No new tests required — the four plugin suites exercise `runEffect` on their real handlers.
- If proposals tests asserted exact raw-message error text, update those assertions to the flattened chain (this is the drift being fixed, not a regression to hide).

## Done criteria

- [ ] `bun typecheck` and `bun lint` exit 0
- [ ] `grep -rn "export async function runEffect" plugins/` returns no matches
- [ ] `grep -rn "export function flattenError" plugins/` returns no matches
- [ ] All four plugin suites pass (22 / 6 / 1 / 10)
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The excerpts don't match the live files (drift).
- A plugin's handlers depend on the diverged proposals behavior in a way tests can't express (e.g. a client contract pins the raw message shape) — stop and report.
- `_template` tests import something else from `lib/context` that breaks in a way the re-export can't satisfy.

## Maintenance notes

- Child projects sync `lib/context.ts` from this repo via `bos sync`; after this lands, their next sync deletes their local copies. The header warning stays accurate.
- If `runEffect` semantics ever change (e.g. richer error mapping), it now changes in exactly one place.
