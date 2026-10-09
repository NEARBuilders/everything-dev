---
"everything-dev": minor
"every-plugin": minor
---

Differential bundle uploads: each deploy's version manifest now records the dist's full per-file SRI map (`files`), the next deploy hashes its local dist against it and re-uploads only new or changed files. Previous pins resolve from a new `.bos/deploy-state.json` pointer (written after every confirmed publish) with the published config as fallback; any unusable previous manifest degrades to a full upload. `--full-upload` / `BOS_FULL_UPLOAD=1` bypasses the diff.
