---
"@everything-dev/auth-plugin": minor
---

Capture a real email after passkey or NEAR sign-in, and stop showing fabricated addresses:

- Passkey sign-up creates its placeholder user with `emailVerified: false` (it was `true`); nobody verified a `passkey-<hex>@…` address, and the flip keeps NEAR sign-ins from firing "verify your email" at an unreachable mailbox.
- The verification-email configuration is removed: no email is sent on sign-up, sign-in, or when an email changes. Password reset still sends. Email+password sign-up has no UI and was the only flow that used it.
- New `/set-email` endpoint (session required) saves a real email directly — trimmed, lower-cased, rejected when the address is already registered. It refuses accounts whose email is already verified and not synthetic, marks a saved address `emailVerified: true`, and refreshes the session cookie. It works for legacy passkey users created before the `emailVerified` flip, with no migration.
- Every surface that displayed the user's email now hides the fabricated shapes (`passkey-…@`, `temp-…@`, `…@near.email`): dashboard identity card, header identity, admin context row, organization member cards, and the settings pages. Sign-in methods and the dashboard's next steps offer an "Add email" affordance instead; a one-time toast with the same action follows a passkey sign-up onto the dashboard. The security tab no longer offers password change to accounts that have no password.
