---
name: client
description: >
  Set up the siwnClient plugin for Better Auth client, configure NEAR wallet
  connection via NearConnect, use authClient.near actions for sign-in, profile
  lookup, account management, delegate action building with TransactionBuilder,
  and relay submission. Use the better-near-auth/react hooks (useNearAccountId,
  useNearConnection, useNearState, useWalletConnected, useActiveNetwork) and
  typed atoms via getNearAtoms for reactive wallet state. Load when implementing
  NEAR wallet sign-in on the client, using authClient.near.* methods, consuming
  wallet state in React, or building delegate actions for gasless relay.
metadata:
  type: core
  library: better-near-auth
  library_version: "2.0.0-rc.0"
sources:
  - "elliotBraem/better-near-auth:src/client.ts"
  - "elliotBraem/better-near-auth:src/types.ts"
  - "elliotBraem/better-near-auth:README.md"
  - "elliotBraem/better-near-auth:LLM.txt"
  - "elliotBraem/better-near-auth:src/index.ts"
---

# Better-Near-Auth — Client Integration

Client-side plugin for NEAR wallet authentication and gasless relay. Connects to NEAR wallets via NearConnect, provides `authClient.near.*` actions for sign-in, account management, profile lookup, and delegate action building.

## SSR Behavior

`siwnClient()` is SSR-safe. Wallet resources (`NearConnector`, `Near`, event listeners) are lazily initialized on first client-side access — they do not run at construction time. On the server:

- `getAccountId()` returns `null` (no session yet) — once the session resolves on the client, it returns the primary SIWN-linked account (`session.user.nearAccount`) until NearConnect initializes.
- `getState()` returns `null`
- `isWalletConnected()` returns `false`
- `detectNearAccount()` returns `null` (no browser wallet to probe)
- `buildSignedDelegateAction`, `signWithWallet`, `ensureConnected` throw "Wallet not initialized — this operation requires a browser environment"
- `getNearClient()` throws if no wallet is initialized
- HTTP-only methods (`nonce`, `verify`, `view`, `relayTransaction`, etc.) work normally via `$fetch`

## Setup

### Simple app (module singleton)

```typescript
import { createAuthClient } from "better-auth/client";
import { siwnClient } from "better-near-auth/client";

export const authClient = createAuthClient({
  plugins: [
    siwnClient({
      recipient: "myapp.com",
      networkId: "mainnet",
    }),
  ],
});
```

### SSR app (router context)

For TanStack Router with server rendering, create the auth client once in your router setup and access via context:

```typescript
// auth.ts
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { siwnClient } from "better-near-auth/client";
import { useRouter } from "@tanstack/react-router";

export function createAuthClient() {
  return createBetterAuthClient({
    plugins: [siwnClient({ recipient: getAccount(), networkId: getNetworkId() })],
  });
}

export type AuthClient = ReturnType<typeof createAuthClient>;

export function useAuthClient(): AuthClient {
  return useRouter().options.context.authClient;
}

// hydrate.tsx — create once, put in router context
const { router } = createRouter({
  context: { authClient: createAuthClient() },
});
```

A module-level singleton is shared across SSR requests, causing data leaks. Router context gives one client per request on server, one per app on client.

The `recipient` must match the server's `siwn()` recipient exactly. `networkId` defaults to `"mainnet"`.

## Core Patterns

### Sign in with NEAR wallet

```typescript
await authClient.signIn.near({
  onSuccess: () => {
    console.log("Signed in!");
  },
  onError: (error) => {
    console.error("Sign in failed:", error.message);
  },
});
```

`signIn.near()` handles the full flow: wallet connection → NEP-413 message signing → server verification → session creation. It automatically detects wallet capabilities and uses single-step or two-step flow.

### Build and relay a delegate action

```typescript
import { Gas } from "near-kit";

const payload = await authClient.near.buildSignedDelegateAction(
  "myapp.near",
  (builder, receiverId) => builder.functionCall(receiverId, "some_method", { key: "value" }, {
    gas: Gas.Tgas(30),
    attachedDeposit: BigInt(0),
  })
);

const result = await authClient.near.relayTransaction({ payload });
console.log("Tx hash:", result.data.txHash);

const status = await authClient.near.getRelayStatus(result.data.txHash);
console.log("Status:", status.data.status);
```

The `buildSignedDelegateAction` callback receives a `TransactionBuilder` from near-kit and the `receiverId`. Use `builder.functionCall()` to construct actions. The builder calls `.delegate()` internally and returns a base64 payload string.

`buildSignedDelegateAction` automatically calls `ensureConnected()` if the wallet is disconnected, prompting the user to reconnect.

### Direct send (user pays gas)

```typescript
// Must ensure wallet is connected before .send()
await authClient.near.ensureConnected();
return authClient.near.getNearClient()
  .transaction(accountId)
  .functionCall(contractId, "method", args, {
    gas: Gas.Tgas(30),
    attachedDeposit: BigInt(0),
  })
  .send({ waitUntil: "FINAL" });
```

Wallet extensions (Meteor, HERE) may disconnect after the initial sign-in popup. Always call `ensureConnected()` before `.send()` — it opens a reconnection prompt if needed. `buildSignedDelegateAction` does this automatically, but direct `.send()` does not.

### Wallet state and profile management

```typescript
// Get current account (persists across wallet disconnects)
const accountId = authClient.near.getAccountId(); // string | null

// Check if signing operations are available
const canSign = authClient.near.isWalletConnected(); // boolean

// Prompt wallet reconnection if disconnected
const connected = await authClient.near.ensureConnected(); // Promise<boolean>

// Get full wallet state
const state = authClient.near.getState(); // { accountId, publicKey, networkId } | null

// Get profile
const profile = await authClient.near.getProfile();
const aliceProfile = await authClient.near.getProfile("alice.near");

// Disconnect wallet
await authClient.near.disconnect();

// Silently detect if user has a previously authorized wallet (login page auto-detection)
const detected = await authClient.near.detectNearAccount();
if (detected) {
  // Show "Continue as bob.near" prompt
  console.log("Wallet found:", detected.accountId, "on", detected.networkId);
}
```

`detectNearAccount()` silently probes `@hot-labs/near-connect`'s `getConnectedWallet()` across all supported networks — it reads localStorage for previously authorized wallet IDs and queries the wallet extension without showing any UI. Returns `null` if no wallet is found. Use it on login pages to offer a one-click "Continue with NEAR" option.

When the wallet disconnects externally (user signs out from wallet UI), `nearState` preserves `accountId` but clears `publicKey`. Use `isWalletConnected()` to check if signing operations are available, and `useNearAccountId(authClient)` (React) or `getAccountId()` for display purposes. `getAccountId()` returns the live connection when present, then falls back to the primary SIWN-linked account on the session, so it works for display even before NearConnect has been initialized.

### Sub-account creation

Create named sub-accounts under a parent account (e.g. `myapp.parent.near`). The relayer pays gas for the creation transaction.

```typescript
// 1. Check availability before creating
const { data: availability } = await authClient.near.checkSubAccountAvailability({
  subAccountName: "myapp",
});
if (!availability.available) {
  console.log("Not available:", availability.reason);
  // reason: "taken" | "invalid" | "too-long" | "not-configured"
  return;
}

// 2. Create sub-account with the user's public key for full access
const { data: result } = await authClient.near.createSubAccount({
  subAccountName: "myapp",
  publicKey: "ed25519:...",
});
console.log(result.accountId); // myapp.parent.near
```

The client does lightweight validation before calling the server: `checkSubAccountAvailability` returns `{ available: false, reason: "invalid" }` immediately for names failing the regex/length check, skipping the server round-trip.

The server must have `subAccount` configured (see siwn skill) and a named relayer account.

### Account linking and contract view calls

```typescript
// Link another NEAR account to current session
await authClient.near.link({
  onSuccess: () => console.log("Linked"),
  onError: (err) => console.error(err),
});

// Unlink
await authClient.near.unlink({ accountId: "alice.near" });

// List linked accounts
const { data } = await authClient.near.listAccounts();

// Server-side read-only contract call
const result = await authClient.near.view({
  contractId: "myapp.near",
  methodName: "get_value",
  args: { account_id: "alice.near" },
});
```

## Client Actions Reference

See [client-actions](references/client-actions.md) for the full `authClient.near.*` method table, `authClient.signIn.near`, and the `AuthCallbacks` interface (`onSuccess` / `onError`).

## Common Mistakes

### CRITICAL Creating multiple siwnClient instances

Wrong:

```typescript
// Factory that creates new client each call
function getAuthClient(config) {
  return createAuthClient({
    plugins: [siwnClient({ recipient: getAccount(config) })],
  });
}
// Each call = new nearState atom = wallet state lost
```

Correct:

```typescript
// Single module-level instance (simple apps)
export const authClient = createAuthClient({
  plugins: [siwnClient({ recipient: "myapp.near" })],
});

// OR: router context singleton (SSR apps)
export function createAuthClient() {
  return createBetterAuthClient({
    plugins: [siwnClient({ recipient: getAccount() })],
  });
}
// Create once in router setup, access via context
```

`siwnClient()` creates stateful singletons: a `nearState` atom, a `walletConnected` atom, a `NearConnector` with event listeners, and a `Near` instance. Multiple instances means wallet sign-in populates one atom while your app reads from another. Always create exactly one `siwnClient()` per app lifecycle.

Source: src/client.ts:64-72

### CRITICAL Recipient mismatch between server and client

Wrong:

```typescript
// Server
siwn({ recipient: "myapp.near" });

// Client
siwnClient({ recipient: "myapp.com" });
```

Correct:

```typescript
// Server
siwn({ recipient: "myapp.com" });

// Client
siwnClient({ recipient: "myapp.com" });
```

The client embeds the recipient in the signed message. The server verifies against its own recipient. A mismatch causes the verify endpoint to reject the signature with "Unauthorized: Invalid signature" — which is confusing because the signature is valid, just for a different recipient.

Source: src/client.ts:108, src/index.ts:225

See also: siwn/SKILL.md — server plugin recipient configuration

### HIGH Using getNearClient().send() without ensuring wallet connection

Wrong:

```typescript
authClient.near.getNearClient().transaction(accountId)
  .functionCall(contract, "method", args, opts)
  .send(); // fails if wallet disconnected after sign-in
```

Correct:

```typescript
await authClient.near.ensureConnected(); // reconnects wallet if needed
authClient.near.getNearClient().transaction(accountId)
  .functionCall(contract, "method", args, opts)
  .send();
```

Wallet extensions (Meteor, HERE) may disconnect after the initial sign-in popup. `ensureConnected()` opens a reconnection prompt if needed. `buildSignedDelegateAction` calls this automatically, but direct `.send()` does not.

Source: src/client.ts:249-253, src/client.ts:310-317

### HIGH Constructing transactions with wrong builder pattern

Wrong:

```typescript
// Wrong: trying to use .send() directly instead of delegate flow
const result = await near.transaction(accountId)
  .functionCall(receiverId, "method", args, { gas: Gas.Tgas(30) })
  .send({ waitUntil: "EXECUTED" });
```

Correct:

```typescript
// Correct: use buildSignedDelegateAction + relayTransaction
const payload = await authClient.near.buildSignedDelegateAction(
  "myapp.near",
  (builder, receiverId) => builder.functionCall(receiverId, "method", args, {
    gas: Gas.Tgas(30),
    attachedDeposit: BigInt(0),
  })
);
const result = await authClient.near.relayTransaction({ payload });
```

Delegate actions must be built through `buildSignedDelegateAction`, which uses near-kit's `TransactionBuilder.delegate()` method. Direct `.send()` broadcasts from the client account and requires the user to pay gas — defeating the gasless relay purpose.

Source: src/client.ts:240-260

See also: relay/SKILL.md — relay endpoint validation and whitelisting

### MEDIUM Using authClient.near.verify directly instead of signIn.near

Wrong:

```typescript
// Manually calling verify without proper wallet signing flow
await authClient.near.verify({
  signedMessage: someMessage,
  message: "Sign in to myapp.com",
  recipient: "myapp.com",
  nonce: someNonce,
  accountId: "alice.near",
});
```

Correct:

```typescript
// Use the single-step sign-in method that handles the full flow
await authClient.signIn.near({
  onSuccess: () => { /* signed in */ },
  onError: (error) => { console.error(error); },
});
```

`signIn.near()` handles wallet connection, NEP-413 message signing, nonce management, and server verification in a single call. Calling `verify` directly requires manually constructing all parameters and does not handle wallet connection.

Source: src/client.ts:402-437

### MEDIUM Not subscribing to wallet disconnect events

Wrong:

```typescript
// Read account ID once — never updates
const accountId = authClient.near.getAccountId();
```

Correct:

```typescript
// React: subscribe reactively (no extra deps)
import { useNearAccountId, useNearConnection } from "better-near-auth/react";
const accountId = useNearAccountId(authClient);
// or the combined shape: { accountId, publicKey, networkId, walletConnected }
const connection = useNearConnection(authClient);
// accountId preserves the live connection, falling back to the
// session-linked account; publicKey is null when the wallet is
// disconnected but the account stays visible

// Vanilla (no React): typed atom access
import { getNearAtoms } from "better-near-auth/client";
const { nearState, walletConnected } = getNearAtoms(authClient);
nearState.subscribe(() => console.log(nearState.get()));

// Vanilla: read the session-linked account (same fallback the hooks use) —
// session.user.nearAccount is set by an after-hook, so narrow it via the helper
import { readSessionNearAccountId } from "better-near-auth/client";
const linkedAccountId = readSessionNearAccountId(sessionAtomValue);

// Or check signing availability:
const canSign = authClient.near.isWalletConnected();
```

When the wallet disconnects externally (user signs out from wallet UI), `nearState` preserves `accountId` but clears `publicKey` and sets `walletConnected` to false. Use `isWalletConnected()` to check if signing operations are available, and `useNearAccountId(client)` / `getAccountId()` for display purposes (works even when disconnected).

Source: src/client.ts:65-66, src/client.ts:102-108

### MEDIUM Creating sub-accounts without checking availability first

Wrong:

```typescript
await authClient.near.createSubAccount({
  subAccountName: "myapp",
  publicKey: "ed25519:...",
});
// Server throws 409 "Account already exists" if taken
```

Correct:

```typescript
const { data } = await authClient.near.checkSubAccountAvailability({
  subAccountName: "myapp",
});
if (!data.available) {
  console.log("Sub-account not available:", data.reason);
  return;
}
await authClient.near.createSubAccount({
  subAccountName: "myapp",
  publicKey: "ed25519:...",
});
```

Always check availability first to avoid unnecessary server round-trips and 409 CONFLICT errors. The availability check is cheap (regex + length check client-side, then RPC account lookup server-side).

Source: src/client.ts:537-548, src/index.ts:1406-1412

## The tasks you will actually be given

**"Add NEAR wallet sign-in and show the connected account in the header."**
Create one `authClient` with `siwnClient({ recipient })` (in this repo that factory lives in `packages/everything-dev/src/ui/auth.ts`, re-exported by `ui/src/lib/auth.ts`), call `authClient.signIn.near({ onSuccess, onError })`, and render `useNearAccountId(authClient)` from `better-near-auth/react` — never `getAccountId()` during render (not reactive).

**"Let users write on-chain without paying gas."**
`const payload = await authClient.near.buildSignedDelegateAction(receiverId, builder)` → `await authClient.near.relayTransaction({ payload })` → poll `authClient.near.getRelayStatus(txHash)` until `status` is `"completed"` or `"failed"`.

**"Create a per-user sub-account after sign-in."**
`checkSubAccountAvailability({ subAccountName })` first — the client returns `{ available: false, reason: "invalid" }` locally for bad names — then `createSubAccount({ subAccountName, publicKey })` with the user's key.

**"The account ID disappears when the user disconnects the wallet."**
Read `useNearAccountId(authClient)` instead of `getState().accountId` — the getter falls back to the primary SIWN-linked session account (`session.user.nearAccount`) when NearConnect is disconnected or uninitialized. Use `isWalletConnected()` only to decide whether signing is possible.

## What comes back when it refuses

| What you see | Where it comes from | Action |
| --- | --- | --- |
| `Wallet not initialized for <net> — this operation requires a browser environment` | Signing op called during SSR (`ensureConnected`, `buildSignedDelegateAction`, `signWithWallet`) | Stop — gate the call behind a client-only component/effect |
| `Wallet sign-in was cancelled or failed` | User closed the wallet popup | Tell the user; retry on demand, not automatically |
| `NEAR network changed while signing in` / `while connecting wallet` | Active network switched mid-flow | Retry once once the network is stable |
| `No NEAR account found — please sign in with your NEAR wallet` | Signing op with no wallet or session account | Tell the user to sign in |
| `Wallet connection required — please approve the connection to sign` | Wallet disconnected; `ensureConnected` prompt declined | Tell the user to approve the reconnect prompt |
| `Unauthorized: Invalid signature` (401, from verify) | Client recipient ≠ server `siwn()` recipient | Stop — fix `siwnClient({ recipient })`; the signature is valid, just for the wrong recipient |
| `Unauthorized: Nonce already used (replay attack detected)` (401) | Nonce replayed | Retry once with a fresh nonce from the `/near/nonce` endpoint |
| `No NEAR account linked to session` (401, relay/sub-account) | No SIWN-linked primary account | Tell the user to sign in |
| Availability `reason`: `taken`, `too-long`, `not-configured` | Server lookup in src/index.ts | Stop — pick another name (`not-configured` means fix server config) |
| 409 `Account <id> already exists on <network>` | `createSubAccount` without availability check | Stop — check availability first |
