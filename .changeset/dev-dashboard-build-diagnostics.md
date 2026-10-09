---
"everything-dev": patch
---

`bos dev`'s log pipeline now promotes rsbuild/rspack build diagnostics (`File: …` and `× …` lines) to error level. rsbuild writes the `Build error:` title to stderr with an empty message and the actual diagnostics to stdout, which the default warn display filter dropped — the dashboard showed an unhelpful bare `Build error:` while the cause was only visible in `.bos/logs/dev-latest-*.log`.
