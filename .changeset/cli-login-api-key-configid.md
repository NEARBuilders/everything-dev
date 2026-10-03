---
"ui": patch
"@everything-dev/auth-plugin": patch
---

Direct `auth.apiKey.create` calls (the CLI device-link handoff page and the personal Settings → API Keys form) no longer pass a `configId`, but the auth server's apiKey plugin registers only named configurations (`user-keys`, `org-keys`) — with no default config, Better Auth's `resolveConfiguration` rejected the request with `NO_DEFAULT_API_KEY_CONFIGURATION_FOUND`. Both call sites now pass `configId: "user-keys"`, unblocking `bos login` and personal API key creation.
