---
"everything-dev": minor
"every-plugin": minor
---

No-watch regression stacks: `BOS_NO_WATCH=1` makes every local service build once and serve the built output instead of running rspack/rsbuild watchers — the regression suite needs no hot reload, and the watchers were the stack's heaviest processes (freezing shared CI runners under their accumulated footprint ~26 tests in). Plugin API services run a one-shot `rspack build` and serve `dist` statically; folder-form ui sources build once and serve the ui source root's `dist` on `BOS_UI_PORT`; the core ui gains a `dev:built` script (`rsbuild build && rsbuild preview`). Local `bos dev` stays watch-mode. The CI regression suite also splits into two parallel jobs (SSR + CSR), each with its own 20-minute budget and a resource watchdog logging memory/top processes to the failure artifacts.
