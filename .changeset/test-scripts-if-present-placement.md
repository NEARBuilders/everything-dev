---
"everything-dev": patch
---

Fix generated child test scripts for pnpm 12: `--if-present` was passed after the script name (`pnpm --dir api run test --if-present`), where pnpm 12 forwards it to the script itself — vitest dies with `CACError: Unknown option --ifPresent`. The flag now precedes `run` in the `test`, `test:api`, `test:integration`, and `test:e2e` root scripts.
