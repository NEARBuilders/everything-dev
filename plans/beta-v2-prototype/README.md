# TanStack Router + Module Federation Prototype

Runnable proof for the [beta-v2-ui.md](../beta-v2-ui.md) web plugin architecture: plugins are
**standard TanStack Router apps** (code-based OR file-based), deploy as Module Federation remotes,
and the host grafts their route trees into opaque mount points.

Read the **Prototype Findings** section of `plans/beta-v2-ui.md` for the three defects the
prototype caught in the original plan and their fixes — plus the mount registry / auth-mount
model added later.

## Packages

| Package            | Routing style | Mount points         | Routes                                     | Port |
|--------------------|---------------|----------------------|--------------------------------------------|------|
| `host`             | code-based    | host layouts         | composes all plugins, own nav              | 3000 |
| `remote-landing`   | code-based    | `public` (via `_public`) | `/`, `/about`                          | 3101 |
| `remote-dashboard` | code-based    | `public` (via `_public`) | `/dashboard`, `/dashboard/analytics` | 3102 |
| `remote-settings`  | code-based    | `authenticated`, `admin` | `/settings`, `/settings/profile`, `/admin/users` | 3103 |
| `remote-filebased` | **file-based**| `public`, `authenticated` | `/blog`, `/blog/$postId`, `/account` | 3104 |
| `remote-org`       | code-based    | `organization` (via `_organization`) | `/organization/$orgSlug/{dashboard,settings}` | 3105 |

`remote-filebased` uses real TanStack file-based routing: `src/routes/` feeds `tsr generate` →
`src/routeTree.gen.ts`, and `src/tree.tsx` is a one-line re-export of the generated tree.

## Quick start

```bash
bun i            # or: pnpm install
```

### Headless verify (no browser, no network)

```bash
cd host
pnpm verify        # imports remote source directly, composes, asserts matching + host mounts + params
pnpm verify:ssr    # composes plugin trees server-side, streams HTML via renderRouterToStream
pnpm verify:collision  # probes TSR behavior when two plugins share a leaf path
```

### Live MF test (remotes + host over Module Federation)

```bash
# terminal 1 — all dev servers
for r in remote-landing remote-dashboard remote-settings remote-filebased remote-org host; do
  pnpm --filter $r dev
done

# terminal 2 — headless Chrome browser test (navigates all 12 routes, checks SPA no-reload)
cd host
pnpm verify:browser
```

Then open http://localhost:3000/ and click around: host nav + mount chrome around plugin content
across all five remotes.

## Architecture notes

- **The plugin surface is a single `tree` export** (the generated `routeTree` for file-based, a
  code-built tree otherwise). No `mounts` map, no `name` export, no namespaced ids.
- **Mount points are declared in the plugin's own routes**: any pathless layout whose id's last
  segment starts with `_` is a mount declaration. A plugin author writes `_public.tsx`
  (file-based) or `createRoute({ id: "_public" })` (code-based) and the host derives mount id
  `public` from it — the file system IS the config.
- **The mount registry** (`host/src/mount-registry.tsx`) is the ONLY place a mount type is
  defined: its layout, auth `beforeLoad`, `ssr` behavior, and URL footprint. The host's compose
  loop is generic — it walks `_<mount>` roots, looks the id up in the registry, and grafts.
  Adding `_billing` later is one registry entry, zero host routing code.
- **The host auto-namespaces subtree root ids** (`<plugin>__<mount>`) to keep route ids globally
  unique. This is invisible to plugin authors: the ids are pathless layouts, never URLs.
- **Mount types** — `public`, `anon` (redirects authed users), `authenticated` (requires
  session; alias `auth` for back-compat), `admin` (requires admin), and `organization`
  (parameterized: the host owns `/organization/$orgSlug`). Static mounts are pathless; the
  parameterized mount contributes URL segments and resolves `$orgSlug` for membership checks.
- **Auth is enforced on the MOUNT, not the plugin.** `beforeLoad` on the mount route gates every
  plugin subtree under it. The prototype uses a mock session (`MOCK_ADMIN_USER`); production
  swaps in Better Auth session/membership lookups behind the same interface.
- **SSR is solved by exclusion.** Session-gated mounts (`authenticated`, `admin`, `organization`)
  are `ssr: false` — the server renders nothing for those subtrees, so SSR never sees
  session-dependent content and needs no server-side session resolution. Public and `anon`
  mounts SSR fully. Verified in `verify:ssr`.
- **The host must share React/Router singletons with remotes** and load them through the embedded
  MF runtime (`registerRemotes`/`loadRemote`) — a fresh `createInstance` deduplicates the shared
  scope and breaks hook calls.
- **SPA navigation needs `Link`**, not bare `<a>`.
- **Leaf collisions are first-wins**: if two plugins declare the same leaf path on the same mount
  (e.g. both `_public/blog.tsx`), TSR silently keeps the first-registered match. Route ids stay
  unique (namespaced subtree roots); only the URL path collides.

## CSS / Styling

**Each remote owns its own CSS.** The host does not inject base styles — remotes are
self-contained, consistent with the beta-v2 vision where a remote is a deployable app unit.

### Tailwind v4 with Module Federation

Validated on `remote-dashboard` (Tailwind v4 + Rsbuild):

- **`@import "tailwindcss"` works natively** with Rsbuild — no PostCSS config, no Tailwind config
  file. Install `tailwindcss`, write `@import "tailwindcss"` in a `.css` file, and Rsbuild
  processes it.
- **CSS is bundled as an async chunk** attached to the exposed MF module. When the host loads
  `remote_dashboard/tree`, the CSS chunk is injected automatically.
- **The `:root` custom properties live in the remote's CSS**, not the host's. Each remote defines
  its own theme. Cross-remote variable name conflicts are intentional — remotes own their visual
  identity.

### CSS import boundary

A remote's `tree.tsx` is imported both by:
1. **Rsbuild/MF** (browser) — needs CSS
2. **Host `verify` scripts** (Node.js/tsx) — needs no CSS (tree structure only)

Separate the concerns with a wrapper module:

```
src/tree.tsx           → route tree definition (no CSS import)
src/tree.with-css.ts   → imports styles.css + re-exports tree
```

The MF `exposes` entry points to `tree.with-css.ts`; verify scripts import `tree.tsx` directly.

### Known trade-offs

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Duplicate Tailwind preflight if N remotes import `@import "tailwindcss"` | Waste, not bug | One "theme" remote imports full Tailwind; others use `@import "tailwindcss/utilities"` |
| `:root` custom property clobbering (same var, different value) | App-level bug if remotes share theme | Convention: remotes that share visual identity import theme from a shared package |
| CSS Module class hash collisions | Not a risk | Hashes are unique per build |

### Files created/changed

| File | Purpose |
|------|---------|
| `remote-dashboard/src/styles.css` | Tailwind v4 import + `@theme inline` with custom colors |
| `remote-dashboard/src/env.d.ts` | `/// <reference types="@rsbuild/core/types" />` for CSS type support |
| `remote-dashboard/src/tree.with-css.ts` | Imports CSS + re-exports `tree.tsx` |
| `remote-dashboard/src/tree.tsx` | Converted from inline styles to Tailwind classes |
| `remote-dashboard/rsbuild.config.ts` | MF expose points to `tree.with-css.ts` |
| `remote-dashboard/package.json` | Added `tailwindcss` dependency |