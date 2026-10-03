---
"everything-dev": minor
---

DB driver honors libpq `sslmode` from the connection string — `require`/`prefer`/`allow` encrypt without certificate verification (managed providers hand out unverifiable certs), `verify-ca`/`verify-full` verify, bare non-local URLs keep verification on, and `DB_SSL_REJECT_UNAUTHORIZED` still overrides. Fixes production deploys that began failing the moment TLS verification was flipped on by default.
