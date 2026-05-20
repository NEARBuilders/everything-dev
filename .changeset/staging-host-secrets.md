---
"everything-dev": minor
---

Add host secrets to config and staging environment support

- Added `secrets` array to `app.host` in `bos.config.json` for tenant-related environment variables (`TENANT_WHITELIST`, `ALLOW_OVERRIDE`, `ALLOW_UNTRUSTED_SSR`, `CSP_STRICT`). These are now surfaced in `bos infra` generated `.env.example` and validated during `bos start`.

- Added `BOS_ENV` environment variable support: setting `BOS_ENV=staging` in a Docker/Railway deployment enables staging mode without needing the `--env` CLI flag. This follows the same pattern as `BOS_ACCOUNT` and `BOS_GATEWAY`.

- Staging mode now overrides `runtimeConfig.domain` with `staging.domain` and sets `runtimeConfig.env = "staging"`, so the host correctly uses the staging gateway for tenant subdomain resolution and CORS origins.

- Fixed secret validation in `bos start` to include `host.secrets` (previously only validated `auth`, `api`, and `plugin` secrets).

- Updated `.env.example` and `host/.env.example` with the new host secrets.