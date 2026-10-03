---
"everything-dev": patch
---

CI overhaul: workflow_run deploys, no commit-back, drop dead postinstall everywhere.

- Deploy/staging workflows (repo + child templates) trigger via `workflow_run` on CI success and check out the exact CI-validated SHA; the notify/`repository_dispatch` job is gone.
- The "Commit and push bos.config.json updates" step is removed from deploy/staging — the runtime fetches config from FastKV via `BOS_ACCOUNT`/`BOS_GATEWAY`, so deployment URLs never need committing (everything-dev#243).
- All `bun run postinstall` steps removed from every workflow; child scaffolding no longer writes a `postinstall` script (dead code under `ignore-scripts = true`; `bun typecheck`, `bos dev`, `bos build`, and `bos publish` regenerate types on demand).
- `release.yml` drops unused `packages: write`; `docker.yml` drops its never-called `workflow_call` trigger; `@railway/cli` is pinned; missing job timeouts added.
