# upload.everything.dev

The write/control surface for artifact uploads (ADR 0027, phase 0). It receives
bundle uploads from the deploy train (`bos deploy`, `bos plugin publish`),
stores them in the platform's R2-backed storage, and serves an inspection API
over the same namespace. Serving to browsers is not this app's job — bytes are
read back through `cdn.everything.dev` (the R2 bucket's custom domain, ADR
0020).

Absorbed from `plugins/artifact-control` (which was itself extracted from
`api/` + `host/`). It is a standalone every-plugin service, not a composed
plugin: it is not registered in `bos.app.ts` and deploys as its own Railway
service.

## Surface

| Route | Method | Permission | What it does |
|---|---|---|---|
| `/api/storage/bundles` | POST | `bundles:write` | Stores base64-encoded dist files for one workspace namespace, SRI-hashing each server-side. Files whose SRI matches the stored object's metadata are skipped as confirmed no-ops (`unchanged`). |
| `/api/storage/bundles` | GET | `bundles:read` | Lists objects under an account/gateway, optionally narrowed to one workspace (flat listing, capped + `truncated`). |
| `/api/storage/versions` | GET | `bundles:read` | Enumerates a workspace's immutable version manifests (`versions/<id>.json`, ADR 0020) with their deploy coordinates, newest first. |
| `/api/storage/integrity` | GET | `bundles:read` | Returns a version's full manifest and re-verifies the entry object's bytes against `entryIntegrity`. |

All routes are namespace-scoped: the API key's `account`/`gateway` metadata
must match the request's namespace. Permissioned keys are minted server-side
only (better-auth rejects client-set permissions): `bos login --key` mints a
scoped deploy key (`bundles:write` + `account`/`gateway` metadata) through the
auth plugin's `createDeployKey` route.
The bootstrap key (`BOS_STORAGE_BOOTSTRAP_API_KEY` + `_ACCOUNT`/`_GATEWAY`)
exists for first deploys and break-glass access; it is scope-pinned, not
permission-checked.

## Environment

Service-side (this app):

- `BOS_STORAGE_ENDPOINT`, `BOS_STORAGE_BUCKET`, `BOS_STORAGE_ACCESS_KEY_ID`,
  `BOS_STORAGE_SECRET_ACCESS_KEY`, `BOS_STORAGE_REGION` — required in
  production (the service refuses to boot without them; dev/test falls back to
  an in-memory backend).
- `BOS_STORAGE_AUTH_ORIGIN` — the auth service that verifies API keys
  (`<origin>/api/rpc/auth/verifyApiKey`); required in production unless the
  bootstrap key is set.
- `BOS_MAX_BUNDLE_UPLOAD_BYTES` (default 64 MiB per request),
  `BOS_STORAGE_UPLOAD_TIMEOUT_MS`, `PORT`.

CLI-side (the deploy train; see `.github/workflows/deploy.yml`):

- `BOS_STORAGE_ORIGIN` — this service's origin (`https://upload.everything.dev`
  in production). There is no gateway fallback: since ADR 0027 the gateway no
  longer serves uploads, and a deploy with uploads planned but no origin is a
  hard error.
- `BOS_STORAGE_API_KEY` — an API key with `bundles:write`, scoped to the
  deploying account/gateway.

## Deploy

### Deploy checklist

- `BOS_STORAGE_AUTH_ORIGIN` must be set on the service (the auth service
  origin) — without it every API-key upload 500s with
  `CONNECTION_ERROR` before verification is even reached, while the service
  itself boots fine on the bootstrap key. The service warns loudly at startup
  (production + bootstrap key + no auth origin), but treat the variable as part
  of the deploy checklist: a redeploy that drops it re-breaks every consumer's
  CI silently.
- `BOS_STORAGE_*` (endpoint/bucket/keys) — required or the service refuses to
  boot in production.

The `Dockerfile` builds a thin Node image running the standalone direct host
(`server.ts`, port default 3014, `/health` probe). The build context is the
**repo root** — a frozen pnpm install needs every lockfile importer on disk,
which is also why `--path-as-root apps/upload` must never be used (it shrinks
the archive to the app dir and the install fails).

Railway (service `upload`):

- Root Directory = `/` (repo root), Builder = Dockerfile
- Service variable `RAILWAY_DOCKERFILE_PATH=apps/upload/Dockerfile` (explicit
  path beats auto-detection of the repo-root Dockerfile)
- Watch paths: `apps/upload/**`, `packages/**`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`

Deploy: `bunx @railway/cli up --service upload` from the repo root (the bare
`railway` package is an unrelated IaC shim — the CLI is `@railway/cli`).

The container runs from source under the `development` resolution condition
(`node --import tsx --conditions=development`) so `every-plugin` resolves from
`src` — no bundle build step is needed for the standalone host.

## Storage layout (ADR 0020)

```
bundles/<account>/<gateway>/<workspace>/<objectPath>   # dist files
bundles/<account>/<gateway>/<workspace>/versions/<id>.json  # version manifests
```

Keys are content-hash classified for cache-control (`immutable` vs
`must-revalidate`); PUTs persist the per-file SRI as object metadata
(`x-amz-meta-sri`), which is what makes byte-identical re-uploads free. The
store records no "live version" marker — that is FastKV config state
(published slot pins). Documented end-state (deferred): content-addressed
keys, so identical bytes are stored once.

## Local dev

```bash
pnpm --filter @everything-dev/upload-app dev    # every-plugin dev (port 3014)
pnpm --filter @everything-dev/upload-app start  # standalone direct host
pnpm --filter @everything-dev/upload-app test
```
