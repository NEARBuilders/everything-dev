# TanStack Router + Module Federation Prototype

Runnable proof for the [beta-v2-ui.md](../beta-v2-ui.md) web plugin architecture: plugins are
**standard TanStack Router apps** (code-based OR file-based), deploy as Module Federation remotes,
and the host grafts their route trees into opaque mount points.

Read the **Prototype Findings** section of `plans/beta-v2-ui.md` for the three defects the
prototype caught in the original plan and their fixes.

## Packages

| Package            | Routing style | Mount points         | Routes                                     | Port |
|--------------------|---------------|----------------------|--------------------------------------------|------|
| `host`             | code-based    | host layouts         | composes all plugins, own nav              | 3000 |
| `remote-landing`   | code-based    | `public` (via `_public`) | `/`, `/about`                          | 3101 |
| `remote-dashboard` | code-based    | `public` (via `_public`) | `/dashboard`, `/dashboard/analytics` | 3102 |
| `remote-settings`  | code-based    | `auth`, `admin`      | `/settings`, `/settings/profile`, `/admin/users` | 3103 |
| `remote-filebased` | **file-based**| `public`, `auth`     | `/blog`, `/blog/$postId`, `/account`       | 3104 |

`remote-filebased` uses real TanStack file-based routing: `src/routes/` feeds `tsr generate` →
`src/routeTree.gen.ts`, and `src/tree.tsx` is a one-line re-export of the generated tree.

## Quick start

```bash
bun i            # or: pnpm install
```

### Headless verify (no browser, no network)

```bash
cd host
pnpm verify        # imports remote source directly, composes, asserts matching + host mounts
pnpm verify:ssr    # composes plugin trees server-side, streams HTML via renderRouterToStream
pnpm verify:collision  # probes TSR behavior when two plugins share a leaf path
```

### Live MF test (remotes + host over Module Federation)

```bash
# terminal 1 — all dev servers
for r in remote-landing remote-dashboard remote-settings remote-filebased host; do
  pnpm --filter $r dev
done

# terminal 2 — headless Chrome browser test (navigates all 10 routes, checks SPA no-reload)
cd host
pnpm verify:browser
```

Then open http://localhost:3000/ and click around: host nav + mount chrome around plugin content
across all four remotes.

## Architecture notes

- **The plugin surface is a single `tree` export** (the generated `routeTree` for file-based, a
  code-built tree otherwise). No `mounts` map, no `name` export, no namespaced ids.
- **Mount points are declared in the plugin's own routes**: any pathless layout whose id's last
  segment starts with `_` is a mount declaration. A plugin author writes `_public.tsx`
  (file-based) or `createRoute({ id: "_public" })` (code-based) and the host derives mount id
  `public` from it — the file system IS the config.
- **The host auto-namespaces subtree root ids** (`<plugin>__<mount>`) to keep route ids globally
  unique. This is invisible to plugin authors: the ids are pathless layouts, never URLs.
- **Mount points are pathless host layouts** (`public`, `auth`, `admin`); grafting never changes
  URLs.
- **The host must share React/Router singletons with remotes** and load them through the embedded
  MF runtime (`registerRemotes`/`loadRemote`) — a fresh `createInstance` deduplicates the shared
  scope and breaks hook calls.
- **SPA navigation needs `Link`**, not bare `<a>`.
- **SSR works**: the host composes plugin trees server-side and renders via `createRequestHandler`
  + `renderRouterToStream` (see `verify:ssr`). The remote's own build must share React with the
  host the same way the browser build does.
- **Leaf collisions are first-wins**: if two plugins declare the same leaf path on the same mount
  (e.g. both `_public/blog.tsx`), TSR silently keeps the first-registered match. Route ids stay
  unique (namespaced subtree roots); only the URL path collides.