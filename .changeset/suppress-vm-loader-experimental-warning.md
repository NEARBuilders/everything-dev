---
"host": patch
---

Silence the `vm.USE_MAIN_CONTEXT_DEFAULT_LOADER` experimental warning in the host process. The warning fires (with a large eval'd webpack stack) whenever the federation runtime evaluates a plugin remote whose bundled `@better-auth/core` lazily imports `node:async_hooks` from a runtime `import()`. The host now installs a `process.on("warning")` filter at boot that drops this known-benign warning and re-emits every other warning (name + message + stack) since the listener disables Node's default warning printing.
