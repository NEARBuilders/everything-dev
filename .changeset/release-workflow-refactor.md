---
"everything-dev": patch
---

Refactor CI/release workflows: rename `release-sync.yml` template to `release.yml` and make it a reusable `workflow_call`, add `fail_on_critical_high` input to CI audit step, split parent release into `publish` + `deploy` jobs calling the template, and clean up obsolete `release-sync.yml` on upgrade. Improve config logging: collect `[Config]` warnings during `loadConfig` and return them in `ConfigResult.warnings` instead of emitting `console.warn` mid-spinner, suppress warnings around direct `buildRuntimeConfig` calls in the plugin runtime, and log `Resolving "app.auth" from bos://...` instead of the generic "No development target" when an `extends` ref is present.