# ADR 0004: Dev-serve entry resolution — source is always shipped, the bin is one line

Date: 2026-09-18
Status: Accepted

## Context

`Plugin review comment (PR #109, packages/every-plugin/bin/every-plugin-serve.mjs: "Why did we need this?")`

The bin dispatched between source and publish artifacts:

```js
if (existsSync(new URL("../src/dev/serve.ts", import.meta.url))) {
  await import("../src/dev/serve.ts");
} else {
  await import("../dist/serve.mjs");
}
```

The dispatch existed to cover two integration surfaces: in-repo (workspace + rspack resolve TS source via the `development` export condition) and installed npm consumers (where tsdown had to have been run). But `files` in `packages/every-plugin/package.json` already ships `src` in published tarballs, so `../src/dev/serve.ts` exists in *both* cases — the `dist/serve.mjs` fallback was effectively dead code, kept only as belt-and-braces.

## Decision

- **Serve bin is one line**: `await import("../src/dev/serve.ts")`. The existsSync/dist fallback is deleted.
- **`dist/serve.mjs` remains a publish artifact** (tsdown entry with bun shebang banner) for non-bun tooling that consumes the `./dev-serve` export directly, but no runtime dispatch depends on it being built.
- **The `every-plugin` CLI bin follows the same rule** (ADR 0003): bins are two/three-line dispatchers into `src/*.ts`; bun executes TS natively, which is a toolchain invariant, not an acceptance test.

## Consequences

- "Why did we need this?" has a one-sentence answer: we always ship `src`, so source import is the single resolution path and no fallback exists.
- Deleting the fallback removes a maintenance trap (the dist path silently drifting from source during dev).
- Integer risk: if someone publishes a tarball with `src` stripped, `every-plugin-serve` breaks — the guard is the `files` entry in package.json, plus CI publishing always builds first (dist also exists in the tarball as an additional artifact).
