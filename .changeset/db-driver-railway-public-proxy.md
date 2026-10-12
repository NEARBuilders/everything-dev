---
"everything-dev": patch
---

DB driver treats Railway's public proxy (`*.rlwy.net`) like its internal counterpart for TLS: the Postgres behind it presents a self-signed certificate chain no client CA bundle can verify, so bare URLs now default to encrypted-unverified TLS instead of failing at plugin boot with `self-signed certificate in certificate chain`. Explicit `verify-ca`/`verify-full` and `DB_SSL_REJECT_UNAUTHORIZED` still force verification, and `bos start`/`bos dev` now warn at boot when a `*_DATABASE_URL` points at the public proxy, suggesting the private `*.railway.internal` URL.
