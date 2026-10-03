---
"ui": patch
"everything-dev": patch
---

Update `buildSignedDelegateAction` callbacks in the citynode UI to the two-argument `(builder, receiverId)` form required by `better-near-auth` 1.10.x and the documented `near-connect` skill, and pass `receiverId` into `functionCall` in place of the previously hard-coded `prepared.data.contractId`. This matches the new callback signature in both signature shape and behaviour since `buildSignedDelegateAction` forwards its receiverId to the builder callback.

Make `init.full.test.ts` permissive about custom UI/API implementations: it now scaffolds `["template"]` only (no proposals, votes, apps), writes a permissive gen-file stub after `types:gen` runs, and only typechecks `api` and `plugins/_template`. The full UI scaffold typecheck moved out of the regression because `ContractRouterClient<T>` reproduces its conditional shape for any stubbed `T`, and pinning the typecheck against citynode-specific plugin-namespace calls would couple the regression to a specific configuration.

Restore the missing `checkCdnProviderDeployable` export from `packages/everything-dev/src/build.ts` so the framework tarball build (a prerequisite of the test) no longer fails on the pre-existing broken `publish.ts → build` re-export.
