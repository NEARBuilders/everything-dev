---
"better-near-auth": patch
---

Accept NEAR wallet sign-ins whose NEP-413 signature omits the optional callback URL (e.g. Intear Wallet), which were rejected as "Invalid signature" since the callback URL started being verified.
