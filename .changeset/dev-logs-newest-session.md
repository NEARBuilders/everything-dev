---
"everything-dev": patch
---

`bos logs` resolves the newest session's log by session start time (parsed from the file header) instead of file mtime, with a pid tie-break — fixes wrong-session resolution when mtimes tie on coarse-grained CI filesystems or when an older session has written more recently.
