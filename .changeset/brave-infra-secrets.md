---
"everything-dev": patch
---

`bos dev` now generates `.env.example` and `docker-compose.yml` via the full runtime secret set (`writeGeneratedInfra`) instead of only auto-generated database/redis URLs and `CORS_ORIGIN`. This fixes regenerated files silently dropping host/API/auth/plugin secrets (e.g. `BETTER_AUTH_SECRET`, `CSP_STRICT`, GitHub/Google client secrets) that remain declared in `bos.config.json`.