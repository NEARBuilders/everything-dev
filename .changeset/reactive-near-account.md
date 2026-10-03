---
"ui": patch
---

Fix the "Buy with Ping" button (and wallet badge) staying disabled after signing in with a NEAR wallet. The SIWN near account is now read reactively via a new `useNearAccount` hook that subscribes to the auth client's `nearState` atom instead of reading `getAccountId()` once at render, so pages re-render when the wallet/session restore completes after mount.
