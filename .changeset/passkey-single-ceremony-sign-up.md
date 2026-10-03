---
"@everything-dev/auth-plugin": minor
"better-near-auth": minor
"everything-dev": minor
---

Single-ceremony passkey sign-up with a linked Passkey Wallet:

- A passkey registration begun without a session now ends signed in, with the Passkey Wallet derived from the new credential linked as the member's primary NEAR account — one biometric prompt. It applies only to a user created by that registration who owns exactly that credential; "add a passkey" while signed in never mints a session or changes the primary NEAR account. The verify-registration response carries `passkeyWallet` (`linked` or `unavailable`).
- Registration asks for a discoverable, user-verified ES256 or EdDSA credential; registrations and sign-ins without user verification, or with a key that cannot derive a Passkey Wallet, are refused (`PASSKEY_UNSUPPORTED_AUTHENTICATOR` / `PASSKEY_USER_VERIFICATION_REQUIRED`).
- The passkey plugin accepts every configured Gateway Origin of the runtime's network (`passkey.gatewayOrigins.{mainnet,testnet}`), with the rpID unchanged. The network comes from the runtime account.
- better-near-auth: Passkey Wallet linking is one operation (`linkPasskeyWalletFromCredential`) shared by `/near/link-passkey-wallet` and the sign-up hook. Linking uses the new `passkeyWalletNetwork` option instead of a hard-coded mainnet; a network with no passkey wallet factory skips linking and reports `PASSKEY_WALLET_UNAVAILABLE`. `getPasskeyWalletFactory` and `isPasskeyWalletAvailable` are exported.
- everything-dev: `signInWithPasskey` no longer falls through to registration; use the new `createAccountWithPasskey` to create an account. `isPasskeyAutofillAvailable` and `isUnsupportedAuthenticatorError` support browser autofill and unsupported-authenticator messaging.
- Users created by abandoned passkey registrations (older than an hour, with no passkey, NEAR account, account, session or phone number) are swept every 15 minutes, with their personal organization.
- The login page offers passkey autofill and points to Sign in with phone or a NEAR wallet when no passkey is found; the onboarding page offers "Create account" and "I already have an account", notes when no passkey wallet exists on the network, and offers an optional display name after joining.
