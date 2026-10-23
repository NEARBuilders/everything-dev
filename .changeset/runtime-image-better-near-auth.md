---
"everything-dev": patch
---

fix(deploy): ship better-near-auth in the universal runtime image — the CLI dist value-imports BOS_CLI_CLIENT_ID from it at boot (device-login), but the runtime stage never copied the workspace and it was declared only as an optional peer/devDep, so the smoke boot container died with ERR_MODULE_NOT_FOUND and rolled the deploy back. Now a declared dependency of the CLI (owning its runtime closure), copied into the runtime stage with a build-time boot assert that fails the image build instead of post-publish smoke.
