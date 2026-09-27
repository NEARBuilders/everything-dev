---
"@everything-dev/auth-plugin": minor
"better-near-auth": minor
"everything-dev": minor
---

Add mobile-to-desktop sign-in and passkey-based NEAR wallets:

- RFC 8628 device authorization flow (official Better Auth `deviceAuthorization` plugin, first-party session path with a configurable `deviceLink.clientId` variable — default `everything-dev`, citynode.app overrides with `citynode-web`), a `/device-link/claim` endpoint that exchanges the polled session token for an httpOnly cookie, and auth-plugin UI pages for QR pairing (`/login` "sign in with phone"), `/device` code verification, and `/device/approve` approval.
- Passkey sign-in through the official `@better-auth/passkey` plugin: session-less first-time registration (generated-email user via `registration.resolveUser`) with a sign-in orchestration that creates the credential on first use, plus "sign in with passkey" buttons on `/login` and `/onboard`.
- NEP-616 deterministic (`0s…`) passkey wallet support: `/near/link-passkey-wallet` verifies a NEP-413 assertion against the user's stored passkey credentials server-side (challenge binding, user-verification enforced, nonce replay protection) and links the derived account — no public key crosses the wire, no on-chain lookup needed. `/near/verify` also accepts passkey wallet-contract accounts.
- `siwnClient` gains a `wallets` option for registering near-connect sandbox wallet executors.
- Organization onboarding stations: capped, expiring onboarding codes (named after an event) with QR pairing, live redemption status, and event-team membership. Station codes always grant plain membership — revocation now rejects prior redeemers too, and the plaintext code is displayed once at creation.
