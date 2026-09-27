---
"better-near-auth": patch
"everything-dev": patch
---

Confirm the SIWN auth relayer is in `RelayerEphemeralConfig` ("Ephemeral with settings") mode: a rich-object `relayer` block in `bos.config.json → app.auth.variables.siwn` with `whitelistedContracts`, `maxGasPerTransaction`, and `maxDepositPerTransaction` and no `accountId` / `privateKey`. better-near-auth 1.9.0's `initRelayer` resolves this to an auto-generated ED25519 keypair on first startup, encrypted with `BETTER_AUTH_SECRET` (HKDF-SHA256 → AES-256-GCM) and persisted in the `relayerKey` table.

The vestigial `NEAR_RELAYER_PRIVATE_KEY` line is removed from `.env.example` in favor of an inline comment pointing operators at `/admin/relayer` (which surfaces a "needs funding" prompt using `getRelayerInfo().enabled === false` once the auto-generated implicit account has zero balance). Operators funding the implicit account via `authClient.near.getNearClient().transfer()` enables relay without ever leaving the existing ephemeral-mode config.

AGENTS.md gains a "SIWN Auth Relayer" subsection under "Common Patterns" documenting the operational rules (funding flow, parent-key requirement for sub-account creation, why the implicit relayer account can't own sub-accounts, and the path back to `RelayerExplicitConfig` if a named-account relayer is needed).
