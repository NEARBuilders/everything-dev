## Question

When and how is `app.ts` evaluated to produce the deployable config (TOML on FastKV)?

> **Re-annotation (2026-09-26):** the TOML premise below is dead — the
> published config format is JSON (`bos.config.json` on FastKV), per
> toml-infra-alchemy's own decision. Additionally `bos.app.ts` became
> operative (citynode.app#226, ADR 0005 phase 1): the loader + TS-form
> scaffold + canonicalization exist. The remaining question is narrower:
> how much of the descriptor stays evaluated-at-publish vs
> evaluated-at-boot.

`app.ts` is a TypeScript file that calls `App()`, `Plugin()`, `WebPlugin()`, etc. — constructors that produce a typed configuration object. But TOML is the serialization format on FastKV, and the host reads either TOML (today) or the evaluated result.

Options to evaluate:
1. **Build-time evaluation** — `bos build` (or equivalent) runs `app.ts` with Bun/Node, evaluates the `App(...)` call, serializes the result to TOML, publishes to FastKV. The host reads TOML from FastKV (same as today). Pro: host unchanged, TOML is human-readable on-chain. Con: `app.ts` runs arbitrary code at build time — security and determinism concerns.
2. **Static parsing** — a custom TypeScript AST walker extracts the `App(...)` call arguments without executing code. Only literal values and `Plugin("name").path("dir").extends("url")` chains are parsed. Pro: no arbitrary code execution, deterministic. Con: limited expressiveness, complex parser, can't resolve dynamic values.
3. **Effect.ts evaluation** — `App()` returns an `Effect` that resolves plugin paths, scans workspaces, detects URLs. `bos build` runs the Effect to produce the final config. Pro: Effect.ts idiomatic, composable, error handling built in. Con: Effect.ts runtime dependency at build time.
4. **Hybrid** — static parsing for the structure (keys, plugin names), build-time evaluation only for resolution (turning `path: "plugins/registry"` into actual URLs). Pro: balances safety and power. Con: two-phase complexity.

Key sub-questions:
- Does `app.ts` need to run at dev time (for hot reload) differently than at deploy time (for TOML generation)?
- If `app.ts` runs at build time, how do we handle secrets/environment variables that differ between dev and prod?
- Can `Plugin("registry").path("plugins/registry")` resolve to a URL at build time by scanning `plugins/registry/package.json` + `rsbuild.config.ts`?
- How does `extends: "bos://auth.near/auth.dev#app.auth"` resolve? Fetch from FastKV at build time? Or resolve at host runtime as today?

## Sharpened (platform-services pass)

The deploy service (map decision 11) changes this ticket's center of gravity:

- **URL write-back may dissolve entirely** — today `onDeployComplete` writes Zephyr URLs back into `bos.config.json` and `bos publish` re-reads it. With `app.ts`, authoring config is never mutated (already a resolved-config decision): the deploy service returns refs, `bos publish` resolves `path`/`local://` entries through the deploy map, and the published config carries refs — no config file round-trip at all. Evaluation question becomes "who calls the deploy service and when", not "how do URLs get written back".
- **`bos://` resolution timing interacts with eligibility** — publishing under another account (member/tenant preview) is now a deploy-service + publish-flag concern, not an authoring-format concern. Whichever evaluation option wins must keep the authoring file account-agnostic.
- Still open as originally framed: dev-time vs deploy-time evaluation, secrets, `extends` resolution timing.
