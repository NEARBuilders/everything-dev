---
"every-plugin": patch
"everything-dev": patch
---

Fix dev/regression builds shipping hashed MF entry names, and make the regression start fixture pin its slots. `isBuildInvocation` now keys on an explicit `BOS_DEV_SERVER=1` stamp (dev servers mark their own bundler children) instead of NODE_ENV/DEPLOY — vitest's `test` env and the bundler CLIs' `production` default can no longer misclassify a dev server, and every non-dev build (local, host-test, container, deploy) emits content-hashed entries + build reports. The host rsbuild config adopts the same hashed-entry + report contract, making `app.host` pinnable by the deploy train. Slot pins resolve against the slot's remote base (`remoteUrl`), not the host's listening URL. The regression container-build composes per-slot version manifests (local SRI) and stamps `pin: {manifest, integrity}` into the variant configs — ADR 0009 amendment: pins are the only production slot shape — and the version manifests' `ssr.entry` carries its `ssr/` path segment so derived `ssrEntryUrl` points at the real bytes.
