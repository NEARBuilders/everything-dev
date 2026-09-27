---
"ui": patch
"@everything-dev/auth-plugin": patch
---

Make the organization's linked DAO the team wallet with the Trezu connection as the linking path: the prototype resolves the team from the org-linked DAO, then the application payload, then an account captured through a "connect team DAO" button that reuses the already-verified Trezu connection (no reconnect, no link prompt — linking happens silently and best-effort). Unset team and endowment inputs are replaced in place by connect buttons so the card stops shifting, the node name defaults to the title-cased organization name, and blockers read "connect your team DAO with Trezu". The auth plugin's `requireAuth` now prefers the host-injected session user and only falls back to resolving the session internally, fixing spurious "Authentication required" errors on `getDao`/`linkDao` and the rest of the `apiClient.auth.*` surface.
