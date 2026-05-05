# @everything-dev/auth-plugin

## 1.1.0

### Minor Changes

- 7c62044: Upgrade better-auth to 1.6.9, mature auth plugin, and add auth orchestration

  Auth plugin now uses Drizzle migrations with virtual:drizzle-migrations, Effect acquireRelease for DB lifecycle, and requires BETTER_AUTH_SECRET. Fixes API key and invitation method shapes for better-auth 1.6.9. The everything-dev CLI orchestrates auth as a first-class dev process. Host replaces Deferred with FiberHandle and resets federation state on shutdown.

- 6428994: Switch from npm better-near-auth v0.6.0 to local file:../../lib/better-near-auth. Replaces @fastnear/wallet and @fastnear/near-connect with @hot-labs/near-connect + near-kit, removing the "Receiving connection details…" wallet modal hang. Also fixes session race condition in login redirect and NEAR sign-in pending state timing.

### Patch Changes

- a483214: Fix build and test issues after switching to local better-near-auth

  - Added `@hot-labs/near-connect@0.11.2` as a root dependency and override to resolve missing prebuilt artifacts from the GitHub version
  - Fixed duplicate `"clsx"` key in `ui/package.json` that caused `bun install` warnings
  - Updated `better-near-auth` API usage in `$gatewayId.tsx` to match new `buildSignedDelegateAction(receiverId, builderFn)` signature and `relayTransaction({ payload })` shape
  - Fixed `deposit` → `attachedDeposit: 0n` to satisfy `AmountInput` type requirements
  - Removed unused `normalizePath` function in `plugins/auth/rspack.config.js`
  - Fixed `EmitPluginManifest` `srcPath` from `"types/auth-export.d.ts"` to `"auth-export.d.ts"` (plugin already prefixes `types/`)
  - Added `--root .` to `api` vitest scripts to prevent test discovery leaking into other workspace packages

- 069cb6a: Upgrade better-near-auth from local file import to published v1.0.0

  Switches the workspace catalog entry from `file:../../lib/better-near-auth` to `^1.0.0`, consuming the official npm release. The v1.0.0 package already includes the near-kit + @hot-labs/near-connect migration and the relay API shape used by the gateway page, so no source code changes are required.

  - `relayer: {}` in server config continues to use all defaults (ephemeral auto-generated keypair)
  - Client `siwnClient({ recipient, networkId })` remains valid
  - `auth.near.buildSignedDelegateAction()` and `auth.near.relayTransaction({ payload })` APIs unchanged

- Updated dependencies [368c872]
  - every-plugin@2.4.0

## 1.1.0

### Minor Changes

- 7c62044: Upgrade better-auth to 1.6.9, mature auth plugin, and add auth orchestration

  Auth plugin now uses Drizzle migrations with virtual:drizzle-migrations, Effect acquireRelease for DB lifecycle, and requires BETTER_AUTH_SECRET. Fixes API key and invitation method shapes for better-auth 1.6.9. The everything-dev CLI orchestrates auth as a first-class dev process. Host replaces Deferred with FiberHandle and resets federation state on shutdown.

- 6428994: Switch from npm better-near-auth v0.6.0 to local file:../../lib/better-near-auth. Replaces @fastnear/wallet and @fastnear/near-connect with @hot-labs/near-connect + near-kit, removing the "Receiving connection details…" wallet modal hang. Also fixes session race condition in login redirect and NEAR sign-in pending state timing.

### Patch Changes

- a483214: Fix build and test issues after switching to local better-near-auth

  - Added `@hot-labs/near-connect@0.11.2` as a root dependency and override to resolve missing prebuilt artifacts from the GitHub version
  - Fixed duplicate `"clsx"` key in `ui/package.json` that caused `bun install` warnings
  - Updated `better-near-auth` API usage in `$gatewayId.tsx` to match new `buildSignedDelegateAction(receiverId, builderFn)` signature and `relayTransaction({ payload })` shape
  - Fixed `deposit` → `attachedDeposit: 0n` to satisfy `AmountInput` type requirements
  - Removed unused `normalizePath` function in `plugins/auth/rspack.config.js`
  - Fixed `EmitPluginManifest` `srcPath` from `"types/auth-export.d.ts"` to `"auth-export.d.ts"` (plugin already prefixes `types/`)
  - Added `--root .` to `api` vitest scripts to prevent test discovery leaking into other workspace packages

- 069cb6a: Upgrade better-near-auth from local file import to published v1.0.0

  Switches the workspace catalog entry from `file:../../lib/better-near-auth` to `^1.0.0`, consuming the official npm release. The v1.0.0 package already includes the near-kit + @hot-labs/near-connect migration and the relay API shape used by the gateway page, so no source code changes are required.

  - `relayer: {}` in server config continues to use all defaults (ephemeral auto-generated keypair)
  - Client `siwnClient({ recipient, networkId })` remains valid
  - `auth.near.buildSignedDelegateAction()` and `auth.near.relayTransaction({ payload })` APIs unchanged

- Updated dependencies [368c872]
  - every-plugin@2.4.0
