---
"everything-dev": patch
---

Publish only boot-valid configs; root Railway leg pins the smoked digest

- The publish train validates the canonicalized payload against `BosConfigSchema` before the registry write: a canonicalization/schema drift now fails preflight instead of failing the post-publish smoke and rolling back production. Root cause of the 2026-10-25 outage where every deploy since #584 published, failed the smoke (`app.host.development — expected string`), and rolled back while the pushed image leaked to Railway.
- `HostConfigSchema.development` is optional: published configs strip workspace-relative `local:` targets (#584), so production reads no longer require it. The dev-boot port resolver already defaulted to localhost for a missing value.
- The root Railway leg repoints the service source to `ref@sha256:<digest>` after a green smoke when a workspace-scoped `RAILWAY_API_TOKEN` is present, so the dashboard-connected source can no longer follow a floating tag that Railway may redeploy outside the train (the image job moves that tag before the smoke gate runs). Project-token-only roots keep the plain redeploy and print a drift notice.
