---
"everything-dev": patch
"every-plugin": patch
---

Framework-package self-typecheck lands in CI (`typecheck:packages`) — the app-unit typecheck (`bos typecheck`) never covered `packages/*`, and the unguarded drift had gone red: real src errors fixed in everything-dev (Effect error-channel widens in db ops/dev flow/ops/init flow, the missing `formatUnknownError` import, `runtimeMapStrict` typed on the plain codegen wrapper, `BosConfigInput` accepted by `stripLocalDevelopmentTargets`), and service-layer test-hook files in every-plugin (missing vitest imports, `constructTree` resolver signatures, `.ts`-extension script imports now covered by the self-typecheck tsconfig).
