---
"@everything-dev/auth-plugin": patch
---

The auth server's apiKey configurations (`user-keys`, `org-keys`) now allow key names up to 64 characters (Better Auth's default maximum is 32). The `bos login` device-link page mints keys named `bos login — <device> — <timestamp>`, which exceeded the 32-character default and failed key creation with `INVALID_NAME_LENGTH`; the api-key name inputs in the UI now cap at 64 to match the server limit. The apikey table column is unbounded `text`, so no migration.
