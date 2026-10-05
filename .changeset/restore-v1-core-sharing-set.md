---
"every-plugin": patch
---

Restore the v1-proven core sharing set: `@orpc/openapi`, `@orpc/experimental-effect`, and `@orpc/publisher` leave `CORE_SHARED_DEPS` and the runtime's core module loaders. Consuming them through the share scope crashed every plugin bundle that imports them at runtime (`__webpack_modules__[r] is not a function` — the runtime's `import()`-based provide hands the rspack consumer an ESM namespace object where a module factory is expected; the first-ever runtime load of this bundle generation failed on six of seven plugins, and template only survived because it is the one workspace that does not import `@orpc/openapi`). They are declared in each workspace's `package.json` (the phantom-dep fix stays) and are bundled per workspace instead, matching v1's proven production shape. Also logs the failing error's stack alongside the classified message in the plugin-load retry reporter — the message alone turned this diagnosis into hours.
