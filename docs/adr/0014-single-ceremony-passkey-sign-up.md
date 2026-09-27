# ADR 0014: Passkey sign-up is one ceremony that signs in and links the Passkey Wallet

Date: 2026-09-25
Status: Accepted

Better Auth's passkey plugin treats registration and authentication as separate ceremonies: `verify-registration` stores the credential but creates no session, so a new user today sees up to four WebAuthn sheets (a dismissed sign-in, create, sign-in, and a fresh assertion to link the wallet). We deviate from the plugin: when a registration begins without a session (passkey-first sign-up), a server hook on successful `verify-registration` creates the session and links the Passkey Wallet derived from the credential public key just verified, so a new member sees exactly one biometric prompt. The wallet link needs no extra assertion because the account id is a pure function of the stored key and registration already proved possession of it.

## Consequences

- The hook must fire only for a user created by that same passkey-first registration (no prior session, user owns exactly this one credential), never for "add a passkey" while signed in — otherwise it becomes a session-minting path.
- Registration is restricted to discoverable credentials, required user verification, and ES256/EdDSA, since only those keys can derive a Passkey Wallet and sign in without a username.
- Because the plugin creates the user before the browser prompt, cancelled registrations leave users with no credential; those are swept, not prevented.
