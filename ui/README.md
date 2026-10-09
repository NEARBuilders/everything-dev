# ui

UI package for the app shell, routes, and client runtime.

## Runtime Surface

The package runtime lives in `everything-dev/ui`:

| Export | Purpose |
|--------|---------|
| `everything-dev/ui/router-client` | Client router factory (minted through the authored `router.tsx`) |
| `everything-dev/ui/router-server` | SSR router module factory |
| `everything-dev/ui/entry` | Web bootstrap runner |
| `everything-dev/ui/hydrate` | Client hydrator |
| `everything-dev/ui/types` | Shared router and head types |

The app-level barrel is `ui/src/app.ts` and is the preferred import for route code.

**Shared dependencies** (singleton via `bos.config.json → app.api.shared` and `app.auth.shared`):

- `react`, `react-dom`
- `@tanstack/react-query`, `@tanstack/react-router`
- `near-kit`
- `better-auth`, `better-near-auth`

## Development

```bash
bos dev                 # Typical: remote host (auto-detected), local UI + API
bos dev --api remote    # Isolate UI work
```

## Internationalization

Message catalogs live in `ui/src/i18n/catalogs.ts` (app-owned, ADR 0023); the app's `appLocale` export feeds SSR locale negotiation, and `ui/src/i18n/runtime.tsx` shares locale state across the Module Federation bundles.

## Configuration

The authored runtime config (`bos.app.ts`, resolved and materialized by the CLI) only needs the UI runtime URLs and package metadata. Build-time module exposes are synthesized by the CLI — workspaces ship zero build config by default.

## Route Protection

File-based routing with auth guards via TanStack Router:

- `_authenticated.tsx` - Requires login, redirects to `/login`
- `_admin.tsx` - Requires admin role
- `_public.tsx` - Public surfaces (landing, about, skill docs)

## Tech Stack

- **Framework**: React 19
- **Routing**: TanStack Router (file-based)
- **Data**: TanStack Query + oRPC client
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Build**: Rsbuild + Module Federation
- **Auth**: better-auth client

## Scripts

- `pnpm run dev` - Start dev server (port 3003)
- `pnpm run build` - Build for production
- `pnpm run typecheck` - Type checking
