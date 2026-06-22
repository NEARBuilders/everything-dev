---
"everything-dev": minor
---

Add `--remote-plugins` flag to `bos dev` for per-plugin remote toggle

```bash
bos dev --remote-plugins auth,registry
```

Forces specified plugins to use their production URLs even when a local
development path exists on disk. This is useful when you only want to
work on a subset of plugins locally while ignoring others.

The flag accepts a comma-separated list of plugin IDs and can be combined
with existing flags like `--host remote` or `--ui remote`.
