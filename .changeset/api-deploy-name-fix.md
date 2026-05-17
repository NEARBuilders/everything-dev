---
"api": patch
---

Remove hardcoded `name` field requirement from deploy config updater. API deploys now correctly update `bos.config.json` without requiring a `name` property in the config.
