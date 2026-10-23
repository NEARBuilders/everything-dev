---
"everything-dev": patch
"@everything-dev/auth-plugin": patch
---

Remove the passkey autofill input from the login page — passkey sign-in is now the explicit button only. The fake `autocomplete="username webauthn"` field (and the conditional-mediation request armed on page load) did nothing for visitors without a saved passkey and kept the browser's passkey sheet armed across view switches and navigation. Adds `cancelPasskeyCeremony()` and `isPasskeyCeremonyAborted()` to `everything-dev/ui/auth` so pending ceremonies are aborted when choosing another sign-in method, and ceremony aborts no longer surface as errors.
