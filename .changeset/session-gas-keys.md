---
"better-near-auth": minor
"@everything-dev/auth-plugin": minor
---

Session gas keys (NEP-611) are the primary gasless write path, and the legacy sub-account relayer-FCAK config is removed.

New: `siwn({ sessionGasKey })` (flat or dual-network, like the relayer) — scope (`receiverId`/`methodNames`), top-up fund amount and threshold, per-user lifetime cap, and nonce-lane count. New session-gated endpoints: `POST /near/gas-key/fund` (Sponsor-signed `TransferToGasKey` under on-chain scope/balance verification and the lifetime cap, recorded in a `fundedGasKey` table), `POST /near/gas-key/info`, and `GET /near/gas-key/scope`. The client gains `addSessionGasKey` (wallet-signed Bootstrap `AddKey` with `gasKeyInfo`, refused for wallets whose manifest lacks `features.gasKeys`), `sendWithGasKey` (local signing on rotating nonce lanes through a wallet-less client), `refreshGasKeyInfo`, `ensureGasKeyFunded`, `isGasKeyWalletSupported`, and `getGasKeyScope`; a `gasKeyState` atom joins the client atoms. The wallet connector is now `@hot-labs/near-connect` (installed from the gas-key-capable fork `elliotBraem/near-connect#v0.12.0-fork.2` — the fork line gas-key wallets run); near-kit is bumped to ^0.20.2.

Removed: `SubAccountConfig.addRelayerFCAK` / `relayerFCAK` and the `NEAR_SUB_ACCOUNT_PARENT_KEY_*` secret plumbing — session gas keys are the only key-sponsorship mechanism. Sub-account creation still works with an explicit relayer whose account is the parent, or a parent key passed directly via `siwn({ secrets: { parentKey } })`. See ADR 0017 for the model (session gas keys first, relayer fallback).
