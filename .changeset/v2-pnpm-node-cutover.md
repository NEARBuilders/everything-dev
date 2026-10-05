---
"everything-dev": major
---

pnpm workspace, node runtime — the v2 clean break (ADR 0026)

- `bos init` emits pnpm-native children: `pnpm-workspace.yaml` (synthesized
  globs + merged catalog), a `packageManager` field, pnpm filters in every
  generated script, and pnpm prose in AGENTS.md/onboarding. The child's
  authored config is always the generated `bos.app.ts` (never a copied
  `bos.config.json`, never bunfig). Installs run `pnpm install --ignore-scripts`;
  stray `bun.lock`/`pnpm-lock.yaml` are removed so installs re-resolve.
- The orchestrator spawns node/pnpm: dev services launch through `pnpm run dev`
  (host via `NODE_OPTIONS=--conditions=development`; plugins through
  `every-plugin dev`'s tsx path), the bun-flag chaining is gone.
- Workspace-root discovery reads `pnpm-workspace.yaml` first (package.json
  `workspaces` stays the pre-v2 fallback) — fixes the prerequisite train
  silently no-oping after the catalog moved.
- Non-framework `workspace:` deps normalize to `catalog:` in generated
  children (pnpm does not link catalog-indirect workspace members).
- Child CI templates are pnpm/node (`pnpm/action-setup` + node 24, `pnpm audit`
  with `AUDIT_STRICT` gating, stray-bun guard).
