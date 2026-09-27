---
"everything-dev": minor
---

Unified dev-session log pipeline: normalize → classify → level-filter → broadcast to the screen tail, log file, and `l`/shutdown export. Adds `bos dev --log-level` (error|warn|info|debug, overrides `BOS_LOG_LEVEL`; `DEBUG` still shows everything), collapses multi-line Effect Logger objects and stack traces, folds `LOG_NOISE_PATTERNS` into the classifier, collapses `[Database]` startup runs to a single `db ready` event per plugin, and logs clean SIGTERM quits at info instead of `[ERR]`. The log file now always receives every line.
