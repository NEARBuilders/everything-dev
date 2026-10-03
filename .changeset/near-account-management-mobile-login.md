---
"@everything-dev/auth-plugin": minor
"better-near-auth": minor
---

NEAR account management on the sign-in methods page, and a phone-free mobile login:

- The "Sign in with your phone" option is now desktop-only — on mobile viewports the login page shows passkey and NEAR wallet only, and the "no passkey found" hint drops the phone suggestion.
- The NEAR wallet section in Settings → Sign-in methods manages every linked NEAR account, not just the active one: make an account primary, unlink an account (with confirmation), or link another named account at any time.
- When the user has a passkey and the network supports a Passkey Wallet, an account with no linked NEAR account can create one derived from their passkey (`auth.near.linkPasskeyWallet`) — no seed phrase. Linking now uses the dedicated `near.link` action instead of a full sign-in ceremony.
- better-near-auth: exports `isDeterministicAccountId` so consumers can recognize Passkey Wallet (`0s…`) accounts without duplicating the NEP-616 format.

