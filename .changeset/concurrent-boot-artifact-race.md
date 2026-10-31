---
"everything-dev": patch
---

Concurrent `bos dev` sessions in one config dir no longer crash artifact generation: `.bos/bos.resolved-config.json` is now written atomically (tmp + rename) so a sibling session never reads a torn file, and the contract-bridge stale sweep removes gen files with `rmSync(…, { force: true })` so a file vanishing between the existence check and the removal no longer fails the boot with `ENOENT … lstat`.
