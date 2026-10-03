---
"@everything-dev/auth-plugin": patch
---

The host's auth variables now include `baseUrl`, derived from bos.config.json (the host url in development, the domain in production). The host-driven Better Auth instance previously never received `baseUrl`, so `config.baseUrl` fell back to a hardcoded `http://localhost:3000` — making invite-email accept links, passkey RP-id derivation, and callback URLs wrong on any stack not running on port 3000 (e.g. the CI regression stack: host on :4100, invite links pointing at :3000).
