---
"everything-dev": minor
---

Stream-driven ANSI TUI for `bos dev` — drops ink and React from the CLI package. The interactive view is now a pure render function over a single session-state holder with a hand-rolled alt-screen renderer (raw-stdin `q`/`l`/`ctrl+c` keys, terminal fully restored on exit); the piped/non-TTY fallback reuses the same render helpers and prints incrementally, deleting the duplicated streaming view. `ink`, `react`/`react-dom` (peer), `gradient-string`, and their type packages are removed from the manifest; the banner gradient is a small truecolor ramp.
