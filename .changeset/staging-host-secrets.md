---
"everything-dev": minor
---

Add `bos deploy` command, host secrets, and staging environment support

- **New `bos deploy` command**: Publishes config to FastKV and triggers Railway redeploy in one step. Reads service name from `ci.railway.service` in `bos.config.json`. Uses `RAILWAY_TOKEN` (environment-scoped) instead of deployment IDs.

- **New `ci` config section**: `bos.config.json` now accepts `ci.railway.service` for Railway integration. Child projects inherit this via extends.

- **Staging environment support**: `BOS_ENV=staging` or `--env staging` enables staging mode. `staging.domain` overrides `domain`, FastKV publishes under the staging gateway key, and runtime sets `env = "staging"`.

- **Host secrets**: Added `secrets` array to `app.host` for tenant-related environment variables (`TENANT_WHITELIST`, `ALLOW_OVERRIDE`, `ALLOW_UNTRUSTED_SSR`, `CSP_STRICT`). Validated during `bos start` and surfaced in `bos infra`.

- **Workflow simplification**: Replaced `publish.yml` with `deploy.yml`. `release.yml` now only handles npm package releases. `staging.yml` uses `bos deploy --env staging`. All workflows use `railway redeploy` via CLI instead of raw GraphQL API calls.

- **Removed**: `RAILWAY_PRODUCTION_SERVICE_ID` and `RAILWAY_STAGING_SERVICE_ID` variables — replaced by environment-scoped `RAILWAY_TOKEN` secrets.