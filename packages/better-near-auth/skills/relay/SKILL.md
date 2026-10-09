---
name: relay
description: >
  Configure the gasless NEP-366 delegate action relayer in ephemeral or explicit
  mode, relay signed delegate actions on-chain, enforce contract whitelisting and
  gas/deposit limits, check relay status and history, and use the contract view
  endpoint. Load when setting up relayer config or debugging relay failures.
metadata:
  type: core
  library: better-near-auth
  library_version: "2.0.0-rc.0"
sources:
  - "elliotBraem/better-near-auth:src/index.ts"
  - "elliotBraem/better-near-auth:src/utils.ts"
  - "elliotBraem/better-near-auth:src/types.ts"
  - "elliotBraem/better-near-auth:src/schema.ts"
  - "elliotBraem/better-near-auth:README.md"
  - "elliotBraem/better-near-auth:LLM.txt"
---

# Better-Near-Auth — Gasless Relay

Built-in NEP-366 delegate action relayer that broadcasts signed transactions on behalf of authenticated users, paying gas from a relayer account. Supports ephemeral mode (auto-generated keypair) and explicit mode (named account with provided keys).

## Setup

### Ephemeral mode (zero-config)

```typescript
import { siwn } from "better-near-auth";

export const auth = betterAuth({
  plugins: [
    siwn({
      recipient: "myapp.com",
      // Omit `accountId` to auto-generate the ephemeral keypair on first startup
      relayer: {
        whitelistedContracts: ["myapp.near"],
      },
    }),
  ],
});
```

On first startup, the server logs the ephemeral account ID. **Fund this account with NEAR** to enable relay:

```
[siwn] Relayer initialized: 7a3c4b5c... (mainnet, ephemeral)
[siwn] Fund this account with NEAR to enable gasless relay
[siwn] Private key is encrypted in DB — persists across restarts
```

The private key is encrypted with AES-256-GCM using `BETTER_AUTH_SECRET` as the KEK and stored in the `relayerKey` database table.

### Ephemeral with settings

```typescript
siwn({
  recipient: "myapp.com",
  relayer: {
    whitelistedContracts: ["myapp.near"],
    maxGasPerTransaction: "300000000000000", // 300 Tgas
    maxDepositPerTransaction: "0",
  },
});
```

### Explicit mode (production)

```typescript
siwn({
  recipient: "myapp.com",
  relayer: {
    accountId: "relayer.myapp.near",
    privateKey: process.env.RELAYER_PRIVATE_KEY, // ed25519:...
    whitelistedContracts: ["myapp.near"],
    maxGasPerTransaction: "300000000000000", // 300 Tgas
    maxDepositPerTransaction: "0",
  },
});
```

### Per-network configuration

```typescript
siwn({
  recipients: {
    mainnet: "myapp.com",
    testnet: "myapp.testnet",
  },
  relayer: {
    mainnet: {
      accountId: "relayer.myapp.near",
      privateKey: process.env.RELAYER_PRIVATE_KEY_MAINNET,
      whitelistedContracts: ["myapp.near"],
    },
    testnet: {
      accountId: "relayer.myapp.testnet",
      privateKey: process.env.RELAYER_PRIVATE_KEY_TESTNET,
      whitelistedContracts: ["myapp.testnet"],
      maxGasPerTransaction: "100000000000000", // lower for testing
    },
  },
});
```

Each network gets its own keypair and policy. When `accountId` is omitted, ephemeral keys are generated independently per network.

## Core Patterns

### Relay a delegate action from client to on-chain

```typescript
import { Gas } from "near-kit";

// 1. Build signed delegate action using wallet's function-call access key
const payload = await authClient.near.buildSignedDelegateAction(
  "myapp.near",
  (builder, receiverId) => builder.functionCall(receiverId, "some_method", { key: "value" }, {
    gas: Gas.Tgas(30),
    attachedDeposit: BigInt(0),
  })
);

// 2. Relay it — the server pays gas
const result = await authClient.near.relayTransaction({ payload });
console.log("Tx hash:", result.data.txHash);

// 3. Check status
const status = await authClient.near.getRelayStatus(result.data.txHash);
console.log("Status:", status.data.status); // "pending" | "completed" | "failed"
```

The `buildSignedDelegateAction` callback receives a `TransactionBuilder` and the `receiverId`. The builder must use `.functionCall()` — external code constructs the transaction object using near-kit's builder API. Do not use `.send()` directly.

### Check relayer info and balance

```typescript
const info = await authClient.near.getRelayerInfo();
console.log("Relayer:", info.data.accountId);
console.log("Mode:", info.data.mode); // "ephemeral" | "explicit"
console.log("Balance:", info.data.balance);
console.log("Enabled:", info.data.enabled);
```

### Server-side contract view call

```typescript
const result = await authClient.near.view({
  contractId: "myapp.near",
  methodName: "get_value",
  args: { account_id: "alice.near" },
});
console.log("Result:", result.data.result);
```

View calls are read-only, authenticated, and executed server-side.

## Relay Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/near/relay` | Relay a signed delegate action on-chain |
| GET | `/near/relay-status/:txHash` | Check relayed transaction status |
| POST | `/near/relayer-info` | Get relayer accountId, mode, balance |
| GET | `/near/relay-history` | List relayed transactions for current user |
| POST | `/near/view` | Server-side read-only contract call |

## Relayer Configuration

The relayer takes a single `RelayerConfig` shape. The mode is determined at runtime by whether `accountId` is set:

| Form | Mode | Description |
|------|------|-------------|
| `{ whitelistedContracts?: ... }` | Ephemeral | Auto-generated ED25519 keypair (simplest) |
| `{ accountId, privateKey, ... }` | Explicit | Bring your own key for a named account |
| `{ mainnet: {...}, testnet: {...} }` | Mixed | Per-network configuration |

**`RelayerConfig`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accountId` | `string` | — | Named relayer account. If set, the relayer runs in explicit mode using `privateKey`. |
| `privateKey` | `string` | — | ed25519:... private key. Required when `accountId` is set; otherwise the relayer logs a warning and falls back to ephemeral mode. |
| `whitelistedContracts` | `string[]` | — | Restrict relay to these contract IDs |
| `maxGasPerTransaction` | `string` | — | Max gas per relayed transaction (yoctoNEAR) |
| `maxDepositPerTransaction` | `string` | — | Max deposit per relayed transaction (yoctoNEAR) |

**`RelayerDualNetworkConfig`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mainnet` | `RelayerConfig` | — | Per-network config. Independent ephemeral keys when `accountId` is omitted. |
| `testnet` | `RelayerConfig` | — | Per-network config. Independent ephemeral keys when `accountId` is omitted. |

When `accountId` is not set, an ED25519 keypair is generated on first startup, the implicit account ID is derived from the public key, and the private key is encrypted with AES-256-GCM (using `BETTER_AUTH_SECRET` as KEK via HKDF-SHA256) and stored in the database. The same keypair is recovered on restart.

## Encryption Details

- **KEK derivation**: HKDF-SHA256 with `BETTER_AUTH_SECRET`, salt `better-near-auth-relayer`, info empty
- **Encryption**: AES-256-GCM with 12-byte random IV
- **Storage**: `encryptedPrivateKey` (base64) + `iv` (base64) in `relayerKey` table
- **Trust model**: Same as Better Auth session tokens — DB access + `BETTER_AUTH_SECRET` = full access

## Common Mistakes

### CRITICAL Not funding the ephemeral relayer account

```typescript
siwn({
  recipient: "myapp.com",
  relayer: {
    // Omit accountId to use ephemeral mode (account starts with zero balance)
    whitelistedContracts: ["myapp.near"],
  },
});
// After startup, check logs for the accountId:
// [siwn] Relayer initialized: 7a3c4b5c... (mainnet, ephemeral)
// Send NEAR to that account ID to fund the relayer — every relay attempt fails otherwise
```

The ephemeral mode generates an implicit account (hex of public key) with zero balance. Without funding, every relay attempt fails with an insufficient balance error from the NEAR RPC. The server catches this at src/index.ts:1153-1160 and surfaces it as `"Relay failed"` — check server logs for the actual RPC error. Alternatively, use explicit mode with a pre-funded named account.

Source: src/index.ts:152-235, maintainer interview

### CRITICAL Empty relayer_key table (config not passed)

Correct:

```typescript
// Provide a config object — even an empty one enables ephemeral mode
relayer: {
  whitelistedContracts: ["myapp.near"],
}
```

If the `relayer_key` table exists but is empty after startup, the relayer config is not being passed correctly. Check:
1. `BETTER_AUTH_SECRET` is set (required for ephemeral mode)
2. Relayer config is actually passed to `siwn()` plugin
3. Startup logs show `[siwn] Relayer initialized` message

Source: maintainer interview

### CRITICAL Omitting whitelistedContracts in production

Wrong:

```typescript
siwn({
  recipient: "myapp.com",
  relayer: {
    accountId: "relayer.myapp.near",
    privateKey: process.env.RELAYER_PRIVATE_KEY,
    // No whitelistedContracts — any contract can be called at relayer's expense
  },
});
```

Correct:

```typescript
siwn({
  recipient: "myapp.com",
  relayer: {
    accountId: "relayer.myapp.near",
    privateKey: process.env.RELAYER_PRIVATE_KEY,
    whitelistedContracts: ["myapp.near"],
  },
});
```

Without whitelistedContracts, any authenticated user can relay transactions to arbitrary contracts, spending the relayer's NEAR. Always restrict in production.

Source: src/index.ts:891-898, maintainer interview

### HIGH Constructing transactions with wrong builder pattern

Wrong:

```typescript
// Wrong: trying to send directly instead of delegate
const result = await near.transaction(accountId)
  .functionCall(receiverId, "method", args, { gas: Gas.Tgas(30) })
  .send({ waitUntil: "EXECUTED" });
```

Correct:

```typescript
// Correct: build signed delegate action, then relay via server
const payload = await authClient.near.buildSignedDelegateAction(
  "myapp.near",
  (builder, receiverId) => builder.functionCall(receiverId, "method", args, {
    gas: Gas.Tgas(30),
    attachedDeposit: BigInt(0),
  })
);
const result = await authClient.near.relayTransaction({ payload });
```

Delegate actions must be built using the near-kit `TransactionBuilder` with `.delegate()`, not `.send()` directly. The wallet signs a delegate action; the relayer submits it on-chain. For direct sends (user pays gas), call `authClient.near.ensureConnected()` first — wallet extensions may disconnect between sign-in and signing.

Source: src/client.ts:172-185, maintainer interview

See also: client/SKILL.md — client buildSignedDelegateAction API

### HIGH Missing BETTER_AUTH_SECRET for ephemeral key encryption

Wrong:

```typescript
// No BETTER_AUTH_SECRET set — ephemeral key encryption uses empty string
siwn({
  recipient: "myapp.com",
  relayer: {
    whitelistedContracts: ["myapp.near"],
  },
});
```

Correct:

```typescript
// BETTER_AUTH_SECRET is required by Better Auth and used by the relayer
// Set it in your environment or Better Auth config
process.env.BETTER_AUTH_SECRET = "your-secure-secret";
siwn({
  recipient: "myapp.com",
  relayer: {
    whitelistedContracts: ["myapp.near"],
  },
});
```

The ephemeral relayer encrypts its private key using HKDF-SHA256 derived from `BETTER_AUTH_SECRET`. If missing, key derivation falls back to an empty string, which is insecure and may cause decryption failures on server restart.

Source: src/utils.ts:21-41, src/index.ts:133

## The tasks you will actually be given

**"Set up gasless transactions for our dev server."**
Add `relayer: { whitelistedContracts: ["myapp.near"] }` to `siwn()` (omit `accountId` for ephemeral mode), restart, read the account ID from the `[siwn] Relayer initialized: ... (ephemeral)` startup log, and send NEAR to that implicit account — every relay fails until it is funded.

**"Relay a write for the signed-in user."**
Build the payload with `authClient.near.buildSignedDelegateAction(receiverId, builder)` (client), then `POST /near/relay` via `relayTransaction({ payload })`; confirm with `getRelayStatus(txHash)`.

**"A user's relay was submitted but never landed."**
Poll `GET /near/relay-status/:txHash` until `"completed"` or `"failed"`, and check `GET /near/relay-history` (rows live in the `relayedTransaction` table, written with `status: "pending"` at submit time).

## What comes back when it refuses

| What you see | Where it comes from | Action |
| --- | --- | --- |
| `Relayer not configured` (503) | `ensureRelayer` returned no state — config not passed or `BETTER_AUTH_SECRET` missing | Stop — check the `[siwn] Relayer initialized` startup log first |
| `Contract <receiverId> is not whitelisted for relay` (403) | `whitelistedContracts` check in src/index.ts | Stop — add the receiverId to `relayer.whitelistedContracts` or the user must pick another contract |
| `Transaction gas (...) exceeds relayer limit (...)` (400) | `maxGasPerTransaction` sum over all actions | Stop — lower the action gas or raise the limit |
| `Transaction deposit (...) exceeds relayer limit (...)` (400) | `maxDepositPerTransaction` sum over functionCall/transfer deposits | Stop — same as above for deposits |
| `Delegate action sender does not match session account` (401) | `senderId` ≠ primary linked account | Stop — rebuild the payload for the session's account; do not retry |
| 500 wrapping an RPC error (logged server-side, generic message on the wire) | `relayOnChain` threw — usually the unfunded ephemeral relayer | Tell the user after funding; do not blind-retry |
| `Relayer accountId "..." is set for <network> but no privateKey was provided. Falling back to ephemeral mode.` (startup warning) | Explicit config missing `privateKey` | Stop — supply the key or drop `accountId` deliberately |


