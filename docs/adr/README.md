# Architecture Decision Records

ADRs record Architecturally Significant Decisions that are hard to reverse.
Format: context → decision → consequences, one file per decision.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-fastkv-registry-namespace-signer.md) | FastKV registry namespaces are self-authenticating (namespace=signer) | Accepted |
| [0002](./0002-plugin-build-composition.md) | One standard rspack build composition for plugins | Accepted |
| [0003](./0003-every-plugin-cli-package-contract.md) | `every-plugin` CLI is the plugin package contract | Accepted (amended 2026-09-26) |
| [0004](./0004-dev-serve-entry-resolution.md) | Dev serve resolves source — no dist fallback | Accepted |
| [0005](./0005-app-ts-authored-descriptor.md) | `app.ts` is the authored descriptor (phase 1 operative) | Accepted (phase 1) |
| [0007](./0007-runtime-composition-ssr.md) | Runtime composition is the SSR model | Accepted (amended) |
| [0008](./0008-manifest-composition.md) | Manifest composition — host owns the route graph, mounts are gates | Accepted |
| [0009](./0009-regression-prod-mode-fixture.md) | Regression stacks run production mode | Accepted (amended) |
| [0010](./0010-composition-contracts-kit-and-precedence.md) | Composition contracts kit and precedence | Accepted |
| [0011](./0011-image-native-artifacts.md) | Image-native artifacts — the image is the deployment | Accepted (amended ×3; boot-role narrowed by [0020](./0020-child-bundle-storage-r2.md)) |
| [0012](./0012-ports-as-scoped-resources.md) | Ports as scoped resources — one Effect Scope per dev session | Accepted (amended) |
| [0013](./0013-passkeys-bound-to-gateway-origin.md) | Passkey ceremonies bound to the gateway origin | Accepted |
| [0014](./0014-single-ceremony-passkey-sign-up.md) | Single-ceremony passkey sign-up | Accepted |
| [0015](./0015-platform-bundle-storage-orpc-file-transport.md) | Platform bundle storage — file transport as oRPC contract concern | Partially superseded; child half reinstated by [0020](./0020-child-bundle-storage-r2.md) |
| [0016](./0016-unified-log-pipeline.md) | Unified log pipeline — stream broadcast with levels | Accepted |
| [0017](./0017-session-gas-keys.md) | Session gas keys primary, relayer fallback | Accepted |
| [0018](./0018-session-single-owner.md) | One owner for the session read path (`everything-dev/ui/auth` singleton) | Accepted |
| [0019](./0019-migration-serialization-advisory-lock.md) | Migrations serialize on a journal-scoped Postgres advisory transaction lock | Accepted |
| [0020](./0020-child-bundle-storage-r2.md) | Child bundle storage — R2-backed CDN distribution for all namespaces | Accepted |
| [0021](./0021-universal-runtime-image.md) | Universal runtime image — one image, identity-selected tiers | Accepted |
| [0022](./0022-two-roots-app-and-workspace.md) | Two roots — the self-contained app root and the workspace frame | Accepted |
| [0023](./0023-ui-stubs-generated-not-synced.md) | UI bootstrap stubs are generated, not synced | Accepted |
| [0024](./0024-composition-stays-manifest-based.md) | Composition stays manifest-based; route chunks load lazily | Accepted |
| [0025](./0025-auth-identity-value-classes.md) | Auth identity values derive from the runtime config | Accepted |
| [0026](./0026-pnpm-workspace-node-runtime-v2.md) | pnpm workspace, node runtime — one toolchain for parent and children (v2) | Accepted |
| [0027](./0027-every-app-is-a-node.md) | Every app is a node — nested plugin addresses, on-chain ownership, follow by default | Accepted |


Skipped numbers: 0006 exists; there are no gaps otherwise. 0015–0018 were
renumbered from duplicate 0007/0011/0012/0013 numbers on 2026-09-26 — the
original numbers were accidentally reused by dev-session efforts; the
low-reference file in each pair moved (see git history).

## Number assignment discipline

- Take the next free number (`ls docs/adr/ | sort -n | tail -1`, then +1 —
  next free is **0028**). Never reuse a number, even for a rejected ADR.
- When citing an ADR in code, plans, changesets, or AGENTS.md, cite the
  number **with the filename** if the context could be ambiguous.
- Superseded ADRs stay in place with a `Superseded by` status link to the
  replacement — they are history, not garbage.
- Amendments append a dated `## Amendment` section and update the Status line.
