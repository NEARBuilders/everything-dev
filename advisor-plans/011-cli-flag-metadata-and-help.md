# Plan 011: De-private the CLI flag pipeline — metadata as source of truth, real `--help`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/everything-dev/src/cli/parse.ts packages/everything-dev/src/cli/help.ts packages/everything-dev/src/cli/cli.ts packages/everything-dev/src/contract.meta.ts packages/everything-dev/src/contract.ts packages/everything-dev/tests`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

`parseCommandInput` is the single argv→input path for every `bos` command, and it currently reads **private internals** of two dependencies: zod 4's `.def` shape (`_def` was zod 3) and oRPC's `~orpc.inputSchemas` tilde-marked package-private property. Worse, if the property is absent it returns `{}` **without calling `schema.parse`** — one breaking change in either dependency silently neutralizes all CLI flags across all commands at once (defaults apply instead of user intent, no error anywhere). Meanwhile `bos --help` prints command names only — no flags, no per-command help — while well-written flag descriptions sit dead in `contract.meta.ts` (`DevOptionsSchema` has 13 flags; only `remotePlugins` is documented in metadata; nothing renders `description` fields).

## Current state

- `packages/everything-dev/src/cli/parse.ts:3-11` — the private-API reader:

```ts
type SchemaLike = {
  def?: { type?: string; innerType?: SchemaLike; shape?: Record<string, SchemaLike>; values?: Record<string, string> | string[]; };
  parse: (value: unknown) => unknown;
};
```

- `parse.ts:64-69` — the fragile entry:

```ts
export function parseCommandInput(descriptor: CommandDescriptor, argv: string[]): unknown {
  const inputSchemas = (descriptor.procedure as any)["~orpc"]?.inputSchemas as SchemaLike[] | undefined;
  const schema = Array.isArray(inputSchemas) ? inputSchemas[0] : undefined;
  if (!schema) return {};
```

- `parse.ts:151` — the only public-API use: `schema.parse(input)`.
- `packages/everything-dev/src/cli/contract.meta.ts:1-9` — the metadata type (at `src/contract.meta.ts`, NOT under cli/):

```ts
export type CliCommandMeta = {
  commandPath?: string[];
  summary: string;
  description?: string;
  examples?: string[];
  interactive?: boolean;
  longRunning?: boolean;
  fields?: Record<string, { positional?: boolean; description?: string }>;
};
```

- `packages/everything-dev/src/cli/help.ts:3-13` — `printHelp()` prints `commandPath` + summary only; `src/cli/cli.ts:160-163` makes ANY `--help` print the global list and exit (so `bos dev --help` cannot show dev flags).
- `parse.ts:78` — reads `descriptor.meta.fields?.[fieldName]?.positional` (the only metadata consumed today).
- Flag semantics that must be preserved (from `parse.ts` + its tests in `packages/everything-dev/tests/unit/parse.test.ts`, ~96 lines): `--kebab` names from camelCase fields, `--no-*` negation for booleans, `=`-attached values, space-separated values, positional collection, unknown-flag error (`parse.ts:102`), array accumulation for `string[]` fields, enum passthrough, number coercion.
- Unknown flags currently THROW (`parse.ts:102`) — keep that.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420+ pass (2 skipped) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success |
| CLI smoke | `node packages/everything-dev/dist/cli.mjs --help` and `... dev --help` | renders flags |

## Scope

**In scope**:
- `packages/everything-dev/src/contract.meta.ts` (extend `fields` with `type`)
- `packages/everything-dev/src/cli/parse.ts` (metadata-driven; private reads removed)
- `packages/everything-dev/src/cli/help.ts`, `src/cli/cli.ts` (per-command help)
- `packages/everything-dev/src/contract.ts` (only if a schema/type cross-reference helper is added there)
- `packages/everything-dev/tests/unit/parse.test.ts` + new help tests + every `fields` entry in `contract.meta.ts` (adding `type` to all documented fields)

**Out of scope**:
- The command catalog structure (`src/cli/catalog.ts`) — keep `CommandDescriptor` as is except what parse needs.
- Prompt-based interactive flows (`src/cli/prompts.ts`) — they don't go through argv parsing.
- Any change to what the commands DO with parsed input.

## Git workflow

- Branch: `improve/011-cli-flag-metadata`.
- Commit style: `feat(everything-dev)!: metadata-driven flag parsing + per-command help`.
- Do NOT push unless instructed.

## Steps

### Step 1: Characterize current parsing

Read `packages/everything-dev/tests/unit/parse.test.ts` and run it. If any behavior above (kebab, `--no-*`, `=`, positionals, unknown-flag throw, arrays) lacks a test, ADD it first, asserted against the CURRENT implementation. These tests are the contract the rewrite must keep.

**Verify**: `cd packages/everything-dev && bun run test` → characterization suite green against current code.

### Step 2: Extend the metadata type

In `src/contract.meta.ts`:

```ts
fields?: Record<string, {
  positional?: boolean;
  description?: string;
  type?: "boolean" | "string" | "number" | "enum" | "string[]" | "string[]+";
  values?: string[];
}>;
```

Then add `type` (+ `values` for enums) to every existing `fields` entry across the file (read each command's zod schema in `src/contract.ts` to get the true type — e.g. `DevOptionsSchema` at `contract.ts:10-24` has 13 flags to document). `string[]+` (or a `minValues` marker) is for positionals that collect one-or-more values — model on whatever `build.packages` needs.

**Verify**: `bunx tsc --noEmit` in the package → exit 0; every field in `contract.meta.ts` that appears in a command's input schema has a `type`.

### Step 3: Rewrite `parseCommandInput` on metadata

Rewrite `parse.ts` so:
- Flag name → field mapping, boolean/array/number/enum handling, and positionals all come from `descriptor.meta.fields` (falling back to treating unknown-to-metadata fields as plain strings).
- The **only** schema use is the final validation: obtain the input schema **without** `~orpc` — since the goal is no private reads, prefer keeping a single narrow introspection point ONLY if oRPC v2 publishes an accessor (`grep -n "inputSchemas" node_modules/@orpc/contract/dist/index.d.ts | head` — if a public `getRouterContract`/procedure meta path exposes it, use it; otherwise move the final `schema.parse` call to the caller where the schema is already in scope, or accept `descriptor.procedure` carrying a typed `inputSchema` reference established in `catalog.ts` at registration time — pick the cleanest public-API path and report the choice).
- If metadata is missing for a command, parse NOTHING and run `schema.parse({})` — never silently skip validation (the current `return {}` bug).

**Verify**: `cd packages/everything-dev && bun run test` → the characterization suite passes unchanged; `grep -n "~orpc\|\.def\b" src/cli/parse.ts` → no matches.

### Step 4: Per-command help

- `help.ts`: `printHelp(command?: CliCommandMeta & { commandPath })` renders, for a command: path, summary, each flag (`--kebab-name` from the field name, type, `description`, `--no-*` note for booleans, `[positional]` marker), and `examples` if present. Without an argument, keep the current global list but append `Run 'bos <command> --help' for command flags.`
- `cli.ts:160-163`: intercept `<command> --help` BEFORE the global branch and print the command's help, exit 0.

**Verify**: `node packages/everything-dev/dist/cli.mjs dev --help` (after Step 5's build) → renders all 13 dev flags with descriptions; `node ... --help` → global list unchanged.

### Step 5: Build + full gates

`cd packages/everything-dev && bun run build`, then `bun typecheck && bun lint`, plus a quick real-CLI smoke: `node packages/everything-dev/dist/cli.mjs config` still works (exercises the new parser end to end).

**Verify**: all green; smoke command prints the loaded config.

## Test plan

- Step 1 characterization tests (the non-negotiable contract).
- New: help-rendering test (call `printHelp` with the dev command meta, assert flag lines + `--no-interactive` style entries appear); missing-metadata parse test (command with no `fields` + schema requiring input → validation error surfaces, not silent `{}`).
- Existing 420 everything-dev tests (init/sync/upgrade integration suites exercise real argv paths).

## Done criteria

- [ ] `grep -n '"~orpc"\|~orpc\.' packages/everything-dev/src/cli/parse.ts` → no matches
- [ ] `grep -n "\.def\b" packages/everything-dev/src/cli/parse.ts` → no matches
- [ ] Characterization + new tests pass; `cd packages/everything-dev && bun run test` green (420+)
- [ ] `bos dev --help` renders flags (verified via dist CLI smoke)
- [ ] `bun typecheck`, `bun lint` exit 0
- [ ] Changeset added (everything-dev minor)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- oRPC v2 exposes NO public way to reach a command's input schema from the catalog's procedure reference AND the schema isn't reachable where `parse` is called — report the options (the plan's preferred fallback is passing the schema explicitly through `catalog.ts`).
- Some flag's runtime semantics can't be expressed by the metadata types (e.g. a field whose type depends on another field) — characterize it, keep a narrow special case, and report.
- The characterization tests reveal behaviors this plan's summary got wrong — the tests win; adjust the rewrite to them, not vice versa.

## Maintenance notes

- New commands now document themselves by adding `fields` entries with `type` — reviewers should reject new flags added to `contract.ts` without matching metadata.
- When oRPC v2 stabilizes, revisit whether a public schema accessor makes the catalog-passing unnecessary.
- `bos` help output becomes an agent-consumable surface (llms.txt/skill.md may want to reference it).
