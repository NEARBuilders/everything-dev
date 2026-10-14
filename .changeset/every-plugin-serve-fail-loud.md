---
"every-plugin": patch
---

`every-plugin serve` fails loud when the built ui dist is missing (#343) — a one-shot build whose output layout mismatches no longer warns and then serves 404s for every ui asset. The ui dist root is derived from the generated config factory (`uiDistDirFor`) instead of re-guessing the layout from the cwd basename, and `remote-entry`'s internal `sleep` helper is no longer exported.
