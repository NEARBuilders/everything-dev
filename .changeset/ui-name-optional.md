---
"everything-dev": patch
---

Make `app.ui.name` optional in `BosConfigSchema` to match `app.api` and `app.auth`. Previously `UiConfigSchema` required `name`, causing `Failed to load config` errors when `bos.config.json` omitted it. The UI name now falls back to `package.json` name or `"ui"` at runtime, consistent with other app entries.
