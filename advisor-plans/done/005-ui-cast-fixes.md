# Plan 005: Remove the unchecked UI casts at the RPC/config and DAO-signing boundaries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- ui/src/lib/api.ts ui/src/lib/dao-connect.ts ui/src/components/ui/markdown.tsx packages/everything-dev/src/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: type-safety
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

Two unchecked casts sit on load-bearing UI paths. `ui/src/lib/api.ts:23` casts `runtimeConfig.rpcBase` to `` `/${string}` `` — a claim the type system can't verify; if a runtime-config producer ever emits a non-`/`-prefixed value, every API call in the app fails at runtime instead of failing to compile. The honest fix is at the schema source: `rpcBase` is declared plain `z.string()` in `everything-dev/src/types.ts:340` while its only producer hardcodes `"/api/rpc"`. And `ui/src/lib/dao-connect.ts:312` casts DAO transaction args to `Record<string, never>` — a false type that disables all argument-shape checking on a money-path action (signing and sending NEAR transactions as a DAO).

## Current state

- `ui/src/lib/api.ts:20-26`:

```ts
function createRpcLink(runtimeConfig: { hostUrl: string; rpcBase: string }, headers?: Headers) {
  return new RPCLink({
    origin: runtimeConfig.hostUrl,
    url: runtimeConfig.rpcBase as `/${string}`,
```

- `packages/everything-dev/src/types.ts:340` — `rpcBase: z.string(),` inside the runtime-config zod schema (find the surrounding schema with `grep -n "rpcBase" packages/everything-dev/src/types.ts`).
- `host/src/services/config.ts:70` — the only producer: `rpcBase: "/api/rpc"`.
- oRPC v2's `RPCLink.url` option type is `` Value<Promisable<StandardUrl>, ...> `` where `StandardUrl = \`/${string}\` | \`/${string}?${string}\` | ...` (from `@standard-server/core`).
- `ui/src/lib/dao-connect.ts:288-294` — the spec is already honestly typed:

```ts
export interface SignAsDaoSpec {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  attachedDeposit?: string;
}
```

- `ui/src/lib/dao-connect.ts:310-313` — the false cast at the call into the NEAR SDK:

```ts
const builder = near
  .transaction(daoAccountId)
  .functionCall(spec.receiverId, spec.methodName, spec.args as unknown as Record<string, never>, {
```

- `ui/src/components/ui/markdown.tsx:101` — `rehypeSanitize(sanitizeSchema) as any` (minor, same cluster).
- Conventions: kebab-case files, semantic Tailwind, no comments in implementation; zod is imported from `"zod"` in everything-dev src (check neighboring lines of types.ts for the import style — this repo also uses an `every-plugin/zod` facade in plugins, but everything-dev src uses plain `"zod"`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| UI tests | `cd ui && bun run test` | 304 pass |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420 pass (2 skipped) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success (types.ts is consumed via dist by the host) |

## Scope

**In scope**:
- `packages/everything-dev/src/types.ts` (the `rpcBase` field)
- `ui/src/lib/api.ts` (drop the cast)
- `ui/src/lib/dao-connect.ts` (drop/replace the `Record<string, never>` cast)
- `ui/src/components/ui/markdown.tsx` (the rehypeSanitize cast, if cheaply fixable)
- `ui/src/lib/dao-connect.test.tsx` / related tests if assertions change

**Out of scope**:
- `host/src/services/config.ts` — already produces `"/api/rpc"`; do not touch.
- Any other `as` in `ui/src` (routeTree.gen.ts is generated; the rest is separate work).
- Runtime behavior changes — this plan is type-level only.

## Git workflow

- Branch: `improve/005-ui-cast-fixes`.
- Commit style: `refactor(ui,types)!: typed rpcBase + honest dao args`.
- Do NOT push unless instructed.

## Steps

### Step 1: Type `rpcBase` at the schema source

In `packages/everything-dev/src/types.ts:340`, replace `rpcBase: z.string(),` with a template-literal schema that produces `` `/${string}` ``:

```ts
rpcBase: z.templateLiteral([z.literal("/"), z.string()]),
```

(Verify against the installed zod 4: `grep -rn "templateLiteral" node_modules/zod/dist/types/v4/classic/schemas.d.ts | head -3` or check how other template-literal schemas appear in the repo. If `z.templateLiteral` is unavailable in this zod version, the accepted alternative is `z.string().startsWith("/")` + a branded/refine type that infers as `` `/${string}` `` — if neither yields the narrow inferred type, STOP and report.)

**Verify**: `cd packages/everything-dev && bunx tsc --noEmit` (or the package's typecheck script) → exit 0.

### Step 2: Drop the UI cast

In `ui/src/lib/api.ts:23`, change `url: runtimeConfig.rpcBase as \`/${string}\`,` to `url: runtimeConfig.rpcBase,` and narrow the local `createRpcLink` parameter type from `rpcBase: string` to `` rpcBase: `/${string}` `` (the parameter flows from `RuntimeConfig["rpcBase"]` — check `hydrate.tsx:66` and `router.server.tsx:114` pass `runtimeConfig.rpcBase` through; the narrow type must propagate).

**Verify**: `cd ui && bun run typecheck` → exit 0 (the whole-repo `bun typecheck` regenerates `.gen.ts` files and checks every consumer of the schema — run it too).

### Step 3: Fix the DAO args cast

In `ui/src/lib/dao-connect.ts:312`, pass `spec.args` without the cast. Check what the NEAR SDK's `functionCall` actually accepts (`grep -rn "functionCall" node_modules/near-connect/dist/*.d.ts | head` or the `Near` builder types) — if it demands a narrower JSON type, cast to the SDK's own parameter type (e.g. `Record<string, JSONValue>` if exported), never to `Record<string, never>`. If the SDK genuinely types it as `Record<string, never>` upstream, keep a single documented cast with a comment-free workaround note in the plan report (comments are not allowed in implementation) — report which case held.

**Verify**: `cd ui && bun run typecheck && bun run test` → exit 0, 304 pass.

### Step 4: markdown.tsx cast (optional, only if cheap)

Check `ui/src/components/ui/markdown.tsx:101`: if `rehype-sanitize`'s published types accept the local `sanitizeSchema` shape on this version, drop the `as any`. If it's a known upstream typing gap, leave it and note it in your report.

**Verify**: `cd ui && bun run typecheck` → exit 0.

### Step 5: Full gates + dist

`cd packages/everything-dev && bun run build` (the host reads runtime-config types through dist), then `bun typecheck && bun lint` and the UI + everything-dev suites.

**Verify**: all green per the commands table.

## Test plan

- No new tests strictly required (type-level change), but add one cheap assertion to `ui/src/lib/dao-connect.test.tsx` if a test file exists for the module: a spec with non-empty `args` flows through unchanged (guards against someone re-tightening the cast to `never`).
- `ui/src/hydrate.test.tsx:6` already passes `rpcBase: "/api"` — it must keep compiling; if its fixture type now requires the narrow literal, update the fixture to `rpcBase: "/api"` (already `/`-prefixed, so no change expected).

## Done criteria

- [ ] `grep -n 'as `/${string}`' ui/src/lib/api.ts` → no matches
- [ ] `grep -n "Record<string, never>" ui/src/lib/dao-connect.ts` → no matches
- [ ] `bun typecheck`, `bun lint`, ui (304) and everything-dev (420) suites all pass
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- zod 4 as installed offers no template-literal (or equivalent) schema producing the narrow type — report the available options rather than hand-rolling a cast-preserving workaround.
- Narrowing `rpcBase` breaks a consumer you can't fix inside the in-scope files (e.g. a host file constructs RuntimeConfig with a computed string).
- The NEAR SDK's `functionCall` typing rejects `Record<string, unknown>` in a way no honest local type satisfies.

## Maintenance notes

- If the runtime-config schema ever gains more path-typed fields (asset prefixes etc.), follow the same template-literal pattern at the schema source.
- Watch zod 4 minor releases — `z.templateLiteral` typing quality may improve; revisit the alternative forms then.
