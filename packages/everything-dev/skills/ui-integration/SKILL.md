---
name: ui-integration
description: Route creation, API client usage, auth client, SSR hydration, sidebar system, and the @/app module surface. Use when adding new UI routes, fetching data from the API, implementing auth flows, or customizing sidebar navigation.
metadata:
  sources: "ui/src/app.ts,ui/src/lib/api.ts,ui/src/lib/auth.ts,ui/src/router.tsx,ui/src/routes/__root.tsx,ui/src/routes/_authenticated.tsx"
---

# UI Integration

## File-based Routing

Routes are defined as files in `ui/src/routes/`. TanStack Router auto-generates the route tree.

### Route File Convention

```
ui/src/routes/
├── __root.tsx                     # Root layout (HTML shell, head, scripts)
├── index.tsx                      # /
├── _layout.tsx                    # Shell layout (sidebar, header, footer)
├── _layout/
│   ├── index.tsx                  # / (inside shell)
│   ├── _authenticated.tsx         # Auth guard layout (redirects to /login)
│   └── _authenticated/
│       ├── index.tsx              # / (authenticated)
│       ├── settings.tsx           # /settings
│       └── your-plugin/
│           └── index.tsx          # /your-plugin
├── login.tsx                      # /login
└── about.tsx                      # /about
```

- Files starting with `_` are **layout** routes (parent components with `<Outlet />`)
- Files starting with `_` followed by a path segment are **nested layouts**
- Regular files become path segments (e.g., `ui/src/routes/_public/about.tsx` → `/about`)
- Directories create nested paths (e.g., a `_dashboard/` directory nests its files beneath `/dashboard` inside the auth guard)

### Basic Route

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  return <div>About</div>;
}
```

### Route with Loader

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useApiClient } from "@/app";

export const Route = createFileRoute("/projects/$id")({
  loader: async ({ context, params }) => {
    const { apiClient } = context;
    const project = await apiClient.projects.getProject({ id: params.id });
    return { project };
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { project } = Route.useLoaderData();
  return <div>{project.name}</div>;
}
```

### Route with Head/Sidebar Metadata

```tsx
export const Route = createFileRoute("/_layout/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [{ title: "Settings" }],
  }),
});
```

## The `@/app` Module Surface

`ui/src/app.ts` exports everything UI route code needs:

```ts
// Runtime config helpers
import { getRuntimeConfig, getAccount, getAppName, getActiveRuntime, getRepository, getCspNonce } from "@/app";

// API client
import { createApiClient, useApiClient, useOrpc, type ApiClient } from "@/app";

// Auth client
import { createAuthClient, useAuthClient, sessionQueryOptions, useRelayHistory, type AuthClient, type SessionData } from "@/app";

// Types
import type { ClientRuntimeConfig, RouterContext, CreateRouterOptions, RenderOptions } from "@/app";
```

### Runtime Helpers

```ts
const config = getRuntimeConfig();           // Full window.__RUNTIME_CONFIG__
const account = getAccount(config);           // NEAR account
const appName = getAppName(config);           // Title or account
const activeRuntime = getActiveRuntime(config); // { accountId, gatewayId, title }
const repo = getRepository(config);           // Repository URL
const nonce = getCspNonce();                  // CSP nonce for inline scripts
```

These are SSR-safe — they accept an optional `RuntimeConfigInput` to work with config from loader data.

## API Client

### Creation

The client is created once in the client bootstrap and stored in the Router context:

```ts
const apiClient = createApiClient({
  hostUrl: runtimeConfig.hostUrl,
  rpcBase: runtimeConfig.rpcBase,   // "/api/rpc"
});
```

It uses `RPCLink` with `credentials: "include"` and a global error interceptor that shows a toast on network failures.

### In Route Components

```ts
import { useApiClient, useOrpc } from "@/app";

function Component() {
  // Direct usage
  const apiClient = useApiClient();
  const { data } = await apiClient.registry.listRegistryApps({ limit: 24 });

  // With TanStack Query utils (caching, refetch, mutations)
  const orpc = useOrpc();
  const { data, isLoading } = orpc.registry.listRegistryApps.useQuery({ limit: 24 });
  const mutation = orpc.registry.listRegistryApps.useMutation();

  // In route loaders (from context, no hooks):
  const { apiClient } = context;
  const result = await apiClient.ping();
}
```

### Typed API Calls

Every procedure from every plugin is available on `apiClient` with full TypeScript types:

```ts
apiClient.ping()                                          // → { status, timestamp }
apiClient.registry.listRegistryApps({ limit: 24 })         // → { apps, meta }
apiClient.projects.getProject({ id: "proj_123" })         // → Project
apiClient.authHealth()                                     // → { status, emailConfigured, ... }
```

The types come from the auto-generated `api-types.gen.ts`, which merges every plugin's contract into a single `ApiContract` type.

### Error Handling

Network/fetch errors are automatically caught by the `RPCLink` interceptor and shown as a toast:

```
"Unable to connect to API" — The API is currently unavailable.
```

Procedure-level errors (like `UNAUTHORIZED`, `NOT_FOUND`) are thrown as `ORPCError` instances and should be caught inline:

```ts
try {
  await apiClient.authHealth();
} catch (error) {
  if (error instanceof ORPCError) {
    // Handle specific error
  }
}
```

## Auth Client

### Creation

The auth client is also created once in the client bootstrap:

```ts
const authClient = createAuthClient(runtimeConfig);
```

Configured with Better-Auth plugins: SIWN (NEAR), passkey, organization, admin, API key, anonymous, phone.

### In Route Components

```ts
import { useAuthClient, sessionQueryOptions } from "@/app";

function LoginPage() {
  const authClient = useAuthClient();

  // Sign in with email
  await authClient.signIn.email({ email, password });

  // Sign in with NEAR (SIWN)
  await authClient.signIn.siwn({ networkId: "mainnet" });

  // Sign out
  await authClient.signOut();

  // Organization switching
  await authClient.organization.setActive({ organizationId: "org_123" });
}
```

### Session Query Pattern

Use `sessionQueryOptions()` for standardized session fetching with TanStack Query:

```ts
// In a route loader:
const session = await queryClient.ensureQueryData(
  sessionQueryOptions(authClient, context.session),
);

// In a component:
const { data: session } = useQuery(sessionQueryOptions(authClient));
```

Returns `SessionData` with `user`, `session`, and typed auth context.

## Auth Route Guard

The `_authenticated.tsx` layout protects routes that require a session:

```ts
export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );
    if (!session?.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    if (session.user.banned) {
      throw redirect({ to: "/login", hash: "banned" });
    }
    return {
      auth: {
        isAuthenticated: true,
        user: session.user,
        session: session.session,
        activeOrganizationId: session.session?.activeOrganizationId || null,
        isAnonymous: session.user.isAnonymous || false,
        isAdmin: session.user.role === "admin",
        isBanned: session.user.banned || false,
      },
    };
  },
  component: AuthenticatedLayout,
});
```

Nest routes under `_layout/_authenticated/` to inherit this guard. Unauthenticated users are redirected to `/login?redirect=<current-path>`.

## Sidebar System

Sidebar items are defined inline in `ui/src/components/layout/nav-items.ts` as a `NAV_ITEMS` array:

```ts
import { Globe, Home } from "lucide-react";

type SidebarRole = "anon" | "member" | "admin";

interface SidebarItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  roleRequired: SidebarRole;
}
```

### Role filtering:

```ts
function filterSidebarByRole(items: SidebarItem[], userRole: SidebarRole): SidebarItem[] {
  return items.filter((item) => {
    if (item.roleRequired === "anon") return true;
    if (item.roleRequired === "member" && userRole !== "anon") return true;
    if (item.roleRequired === "admin" && userRole === "admin") return true;
    return false;
  });
}

const sidebarItems: SidebarItem[] = [
  { icon: Home, label: "home", to: "/home", roleRequired: "anon" },
];
const visibleItems = filterSidebarByRole(sidebarItems, userRole);
```

Add items manually to the `sidebarItems` array. Available icons: any `lucide-react` icon name.

## SSR Architecture

The ui surface splits by ownership (ADR 0023): the app owns `router.tsx` (the
router factory — notFound/pending/error components and query timings) and
`app.ts`; the mechanical bootstrap files are generated `.gen` stubs
(`entry.gen.ts`, `hydrate.gen.tsx`, `router.server.gen.tsx`, `compose.gen.ts`,
`globals.gen.ts`), gitignored and regenerated by `bos dev`/`build`/`typecheck`
from the installed framework version. Never edit the generated files.

### Router Customization (`router.tsx` — yours)

The hydrated client router AND each SSR request's router mint through the
app's authored factory, so router policy is set in one place:

```tsx
// ui/src/router.tsx
export function createRouter(opts: CreateRouterOptions) {
  return createCoreRouter<ApiClient, SessionData, typeof routeTree>({
    ...opts,
    defaultRouteTree: routeTree,
    // notFoundComponent, errorComponent, scrollRestoration, …
  });
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 } },
  });
}
```

### Client Bootstrap (`hydrate.gen.tsx` — generated)

1. Reads `window.__RUNTIME_CONFIG__`
2. Composes the route tree from the compose payload (core + plugin manifests)
3. Mints the router and query client through the app's `router.tsx` factories
4. Hydrates React DOM into the HTML shell

### Server-Side (`router.server.gen.tsx` — generated)

1. Creates request-scoped routers through the same app factory (SSR parity)
2. Creates per-request `apiClient` and `authClient`
3. Renders to stream via TanStack Router SSR's `createRequestHandler`
4. Host calls `loadRouterModule()` to dynamically load the SSR bundle

### Route Loading for SSR

Loaders run on both server and client. Use `loader` for data needed at render time, `beforeLoad` for auth checks and redirects:

```ts
export const Route = createFileRoute("/projects")({
  beforeLoad: async ({ context }) => {
    // Runs on server and client — good for auth
  },
  loader: async ({ context }) => {
    // Runs on server and client — good for data fetching
    const { apiClient } = context;
    return await apiClient.projects.listProjects();
  },
  component: ProjectsPage,
});
```

The `RouterContext` type:

```ts
interface RouterContext extends BaseRouterContextWithApi<ApiClient, SessionData> {
  apiClient: ApiClient;
  authClient: AuthClient;
}
```

## Component Patterns

### Semantic Tailwind Classes

Use theme-aware classes — never hardcoded colors:

```tsx
<div className="bg-background text-foreground">      // ✅ correct
<div className="bg-blue-600 text-white">                 // ❌ wrong
<div className="text-muted-foreground">                  // ✅ muted text
<div className="bg-card border border-border">            // ✅ card surface
```

### SSR-Safe Rendering

For values that only exist on the client:

```tsx
import { useClientValue } from "@/hooks";

function Component() {
  const appName = useClientValue(() => getAppName(), "app");
  return <h1>{appName}</h1>;
}
```

### Component Location

- Shared UI components: `ui/src/components/ui/` — semantic, reusable primitives
- Feature components: colocated with the route that uses them
- Exports from `ui/src/components/index.ts` for shared components

## The tasks you will actually be given

**"Add a page that lists data."** File under `ui/src/routes/` (nest under `_layout/_authenticated/` to inherit the guard) → `loader` calls `apiClient.<plugin>.<proc>(...)` from context → component reads `Route.useLoaderData()` → add the sidebar entry in `ui/src/components/layout/nav-items.ts`.

**"Add an auth-only page."** Nest under `_layout/_authenticated/` — the guard's `beforeLoad` already redirects to `/login?redirect=<path>`; return `{ auth: … }` from `beforeLoad` to type the context downstream.

**"Call the API in a component."** `const apiClient = useApiClient()` for one-shot calls; `const orpc = useOrpc()` when you want `useQuery`/`useMutation` caching.

## What comes back when it fails

| word | do |
|---|---|
| `ORPCError` with `code: "UNAUTHORIZED"` in the browser | the session middleware resolved nulls — check `authClient.getSession()`; if the guard should have caught it, verify the route actually nests under `_layout/_authenticated/` |
| `Route.` or `apiClient.<plugin>` has no types | generated types are stale — `pnpm run typecheck` (regenerates `api-types.gen.ts`) or restart `bos dev` |
| `TimeoutError` on `page.waitForURL` after a `<Link>` click (browser tests) | client-side nav never fires `load` — pass `{ waitUntil: "commit" }` |
| client-only value crashes SSR | wrap it: `useClientValue(() => getAppName(), "app")` from `@/hooks` |
| edits to `*.gen.*` files keep vanishing | they are generated stubs — change the source (`router.tsx`, `app.ts`, the contracts) instead |
