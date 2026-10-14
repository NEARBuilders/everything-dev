---
"@everything-dev/auth-plugin": minor
---

Verification-email gating and email management (better-auth 1.7.7)

- **verify-on-claim**: when `RESEND_API_KEY` + `email.from` are configured, a claimed email lands `emailVerified: false`; a verification email is sent through better-auth's standard token flow (`emailVerification.sendVerificationEmail` wired into `plugins/auth/src/auth-instance.ts`), and `emailVerified` flips only when the claimant clicks the link. Without a provider configured (dev/synthetic flows) the instant claim is kept unchanged.

- **haveIBeenPwned**: the plugin rejects compromised passwords on signup/password change (k-anonymity API; `enabled: NODE_ENV !== "test"` so tests never touch the network).

- **lastLoginMethod**: per-user last authentication method is tracked.

- **set-email**: a session-required endpoint (`POST /v1/auth/set-email`) saves a real email directly — trimmed, lower-cased, rejected when the address is already registered. It refuses accounts whose email is already verified and not synthetic, marks a saved address `emailVerified: false` (the flip only happens on the verification email click), and refreshes the session cookie.

- The dashboard `AddEmailDialog` now surfaces `verificationRequired` instead of always toasting "Email saved": with a provider configured the toast reads "Verification email sent — open the link we emailed you to finish."; without a provider the claim is instant.

- The security tab offers password change to all accounts (not gated by email-verified status).

- Every surface that displayed the user's email now shows the real email address (no more fabricated placeholder addresses such as `passkey-…@`, `temp-…@`, or `…@near.email`). The identity card, header identity, admin context row, organization member cards, and settings pages all render the actual user email. Sign-in methods and the dashboard's next steps offer an "Add email" affordance instead; a one-time toast with the same action follows a passkey sign-up onto the dashboard.

- Password reset still sends email.

---