# ADR 0013: Passkey ceremonies happen only on the gateway origin

Date: 2026-09-25
Status: Accepted

A passkey is bound forever to the relying-party ID it was created under; changing the rpID later orphans every passkey — and every Passkey Wallet derived from one — already issued. Tenants are served on subdomains and custom domains, where rpID `citynode.app` is either rejected by the browser (custom domains) or fails server origin verification (subdomains other than the host `baseUrl`). We keep rpID `citynode.app` and run every passkey ceremony (create, sign-in, onboarding) on the gateway origin: Onboarding Code QR URLs always encode the gateway origin, whatever tenant domain the organizer generated them from, and tenant custom domains offer NEAR wallet sign-in or Device Link instead of passkeys.

## Considered Options

- **Per-tenant rpID** — each custom domain gets its own passkeys and wallets; a member of two nodes would hold two identities. Rejected.
- **WebAuthn Related Origin Requests** (`/.well-known/webauthn` on the gateway listing tenant origins, plus a multi-origin `expectedOrigin`) — the likely future path for custom domains, but browser support is uneven and the origin list grows with tenants; deferred, and compatible with this decision because the rpID does not change.

## Consequences

- The passkey plugin's `origin` becomes a list (it accepts `string[]`) covering the gateway origins per network, so `*.citynode.app` gateway zones verify.
- Adopting related origins later is additive; switching rpID is not.
