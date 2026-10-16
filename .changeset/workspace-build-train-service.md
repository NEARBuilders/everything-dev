---
"everything-dev": minor
---

Workspace build train extracted to `services/workspace/build-train.ts` behind a `BuildTrainService` tag (ADR 0031 shape): the parallel/sequential deploy group logic and the prerequisite train are unchanged, `src/build.ts` is gone, and the per-workspace ✓/✗ table, deploy banner, and prerequisite line render through `cli/render/workspace-build.ts` via a `WorkspaceBuildRenderService` the composition root wires — the service only decides when to emit, never how to format. Captured child-process stderr is now attributed per workspace on the build outcome (the basis for later attributed warnings). The staleness oracle is an explicit seam: `ensureFreshDeps` accepts an injected `oracle` (default `mtimeStalenessOracle`), so a content-hash oracle can land without touching callers; deploy force-rebuild behavior is unchanged.
