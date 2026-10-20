---
name: v1-to-v2-upgrade
description: bos upgrade --from v1 — audit an everything-dev v1 child app for upgrade readiness (mount conformance gate, config surface, legacy imports) and apply the deterministic v2 transforms (authored descriptor, bun→pnpm catalog migration, consumerized refs, import rewrites, obsolete-file deletion, plugin dep declarations). State-aware post-upgrade behavior plus re-runnable maintenance steps (port-route-guards, db-topology, i18n-seam, compose-seam). Use when upgrading a v1 child to the v2 train, auditing upgrade readiness, or re-running post-upgrade regression guards after bos sync.
metadata:
  sources: "packages/everything-dev/src/services/scaffold/upgrade-audit/index.ts,packages/everything-dev/src/services/scaffold/upgrade-audit/audit.ts,packages/everything-dev/src/services/scaffold/upgrade-audit/apply.ts,packages/everything-dev/src/services/scaffold/upgrade-audit/checks,packages/everything-dev/src/services/scaffold/upgrade-audit/steps,packages/everything-dev/src/handlers/upgrade.ts,packages/everything-dev/src/cli/commands/scaffold.ts"
---

# bos upgrade --from v1 (v1 → v2 upgrade train)

Adopted from the original `scripts/v2-upgrade` tooling
(NEARBuilders/feedback.nearbuilders.org#180, NEARBuilders/everything-dev#455).
The audit reads `bos.config.json` and maps its surface; the apply consumes the
v1 tree and rewrites it in place.

## State-awareness

The commands detect tree state first: if the authored `bos.app.ts` is present,
the tree is already on the v2 train and the run exits cleanly with
"Already upgraded · v2 — nothing to do" (the audit is a v1-state precondition —
after the v2 upgrade the `bos.config.json` it reads is intentionally replaced
by the authored descriptor). On a v2 tree, drive changes from
`bos sync` / `bos upgrade` instead.

## Audit (write nothing)

```bash
bos upgrade --from v1 --audit          # emits .bos/v2-upgrade-manifest.json
bos upgrade --from v1 --audit --json   # machine-readable result
```

The hardline gate blocks unknown mounts, nested routes, and ungated authed
layouts (Tier B) before apply will run; Tier A trees pass. Blockers exit 1
with "GATE BLOCKED — normalize in v1 before upgrading to v2."

## Apply (consume the v1 tree)

```bash
bos upgrade --from v1 --dry-run        # preview the rewrites
bos upgrade --from v1                  # apply: author descriptor, migrate
```

Apply steps (each logged with wrote/deleted/note lines):
1. **author-config** — authors `bos.app.ts` from `bos.config.json`
2. **migrate-pnpm** — bun/npm → pnpm catalog migration
3. **migrate-ui-seam** — wires the app-owned ui bootstrap seam
4. **apply-manifest** — consumerized refs, legacy import rewrites, obsolete-file deletion, plugin dep declarations

After apply: `pnpm install && bos types gen && bos sync`.

## Post-upgrade maintenance (re-runnable regression guards)

```bash
bos upgrade --from v1 --maintain port-route-guards [--dry-run]
bos upgrade --from v1 --maintain db-topology [--dry-run]
bos upgrade --from v1 --maintain i18n-seam [--dry-run]
bos upgrade --from v1 --maintain compose-seam
```

- **port-route-guards** — rewrites authed mount guards to the framework's
  canonical session resolution (`requireSession` from `everything-dev/ui/auth`)
  and patches the root's session wiring to `resolveSessionFromCache` with
  explicit signed-out seeding. Reimplemented inline resolution diverges from
  the cached view of the same `["session"]` key and ping-pongs `/login` ↔ the
  guarded route until the router's redirect budget trips ("Too many
  redirects"). Upstream snapshots in
  `src/services/scaffold/upgrade-audit/fixtures/upstream/routes/` are pinned
  by `upstream-ref.ts` to the gitHead of the installed package version.
- **db-topology** — patches the sync-owned `api/src/db/layer.ts` back onto the
  public-schema topology for the api workspace (`slug === "api" → undefined
  schemaName`). Under the upstream template the api's migrations land in
  `plugin_api`, drift goes `drift-manual`, and the api plugin refuses to boot
  (every `/api/*` route 503s). `bos sync` restores the template until the
  upstream fix lands — re-run this after syncs.
- **i18n-seam** — wires the shared i18n runtime into the core UI
  (`ui/src/i18n/catalogs.ts` + `ui/src/i18n/runtime.tsx`, mounted in the root
  route). Only the app's own UI can provide `@lingui/*` to the federation
  share scope (the host's auth plugin consumes them with `import: false`); a
  core UI that never imports `everything-dev/ui/i18n` fails at SSR composition
  with RUNTIME-012 ("The getter for the shared module is not a function …
  shareKey @lingui/core").
- **compose-seam** — replays the host's SSR composition (core ui /login claim
  vs the deployed auth-ui /login tree) through the installed every-plugin
  `constructTree`. Expects the benign "core ui wins; shadowed route skipped"
  log and a clean compose; a false "unresolvable parentage" means the
  cascade-splice fix hasn't landed in the installed every-plugin yet. The
  non-live mode resolves a vendored auth manifest fixture from this package's
  source tree — run it from the everything-dev repo (or ship the fixture) for
  a stable baseline.

## Where the code lives

`src/services/scaffold/upgrade-audit/` — `index.ts` (service entrypoints:
`isV2Tree`, `auditV1Tree`, `applyV1Tree`, `maintainV1Tree`), `audit.ts`,
`apply.ts`, `domain.ts`, `manifest.ts`, `fs.ts`, `checks/` (8 checks),
`steps/` (7 apply/maintenance steps), `fixtures/` (vitest trees, excluded
from tsc and biome). Tests: `tests/unit/upgrade-audit/`. The CLI flags are
derived from `UpgradeOptionsSchema` in `src/contract.ts`; the handler branch
lives in `src/handlers/upgrade.ts`, the renderer in
`src/cli/commands/scaffold.ts`.
