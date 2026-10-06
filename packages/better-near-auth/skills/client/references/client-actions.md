# Client Actions Reference — authClient.near / authClient.signIn

Full method tables for the `siwnClient()` Better Auth client plugin. See the `client` SKILL.md for setup, patterns, and common mistakes.

## authClient.near

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `nonce(params)` | `Promise<Response<NonceResponse>>` | Request nonce from server |
| `verify(params)` | `Promise<Response<VerifyResponse>>` | Verify NEP-413 signature |
| `getProfile(accountId?)` | `Promise<Response<Profile>>` | Get NEAR profile |
| `view(params)` | `Promise<Response<ViewResponse>>` | Server-side contract view call |
| `getAccountId()` | `string \| null` | The user's NEAR account ID. Prefers the live NearConnect connection; falls back to the primary SIWN-linked account on the session (`session.user.nearAccount`). Persists across disconnects. |
| `getState()` | `{ accountId, publicKey, networkId } \| null` | Wallet state |
| `isWalletConnected()` | `boolean` | Whether wallet is actively connected |
| `detectNearAccount()` | `Promise<{ accountId, publicKey, networkId } \| null>` | Silently probe for a previously authorized wallet without prompting |
| `ensureConnected()` | `Promise<boolean>` | Reconnect wallet if disconnected |
| `disconnect()` | `Promise<void>` | Disconnect wallet |
| `link(callbacks?)` | `Promise<void>` | Link NEAR account to session |
| `unlink(params)` | `Promise<Response>` | Unlink NEAR account |
| `listAccounts()` | `Promise<Response>` | List linked NEAR accounts |
| `setPrimaryAccount(params)` | `Promise<Response<SetPrimaryAccountResponse>>` | Set primary linked NEAR account |
| `createSubAccount(params)` | `Promise<Response<CreateSubAccountResponse>>` | Create a sub-account |
| `checkSubAccountAvailability(params)` | `Promise<Response<CheckSubAccountAvailabilityResponse>>` | Check if a sub-account name is available |
| `buildSignedDelegateAction(receiverId, buildActions)` | `Promise<string>` | Build + sign delegate action, returns base64 payload |
| `relayTransaction({ payload })` | `Promise<Response<RelayResponse>>` | Submit delegate action to relayer |
| `getRelayStatus(txHash)` | `Promise<Response<RelayStatusResponse>>` | Check relayed tx status |
| `getRelayerInfo()` | `Promise<Response<RelayerInfo>>` | Get relayer info and balance |
| `relayHistory()` | `Promise<Response<RelayHistoryResponse>>` | List relayed transactions |
| `setNetwork(network)` | `void` | Switch active network (mainnet/testnet) |
| `getNetwork()` | `"mainnet" \| "testnet"` | Get currently active network |
| `getSupportedNetworks()` | `("mainnet" \| "testnet")[]` | List supported networks |
| `getRecipient(network?)` | `string` | Get configured recipient for a network |
| `getNearClient()` | `Near` | Access near-kit Near instance (throws on server). Returns the `Near` client for direct transactions. |

## authClient.signIn

| Method | Description |
| ------ | ----------- |
| `near(callbacks?)` | Connect wallet, sign message, verify — single popup |

## Callback Interface

```typescript
interface AuthCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error & { status?: number; code?: string }) => void;
}
```
