---
"every-plugin": patch
---

Bin scripts run on node

`every-plugin` / `every-plugin-serve` bins drop the bun shebang: they re-exec through tsx (dev carries the `development` export condition), and non-dev commands run the built `dist/cli.cjs` when present — falling back to tsx + src only for the fresh-checkout bootstrap build.
