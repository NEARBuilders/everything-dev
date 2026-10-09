---
"everything-dev": patch
---

`everything-dev/ui/auth`'s published types collapsed to `any`: when the dts build ran while a workspace dependency's dist types (better-near-auth) were missing or unresolvable, rolldown-plugin-dts silently emitted `createAuthClient(options?): any`, poisoning `AuthClient`, `SessionData`, `Organization`, `Passkey`, and the session query types for every npm consumer (this shipped in 2.0.0-rc.1). The emitted declaration also referenced `RelayedTransactionT` without importing it. The everything-dev build now guards both ends: it fails fast when the workspace dependencies' dist types are missing (`pnpm --filter better-near-auth build` fixes it) and fails the build if the emitted `createAuthClient` return type collapses to `any`.
