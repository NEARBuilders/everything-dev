---
"everything-dev": patch
---

CLI hygiene batch (plan 041): removed two dead `@effect/platform` dependencies (zero imports, one peer-incompatible with the vendored effect pin); `zod` is now a real dependency of the published package (the CLI imports it at boot; it was peer-only, which crashes under strict-peer installers); `@types/node` and `vitest` now follow the root catalog; the CLI flag parser reads its input schemas from an exported, compile-checked `commandOptionSchemas` map instead of reaching into oRPC's private `~orpc` internals through an `any` cast; AGENTS.md no longer documents a nonexistent `bos info` command; and the snapshot-hash helper, duplicate-object SQLSTATE list, and NEAR CLI install check each exist in exactly one place.
