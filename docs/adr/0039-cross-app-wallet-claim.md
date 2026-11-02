# ADR 0039: Cross-app wallet claim for passkey wallets

Date: 2026-11-02
Status: Accepted (implementation tracked in `.scratch/wallet-claim/`)

Depends on: the passkey wallet model in `packages/better-near-auth` (NEP-616 deterministic accounts, NEP-413-over-WebAuthn verification), the SIWN plugin contract (`recipient`/nonce/single-use reservation), and the device-link claim-token lifecycle (`plugins/auth/src/device-link.ts`).

## Context

Every child runtime runs the same auth plugin code against its own auth database. Passkey wallets are created by deriving a deterministic NEP-616 account (`0s…`) from a WebAuthn credential's public key via the trezu.near factory contracts (`packages/better-near-auth/src/passkey.ts:32-39`), and every signature is a WebAuthn assertion over a NEP-413 payload, verified with `verifyPasskeyNep413Signature` (`passkey.ts:317`), which enforces the RP ID hash and origin from the verifying app's own config (`plugins/auth/src/auth-instance.ts:107-124`).

WebAuthn credentials are RP-ID-bound **at creation, permanently**. A passkey created on `citynode.app` cannot produce an assertion the browser will offer on `nearbuilders.org`, and nearbuilders.org's verifier rejects `citynode.app` RP/origin proofs by construction. The on-chain account is portable; the credential ceremony is not. So "I created a passkey wallet on citynode.app and want to use it on nearbuilders.org" has no path today, in either direction of session state (signed-in users can't link the wallet; signed-out users can't sign in with it).

There is no official standard for cross-RP passkey assertions — WebAuthn is deliberately origin-bound. The adjacent standards are: **NEP-413** (the proof format, already used — recipient + nonce give replay protection and third-app uselessness), **WebAuthn origin binding** (respected, not fought: the ceremony stays on the credential's home origin), **RFC 8628** (claim-token lifecycle — already vendored as the device-link pattern), and **OAuth** (initiate → authorization surface → assertion flow shape). The design adopts those vocabularies and mechanisms rather than inventing new ones.

Alternatives considered and rejected:

- **GitHub (or any OAuth) linking** — proves "same human" per database but carries no wallet ownership; the `0s…` account would still not be linked. Usable as UX glue only.
- **Seed-phrase export** — the wallet has no seed; authority is the WebAuthn key verified by the wallet contract. A contract-level "add a classic full-access key" escape hatch (if the trezu factory supports it) reintroduces seed custody. Kept as a possible recovery feature, not the mechanism.
- **Shared platform wallet origin** (one rpID, e.g. `wallet.everything.dev`, hosting ceremonies for all children via iframe/popup) — viable for **new** wallets but cannot re-home existing credentials (RP ID is fixed at creation), so the claim flow is required regardless. Deferred (ticket 06).

## Decision

1. **One generic primitive, used symmetrically: the cross-app wallet claim.** The wallet's **host** app (where the credential's RP ID matches) hosts the signing ceremony; the **claiming** app verifies the resulting proof with explicit partner trust and links the wallet to its local user. Both directions use the same flow — a `0s…` wallet created on nearbuilders.org claims into citynode.app exactly as the reverse. Naming: endpoints `/near/claim/initiate` + `/near/claim/verify` (claiming app) and `/near/claim/host` (host app), client action `authClient.near.claimPasskeyWallet()`, config `passkey.walletHosts`, page route `/wallet/claim`, and the persisted row is a **claim token** (following the `deviceLinkClaim` precedent). The verb is `claim`, not `link`: `link` is already taken by same-app linking (`link-passkey-wallet` = derive from *your own* passkey; `claim` = prove control of one *created elsewhere*), and the two have different trust semantics that must stay distinguishable.

2. **Claiming-app trust is a configured allowlist, enforced from the stored claim.** `passkey.walletHosts: [{ appId, rpID, origins, claimUrl }]` names the wallet hosts whose ceremonies the app accepts. The claim's `initiate` response returns the host's claim-page URL; the host RP ID and origins used at verification come **from the stored claim record, never from the request body** — a client cannot name an arbitrary RP and get it trusted. The partner-RP check applies **only** to the claim endpoints; normal sign-in keeps enforcing the app's own RP ID (never weakened).

3. **Three server endpoints** (all in `better-near-auth`, exposed through the auth plugin like the existing `/near/*` surface):
   - `POST /near/claim/initiate` (claiming app) — mints a single-use, short-TTL claim token (hashed at rest, `consumedAt` semantics per `device-link.ts`) bound to `{ recipient (the app's SIWN recipient), message (names the claiming app), nonce, host rpID/origins resolved from `walletHosts`, mode: "link" | "signin" }`. `mode: "link"` requires a session (the claim will attach to it); `mode: "signin"` does not (wallet-first sign-in).
   - `POST /near/claim/host` (host app) — receives `{ credentialId, token context }`, looks up the passkey row by credential ID server-side (**no host session required** — resident-key credentials are origin-scoped, not session-scoped), re-verifies the assertion itself with its **own** RP ID as defense in depth, derives `{ accountId, publicKey, proof }`, forwards the proof to the claiming app's `/near/claim/verify` **server-to-server** (no browser CORS on the hot path), and returns the claiming app's return URL to the page.
   - `POST /near/claim/verify` (claiming app) — validates the token (unconsumed, unexpired), reserves the nonce single-use via the existing `siwn-nonce:` mechanism, checks `derivePasskeyAccountId(publicKey) === accountId`, calls `verifyPasskeyNep413Signature` with the **stored host's** `{ rpID, origins }`, then: `mode: "link"` links `{ accountId, publicKey }` to the initiating session's user; `mode: "signin"` creates a user (synthetic-email pattern from `passkey-sign-up.ts`) and mints a session. The `nearAccount` unique constraint keeps per-DB integrity ("already linked to another user").

4. **One shared claim page ships in the authored UI surface** (`/wallet/claim`, public route): shows which app is asking and which wallet is involved (the anti-phishing surface — the rpIdHash in the assertion cryptographically proves the ceremony ran on the host origin), runs `navigator.credentials.get` with user verification, and hands the result to the host endpoint. Because every child receives the same scaffold, every app in the ecosystem is both a potential host and a potential claiming app with zero per-app work.

5. **Phasing.** Phase 1 (tickets 01–04): endpoints, client action, claim page, plus the missing easy-direction affordance — a named NEAR wallet (Meteor/HERE/…) already links across apps today via `authClient.near.link` + `/near/link-account`; only UI is missing. Phase 2 (ticket 05): QR transport (same endpoints, RFC 8628-shaped device flow) and a root-published ecosystem directory of wallet hosts inherited through `extends` (via the registry plugin), replacing bilateral static config. Phase 3 (ticket 06): shared platform wallet origin as the **default for new wallets**, with per-app override.

## Consequences

- "Treated as the same" means: each app links the same `accountId` to its local user; the `0s…` account is the portable cross-app identity. There is no global user graph — cross-app "same human" correlation would be a registry-level feature and is explicitly out of scope.
- The trust surface grows by the `walletHosts` allowlist. Misconfiguration risk is bounded: a bad host entry can only cause a wallet claim (signature still required), never a session forgery for a non-holder.
- The session-confusion case (attacker session on the claiming app + victim approving a prompt) is bounded the same way OAuth account linking is: the claim token was minted by a session, the message names the claiming app, and user verification requires active biometric consent. `mode: "link"` may bind the token to the initiating session for extra strength.
- Server-to-server proof forwarding makes the host app a brief custodian of proof data; proofs are single-use and bound to nonce + recipient, so interception yields nothing replayable.
- Existing passkey wallets never migrate RP IDs, so the claim flow remains load-bearing even after ticket 06 ships; the two compose (platform-origin wallets skip the redirect for platform-claiming apps but still claim into foreign-RP apps).
- All endpoints live in `better-near-auth` and flow to every child through the same package — no per-app auth code.
