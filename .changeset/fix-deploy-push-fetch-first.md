---
"everything-dev": patch
---

Fix `Deploy` and `Staging` workflows failing with `! [rejected] main -> main (fetch first)` when remote `main` (or `staging`) advances during the long deploy window. The final push step now `fetch` + `rebase` against the remote ref before pushing, retries up to 5 times with exponential backoff, and exits cleanly when there's nothing to push after rebase. This eliminates races with the `Release` workflow's auto-merged `chore: version packages` PR, manual `workflow_dispatch` triggers, Renovate, and human commits landing during deploy.
