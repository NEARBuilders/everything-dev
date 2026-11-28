# Effect Schema contracts (oRPC + Standard Schema)

How to migrate a plugin's `src/contract.ts` from Zod to Effect Schema — piloted by
`plugins/registry` (ADR 0048 §2). The oRPC machinery is unchanged; only the schema library
moves.

## The one pattern to know

oRPC's contract layer is Standard Schema native: `@orpc/contract`'s `Schema<TInput, TOutput>`
is literally `StandardSchemaV1<TInput, TOutput>` (from `@standard-schema/spec`), the server
validates via `~standard.validate`, and `@orpc/openapi`'s default converter chain ends in a
`StandardJsonSchemaConverter` that emits JSON Schema from `~standard.jsonSchema` (requested
target: `draft-2020-12` — one of the two targets Effect supports). Effect 4 ships both
bridges, and chaining them produces one value that carries **validate + jsonSchema**:

```ts
import { Schema } from "effect";

const orpcSchema = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
) => Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));
```

Apply `orpcSchema(...)` at every `.input(...)` / `.output(...)` call (or to the named consts
passed there). The OpenAPI/MCP call sites (`host/src/routes/api.ts`,
`host/src/services/mcp.ts`, `packages/every-plugin/src/dev/serve.ts`, `apps/upload`) need **no
changes** — the `ZodToJsonSchemaConverter` entries stay for Zod-typed error maps
(`every-plugin/errors`), and the default chain handles the Effect schemas.

Type inference flows through `StandardSchemaV1<TInput, TOutput>` generics: `bos types gen`
/ `EmitPluginManifest` are TS-based and schema-agnostic; `ui`/`api` typecheck against the
generated client types unchanged.

## Zod → Effect translation table (as used in the pilot)

| Zod | Effect 4 |
| --- | --- |
| `z.object({...})` | `Schema.Struct({...})` (`.extend` → spread a fields object into two Structs) |
| `x.optional()` (missing-or-undefined) | `Schema.optional(x)` |
| `x.nullable()` | `Schema.NullOr(x)` |
| `z.string().url()` | custom filter: `Schema.String.check(Schema.makeFilter((s) => URL.canParse(s.trim()), { toJsonSchema: () => ({ format: "uri" }) }))` (zod trims then `new URL`) |
| `z.iso.datetime()` | custom filter with zod's regex ported verbatim (leap-year-aware, Z-suffixed, seconds required); `toJsonSchema: () => ({ format: "date-time", pattern })` |
| `z.string().startsWith("bos://")` | `Schema.String.check(Schema.isStartingWith("bos://"))` |
| `z.number().int().min(1).max(100)` | `Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))` |
| `z.number().int().nonnegative()` | `Schema.Natural` |
| `z.record(z.string(), z.unknown())` | `Schema.Record(Schema.String, Schema.Unknown)` |
| `z.union([...])` / `z.enum([...])` | `Schema.Union([...])` / `Schema.Literals([...])` |

## Gotchas found in the pilot

- **Arrays decode readonly.** Effect's `Schema.Array` yields `ReadonlyArray<T>` where zod
  yields mutable arrays. Where a decoded array is passed to a service expecting a mutable
  array, wrap: `Schema.mutable(Schema.Array(...))`.
- **Export wrapped schemas for tests.** A raw `Schema.String.check(...)` has no `~standard`;
  only `orpcSchema(...)`-wrapped schemas are Standard Schema values. The parity test imports
  the exported wrapped consts.
- **Silent `{}` degradation.** If JSON Schema conversion throws, oRPC's
  `StandardJsonSchemaConverter` emits an empty schema (`{}` = anything) instead of failing.
  The parity test asserts real shapes (`format`, `minimum`, `required`) so a conversion
  failure cannot hide.
- **Cosmetic spec drift.** `Schema.Natural` emits `maximum: 9007199254740991` (zod's
  `.nonnegative()` omits it) and nullability renders as `anyOf` rather than a type array —
  same acceptance, different document. Excess properties are stripped by both libraries.
- **Error maps stay Zod.** `.errors({ BAD_REQUEST })` uses the shared `every-plugin/errors`
  Zod shapes; do not touch them in a plugin migration.

## Parity test pattern

`plugins/registry/src/__tests__/contract-parity.test.ts` — two layers:

1. **Behavior parity:** zod mirrors of the legacy schemas (transcribed, documented as
   legacy) vs the exported Effect schemas, driven through `~standard.validate` on a battery
   of accept/reject values per route — including boundaries (`limit: 0/101/2.5/"50"`),
   trimmed URLs, impossible calendar dates, `+01:00` offset rejection, null-vs-optional.
2. **Spec parity:** `new OpenAPIGenerator().generate(contract, ...)` with the default
   converter chain, asserting real `format` / `minimum` / `required` shapes on the registry
   paths (guards the silent `{}` case above).

## Next plugin

`plugins/proposals` (next-smallest contract), then `plugins/votes`, `plugins/ai`, and the
`api` shell. `better-near-auth` / `every-plugin` Zod surfaces stay until upstream moves.
