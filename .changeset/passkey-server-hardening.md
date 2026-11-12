---
"better-near-auth": patch
---

#337 passkey/device-link server hardening: NEP-413 sandbox proofs now verify the WebAuthn `rpIdHash` and `clientDataJSON.origin` against a configured relying party (`passkeyWalletRelyingParty` — wired from the auth plugin's rpID/origin resolution, enforcement is opt-in for other consumers), the NEP-413 payload hash throws on a wrong nonce length instead of silently signing an empty challenge, both NEP-413 nonce guards are atomic via `reserveVerificationValue` (first-writer-wins; the find-then-insert race is gone), and `linkPasskeyWalletFromCredential` filters its existing-row lookup by network with the concurrent double-link double-check covered by the new `(accountId, network)` unique gate.
