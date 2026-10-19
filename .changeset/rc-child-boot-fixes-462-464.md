---
"everything-dev": patch
---

Fix three rc-train child boot problems (#462–#464):

- `createAuthMiddleware` pass-through middlewares (`requireAuthOrApiKey`, `requirePermission`) now declare their output context as `Record<never, never>` instead of `Record<string, never>` — oRPC's `IntersectPick` forced the old shape to provide every context key (including the required `"effect/context"`), failing typecheck at every `.use()` call site on rc-train contracts (#464).
- Version-manifest pin derivation no longer wholesale-skips development: pinned remote slots derive `entryUrl`/integrity in dev too, so dev children consuming remote production slots stop hanging forever probing the fixed-name `remoteEntry.js` that hash-canonical bundles never serve. Unpinned dev remote slots skip silently and a failed pin fetch degrades to warn-and-skip in dev; the unpinned/failed-in-production hard throw is unchanged (#463).
- `bos init` defaults its extends prompt (placeholder and default) to the production row `bos://dev.everything.near/everything.dev` — the staging row `dev.everything.near/dev.everything.dev` is still published from the superseded stable train and bricks rc-train children extending it (#462).
