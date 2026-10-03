---
"everything-dev": major
"api": minor
---

Consolidated `bos deploy` — one command runs the full train, and `bos publish` is config-only (ADR 0020/0021).

**`everything-dev` (breaking):**
- `bos deploy` is the full train: preflight (config → auth guards → signing → storage/CDN credentials → registry reachability, all before any build) → staleness-checked build train → bundle upload to the R2-backed storage → FastKV publish with read-back confirmation → `runtime` image build pushed to GHCR by short-SHA and `latest` tags (image name: `ci.image` in `bos.config.json`, `BOS_IMAGE` env, or derived from `repository`) → pull-only Railway deploy pinned to the pushed digest via a generated thin `FROM <image>@sha256:<digest>` Dockerfile in `.bos/deploy/` (`RAILWAY_DOCKERFILE_PATH`). Missing legs (no `ci.image`, no docker, no `RAILWAY_TOKEN`) degrade gracefully with a notice — child repos get build+upload+publish only.
- `bos publish` no longer builds or uploads — it re-publishes the current `bos.config.json` and confirms the read-back. The `--deploy` and `--packages` options are removed (`bos build --deploy` is gone too); use `bos deploy`.
- `DeployResultSchema` replaces the required `redeployed` boolean with optional `image`/`service`; the deploy command's `railway redeploy` branch (which re-deployed the *old* image) is deleted.
- Storage-mode disclosure: the bundle upload response carries `storage: "s3" | "memory"`; `bos deploy` hard-fails when the receiving instance only has in-memory storage (bytes would be lost on restart).
- Scaffolded children get `"deploy": "bos deploy"` and single-command deploy/staging workflow templates.

**`api`:** `POST /api/storage/bundles` responses include `storage: "s3" | "memory"` reflecting the resolved bundle-storage backend.
