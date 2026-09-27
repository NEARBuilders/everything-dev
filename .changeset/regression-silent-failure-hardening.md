---
"everything-dev": minor
---

Regression hardening for silent stack failure: plugin database pools now run with connection-level `lock_timeout` (10s, `DB_LOCK_TIMEOUT_MS`) and `idle_in_transaction_session_timeout` (30s, `DB_IDLE_TX_TIMEOUT_MS`) so a wedged lock wait or leaked transaction fails fast and names itself instead of hanging the pool — `ALTER DATABASE` never reaches connections that already exist. The auth handler gets a server-side deadline (`AUTH_TIMEOUT_MS`, default 30s) answering 504 instead of hanging the caller when Better Auth wedges, and the dev orchestrator now logs child exits that happen after a service reported ready — an OOM-killed or crashed service no longer disappears into total silence.
