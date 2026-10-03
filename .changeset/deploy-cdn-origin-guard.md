---
"everything-dev": minor
---

Deploy origin safety: `bos.config.json` gains an authored `cdn.origin` (inherited via extends) that `bos deploy` requires before uploading — the dev-resolved `host.url` is never promoted to a published bundle URL again, a `bos login` session pinned to a local site is a hard error, and the upload origin is probed (`/.well-known/mcp.json`) in preflight so a wrong-port target fails before the build train. Config-only publishes (`bos publish`) require no origins.
