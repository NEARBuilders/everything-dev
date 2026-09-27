---
"everything-dev": patch
---

Dev bootstrap rewritten as one Effect program (`ShellEnv`/`ProjectEnv` as services).

- `bos dev` and `bos start` run `planInfra → loadProjectEnv → syncEnvFile → mergeEnvTiers → preflight` inside a single Effect program with tagged error channels (`DevStepError`, `DevConfigMissing`, `DevPreflightFailed`, `StartFetchFailed`, …); the oRPC handlers are now thin `Effect.runPromise` seams. Progress events and phase timings are unchanged.
- `ShellEnv` is a `Context.Service` captured as the program's first step — before any `.env` loading — and handed to the spawn side through the parked dev session; the module-scope `shell-env.ts` snapshot and `cli/infra.ts`'s `loadProjectEnv`/`ensureEnvFile`/`syncEnvFile` loose helpers are gone (unified behind `ProjectEnv`, which also serves the database-bindings `loadEnv` delegate).
- Pure merge helpers (`composeSpawnEnv`, `mergeGeneratedOverFileEnv`) stay pure functions; three-tier precedence (shell > generated > `.env`) is unit-tested at the single merge point. No behavior change to the spawn env the regression harness injects.
