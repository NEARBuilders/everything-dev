---
"everything-dev": patch
---

Fix `run()` capturing empty stdout for successful subprocesses — the deploy image leg falsely failed with "Failed to resolve the current git SHA". Reads the settled execa result instead of the promise object, and reports missing binaries (ENOENT) as failures instead of exit code 0.
