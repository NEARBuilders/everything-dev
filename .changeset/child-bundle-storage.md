---
"api": minor
"everything-dev": minor
---

Child bundle storage (ADR 0020): `POST /api/storage/bundles` uploads workspace dists to the platform storage (session or API-key auth, account-pinned, path allowlist, traversal rejection, 64 MB ceiling, server-side SRI) backed by an S3-compatible client (R2 in production, MinIO emulator in dev via `docker compose up storage`, in-memory fallback). `bos publish` gains the CDN deploy path: with the CDN origin resolved (env or the base's inherited bundle URLs), dists upload in batched requests and every bundle URL (root's own included) points at the CDN origin with integrity fields; the credential rides the `bos login` session or `BOS_STORAGE_API_KEY`.
---
