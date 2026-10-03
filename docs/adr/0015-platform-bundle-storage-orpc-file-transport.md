# ADR 0015: Platform bundle storage — file transport is an oRPC contract concern, not a host route

Date: 2026-09-19
Status: Partially superseded by [ADR 0011](0011-image-native-artifacts.md) (the DB-backed bundle storage shipped in #133 but was never released and was deleted pre-release by plan 043 Phase B); the child-storage half is **un-superseded and reinstated** by [ADR 0020](0020-child-bundle-storage-r2.md) — the oRPC route design (auth trust family, path allowlist, traversal rejection, size ceiling, server-side SRI) is adopted, with an R2 object-store backend and no host-side serving mount
Supersedes: the storage half of PR #58 (Cloudflare-R2-via-alchemy provider, closed as superseded)

## Context

Plan 029 (`docs/plans/done/029-platform-cdn.md`) adds a `deploy.cdn: "platform"` provider so `bos publish --deploy` can upload Module Federation bundles to the platform API and tenants need no Zephyr/Cloudflare account. This forced a composition decision: where do binary upload/serve routes live, given the host mounts plugins only via oRPC (RPC + OpenAPI handlers)?

Three options were considered:

1. **`servicesTag` + raw host Hono routes** — the API plugin exposes a storage service via `servicesTag`; the host mounts bespoke `POST /api/storage/bundles` and `GET /bundles/*` routes delegating to it.
2. **oRPC contract routes** — the API plugin declares the routes in its oRPC contract; the host mounts the existing `OpenAPIHandler` once more.
3. **Hybrid** — oRPC for the authed JSON upload, raw host route for high-volume GET serving.

## Decision

**Option 2 — everything through the oRPC contract.** The API plugin owns two contract routes:

- `POST /storage/bundles` — authenticated (session/API-key, the same trust family as the relay path), path allowlist, traversal rejection, total-size ceiling, **SRI computed server-side over stored bytes**.
- `GET /bundles/{account}/{gateway}/{workspace}/{+path}` — public, returns a `File` (content-type carried by the file), `Cache-Control: public, max-age=31536000, immutable` via `ResponseHeadersHandlerPlugin`.

The host grows three generic lines, no storage-specific code:

- a route-scoped `bodyLimit` for `/api/storage/bundles` (registered before the global `/api/*` limit; sized from `BOS_MAX_BUNDLE_UPLOAD_BYTES`, default 64 MB decoded, 1.5× headroom for base64+JSON);
- a second mount of the same `OpenAPIHandler` at `/bundles/*` (`handleOrpc(c, apiHandler, "/", …)` — prefix-symmetric with the existing `/api` mount);
- in proxy mode, `/bundles/*` proxies to the API target like `/api/*`.

`servicesTag` remains reserved for **non-HTTP-shaped** host needs (auth bootstrap), matching its single existing consumer. In-process `pluginsClient` composition is unchanged.

Verified against the installed oRPC beta.35 (not just current docs): the runtime implements RFC 6570 `{+param}` catch-all path matching, and `File`/`ReadableStream` outputs serialize through both `RPCHandler` and `OpenAPIHandler`; `ZodToJsonSchemaConverter` converts `z.instanceof(File)` with `unrepresentable: "any"` so spec generation is safe.

## Consequences

- **The host stays fully generic** — no plugin-specific code grows on the host for storage, and future platform file services (plan 032 sandbox bundles, logs, snapshots) reuse the same pattern instead of each adding bespoke host routes + service tags.
- **One trust model.** Uploads authenticate exactly like the relay path. When the caller carries a NEAR principal (SIWN session), uploads are pinned to that account server-side; API-key uploads are bounded by the platform-wide ceilings, consistent with how `x-api-key` works across the API surface.
- **The key layout is the contract**: `bundles/<account>/<gateway>/<workspace>/<path>` — plan 032 stores tenant *config* in FastKV and *bundles* here; keep it stable.
- **R2 (or any object store) drops in behind `BundleStorage`** (`api/src/services/storage.ts`) without touching routes, host, or CLI. Platform-owned credentials only, never tenant-visible.
- **Follow-up generalization**: plan 035 (`docs/plans/035-derived-openapi-mounts.md`, renumbered from the original branch-plan 033) — derive extra HTTP mounts from contract metadata so the `/bundles` mount stops being hardcoded.
- **Trade-off accepted**: bundle assets appear in the OpenAPI/Scalar/MCP surfaces (read-only GETs, tagged `Storage`), and binary responses ride the oRPC serializer rather than a raw static handler — negligible at current scale.
- **Handler convention**: storage route handlers are Effect-native `.effect()` generators accessing the service via `yield* StorageTag` (template pattern, `plugins/_template/src/index.ts`) — `StorageTag` is exposed from `initialize`'s returned layer alongside `ApiServices`. Inline auth inside the generator (`Effect.fail(errors.UNAUTHORIZED(...))` with the required `apiKeyProvided` data) follows the template; the shared `requireAuthOrApiKey` from `api/src/lib/auth.ts` is not used because its `DecoratedMiddleware` typing does not compose with the `.use()` builder (zero working call sites repo-wide — the proposals plugin carries a local copy for the same reason; consolidation is plan 007).
- **Seam deviation from plan 029, recorded**: under the platform provider, workspace `scripts.deploy` (the `withPluginDeploy`/Zephyr hook) is skipped entirely and `bos publish` uploads each workspace's `dist/` artifacts itself, writing `production`/`integrity` via the batch `applyDeployResults` variant instead of the per-route `reportDeployResult`. The one-liner property of workspace deploy scripts holds vacuously (zephyr keeps the hook; platform bypasses it). Revisit if platform providers ever need per-workspace deploy hooks.
