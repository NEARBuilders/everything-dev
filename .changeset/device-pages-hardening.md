---
"@everything-dev/auth-plugin": patch
---

Harden the device verify/approve pages: a failed claim no longer re-claims the same code in a loop and network failures surface a "check your connection" state instead of an unhandled rejection; a rejected deny keeps the request on screen with an error instead of toasting success; an approve rejection resets the pending state and shows the error; the signed-out approve handoff forwards the full pairing search (`pubKey`, `contract`, `account`, `network`, `source`, `custody`) instead of dropping everything but the code; malformed codes are validated client-side before navigating; and both pages follow `app_locale` via the login i18n catalogs.
