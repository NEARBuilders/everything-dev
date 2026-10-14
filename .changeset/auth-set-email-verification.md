---
"@everything-dev/auth-plugin": minor
---

set-email no longer grants `emailVerified: true` without proving ownership of the claimed email: when an email provider is configured (`RESEND_API_KEY` + `email.from`), a claimed email lands unverified, a verification email is sent through the standard better-auth token flow, and `emailVerified` flips only when the claimant clicks the link. With no email provider configured (dev/synthetic flows) the instant claim remains. Also adopted from better-auth: `haveIBeenPwned` (rejects compromised passwords on signup/password change; k-anonymity API, disabled in tests) and `lastLoginMethod` (tracks the last auth method per user). Email delivery now fails loud in production instead of silently falling back to a console preview, and token-bearing email bodies are never logged in production.
