---
"host": patch
---

Auth origin diagnostics and CORS wildcard support.

- **False-positive origin warning fixed**: the boot warning "CORS_ORIGIN does not include the host origin" no longer fires when the host origin is already trusted via the Better Auth `baseUrl` (its trusted set always includes the baseURL) or via a wildcard `CORS_ORIGIN` entry. The check now matches origins with Better Auth's pattern semantics (`https://*.example.com` matches subdomains, not the apex), and the fix hint is context-aware — dev boots suggest `bos dev` regeneration, production boots suggest updating the deployment env.
- **CORS middleware wildcard-aware**: the Hono CORS allow-list in the host now matches `CORS_ORIGIN` entries as origin patterns instead of literal strings, so wildcard entries actually echo subdomain origins (previously they only passed through the blanket `https://` fallback).
- New `hostOriginCovered` / `originMatches` utilities, unit-tested against glob semantics (subdomain match, apex non-match, fail-closed on unusable input).
