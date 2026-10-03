---
"everything-dev": patch
---

Fix `bos dev` stacks whose `app.auth` plugin has a local folder-form ui (`plugins/auth/ui`): the atomic port-block allocator (ADR 0012) stopped reserving a `plugin-ui:auth` port for the auth mirror, so the runtime config advertised an empty auth ui url — the browser could never load the auth remote and the `/login` page never rendered (both dev regression browser suites failed). The mirror's ui surface now gets a block-allocated port again and the planner patches `plugins.auth.ui.url` with it. Regression stack logs drop the colon (`regression-dev-ssr.log`) so failed-run artifact uploads no longer bounce off upload-artifact's invalid-character check.
