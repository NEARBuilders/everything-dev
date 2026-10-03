# ADR 0010: Composition owns every cross-source contract; MF is transport only

Date: 2026-09-23
Status: Accepted

Depends on: ADR 0007 (runtime composition SSR model), ADR 0008 (manifest composition — this ADR *executes* two of its deferred consequences: per-route lazy loads and typed cross-plugin links, both listed in 0008's Consequences/Known-couplings). Informed by: SSR audit findings (`.scratch/composition-v2/FINDINGS-ssr-audit.md`).

## Context

The end-state product shape is: the core ui owns the landing page and the design system; dashboard, auth, orgs, and everything else move into plugins — most of them **remote-only** (not present in this repo); tenants extend the platform through `extends` chains and customize by overriding.

Auditing that shape against the current code (2026-09) surfaced four gaps, each a cross-source contract handled in the wrong place or not at all:

1. **Route override is impossible.** `constructTree` throws on path collision (`packages/every-plugin/src/ui/manifest/construct.ts:320-328`) and rejects duplicate mount declarations (`:189-200`). A tenant defining a local `/settings` route while inheriting the auth plugin 500s the whole site. "Define it locally and it wins" — the stated override model — has no mechanism.
2. **Components are duplicated, not shared.** MF shares singleton *dependencies* (react, tanstack, effect — `packages/every-plugin/src/build/shared-deps.ts`) but nothing component-level: `plugins/auth/ui/src/components/ui/button.tsx` is byte-identical to `ui/src/components/ui/button.tsx`, and so are card, dialog, tabs, etc. Every plugin ships its own design-system copy and drifts.
3. **Cross-plugin navigation is untyped.** Plugin paths are not in the core's `Register`, so core→plugin links route through a string escape hatch (`ui/src/lib/plugin-path.ts` — `pluginPath`/`pluginHref`/`pluginSearch`). ADR 0008 §5 planned this seam's deletion; it survives.
4. **Everything attaches eagerly.** `constructTree` awaits every `routeConfigLoaders` entry for every route of every source on *both* sides (`construct.ts:166-174`). The server amortizes this per cached variant; the client downloads all plugin route chunks before hydration — cost grows linearly with composed route count.

Two candidate mechanisms were rejected:

- **A shared `ui-kit` npm package** — dedupes source but still ships N runtime copies, and kit updates require every plugin to rebuild. In an extends chain with remote-only plugins, "everyone rebuilds" is not a viable propagation path.
- **A JSX `<Slot>` component registry** — makes override-by-construction trivial, but foreign at call sites: developers want `import { OrgSwitcher } from "@/lib/auth"`, not `<Slot name="org-switcher" />`.
- **Build-time MF remotes** (`import { OrgSwitcher } from "auth/OrgSwitcher"` with `remotes: { auth: url }` in the consumer's rsbuild config) — pins the remote URL at build time, which fights the extends model where the *runtime config* decides which deployment serves a tenant, and makes the dependency hard: a tenant that doesn't compose auth gets a broken consumer chunk. Plugin UI builds currently declare zero remotes (`createUiRsbuildConfig` — exposes + shared only), and that should stay true.

## Decision

1. **One precedence rule for all cross-source claims.** Composition resolves competing claims — route paths, mount declarations, component exposes — by source precedence: **the core ui first, then plugins in resolved-config order** (in an extends chain, the child's resolved config order governs, so the child's choices win). Local/core-over-plugin is *override by design* (composition logs the shadowed claim for debuggability); plugin-over-plugin for the same claim is a loud config error naming both sources. Determinism requirement: the rule is pure over (manifests, config order), so server and client construct identical trees from identical inputs and the compose digest stays hydration-parity-safe — the digest covers inputs, not outcomes, and the rule is deterministic. The collision-throw in `constructTree` and the single-declarer mount rule are both replaced by this rule.

2. **The kit is an MF share owned by the core ui.** shadcn-*architecture* components (Radix primitives, semantic Tailwind tokens, `components/ui/*` naming, className passthrough) stay defined in `ui/src/components/ui/` — deliberately departing from shadcn's "copy the source into your repo" ownership model, keeping everything else. The kit is exposed from the core ui container and consumed as a **shared module** (`import: false`, catalog-resolved `requiredVersion`, `eager` on the core provider side) — the exact mechanism react/tanstack already use, added to `createUiSharedDeps`. Consequences: exactly one Button at runtime; semver-compatible kit updates propagate to **all plugins — including remote-only ones — at runtime with zero plugin rebuilds**; breaking changes fail loudly via the shared-identity refusal and `bos mf check` (both extended to cover the kit); and a tenant that overrides `ui` in its extends chain reskins every plugin component at runtime, because the share scope resolves against whichever core ui serves that tenant.

3. **Plugin components are exposed and facaded — never build-time imported.** The manifest schema gains a `components` section (`[{ name, expose }]`), emitted by the same generator step as routes and covered by the compose digest (hydration parity for free). Consumers write **local facade modules** owned by their own repo:
   ```ts
   // plugins/dashboard/ui/src/lib/auth.ts
   import { remoteComponent } from "everything-dev/ui/remote";
   export const OrgSwitcher = remoteComponent<OrgSwitcherProps>("auth", "./OrgSwitcher");
   ```
   `remoteComponent` is a lazy `loadRemote` through the compose-payload bridge — the runtime already registered every plugin remote on the client (`hydrate.tsx`) and has every container loaded on the server (composition instance), so **nobody ever writes `registerRemotes`**. Properties: familiar import at call sites; optional by construction (fallback + named error when the owning plugin isn't composed in); SSR-capable (one Suspense boundary; streaming handles it); override via the local facade file; types generated by `bos types gen` from the owning plugin's deployed manifest, so remote-only plugins typecheck with zero local source. Build-time remotes remain reserved for two plugins that always deploy together.

4. **The core never hard-depends on a plugin.** Core → plugin is always facade-mediated and optional. Plugin → plugin facades by default; hard `loadRemote` coupling only for always-co-deployed pairs.

5. **Typed composed paths.** `bos types gen` emits a merged route-path union from all composed manifests and augments the `Register` with it. `<Link to="/settings/profile">` type-checks in core and in every plugin. `pluginPath`/`pluginHref`/`pluginSearch` are deleted, closing ADR 0008 §5's unfinished seam deletion.

6. **Route options split meta/component.** The generated `routeConfig` contract separates eager **meta** (`loader`/`beforeLoad`/`head`/`staticData`/nav — needed to build the tree and resolve precedence before any component bytes load) from lazy **component** (imported at first match, wrapped in a lazy boundary). The client downloads only matched-route components; the server keeps eager loading (variant-cached, one-time). The generator output shape change warrants a versioned digest input (alongside `MOUNT_REGISTRY_VERSION`) so mixed-version client/server compose fails loudly, never silently.

7. **`bos routes` inspector.** A CLI command that prints the composed tree for a resolved config: every path, its owning source, mount, gate, and nav entries — with precedence outcomes visible (what won, what was shadowed). This is to route composition what `bos mf check` is to shared-dependency identity. In a long extends chain, nobody can hold effective route ownership in their head; the platform must surface it. *(Not yet implemented — decided here, no CLI command exists as of 2026-09-26.)*

## Known couplings (accepted, versioned)

- **Kit semver contract** — a plugin built against kit v2 props must fail loudly against a tenant's kit v1. Enforced by extending the existing shared-identity check + `bos mf check` to the kit; the kit follows strict semver.
- **`remoteComponent` runtime surface** — requires a Suspense boundary at the consumer and SSR `loadRemote` through the shared composition instance; both are already-proven mechanics (routeConfig exposes resolve the same way), but the helper itself is new code.
- **`org`/`team` mounts remain unimplemented** (`mount-registry.ts`) — the organization gate and org-mount ownership belong to the teams-and-workspaces effort and depend on this ADR's precedence rule for mount ownership. Tracked there with a cross-reference, not here.
- `publicPath: "auto"` and the rsbuild→rspack conversion caveat carry over from ADR 0008 unchanged.

## Consequences

- `constructTree`'s error surfaces change: path-collision and duplicate-mount throws become precedence-resolved (with plugin-vs-plugin still throwing). Compose digests do **not** change from the precedence rule alone (rule is input-deterministic), but the meta/component split bumps the route-config digest version once.
- `plugins/auth/ui`'s duplicated shadcn primitives are deleted in favor of kit imports — the repo's second copy of the design system disappears.
- `ui/src/lib/plugin-path.ts` is deleted; its ~11 call sites migrate to typed links.
- Client hydration stops downloading every composed route chunk; only matched-route components load (ADR 0008's deferred lazy-load consequence, landed).
- The composition layer is now the single place where precedence, parity, absence, and identity are decided for routes, mounts, and components — MF wiring, share scopes, and exposes are mechanical transport. This is the "framework seams" goal: one rule-owner, everything else derivable.
- Tenant override becomes real at three levels with one mental model: define a route locally (wins over plugins), define a component locally and re-point the facade, or replace the whole ui (share-scope reskin of all plugin components).
