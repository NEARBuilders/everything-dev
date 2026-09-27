---
"everything-dev": minor
"ui": minor
---

The core UI rsbuild config is synthesized when the ui workspace has no local `rsbuild.config.ts` — the every-plugin generated-config model. The ui package's dev/build/preview scripts route through the new `bos-ui` bin (`everything-dev/ui-build`), which honors a local `rsbuild.config.ts` as an override and otherwise generates one from the shared `every-plugin/ui/mf-build` factory (provider role, `CORE_UI_PLUGIN_KEY`, the web/node exposes, public copy, and the `APP_NAME`/`APP_ACCOUNT` defines derived from the resolved runtime config). The config drops from the scaffold: `bos init` no longer copies it and `bos sync` treats an existing child config as app-owned. Closes #187. Also raises the ui lib target to ES2024 (`Promise.withResolvers`).
