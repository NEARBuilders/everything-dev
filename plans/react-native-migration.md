# React Native Migration Plan (Re.Pack Super-App)

> This plan describes the implementation strategy. For the architectural design and how
> native plugins integrate with the `app.ts` surface, `everything-dev` subpath exports, and
> the generic host composition model, see [beta-v2-native.md](./beta-v2-native.md).

## Architecture Overview

```
CURRENT WEB:
┌──────────────────────────────┐
│  Host (Hono Server)          │
│  - SSR, HTML shell, auth     │
│  - Loads UI via <script>     │
│  - Loads API via every-plugin│
└──────────┬──────┬────────────┘
           │      │
    ┌──────┘      └──────┐
    │ UI Remote          │ API Plugin        │
    │ (React 19, CDN)    │ (oRPC, server)    │
    └────────────────────┘───────────────────┘

REACT NATIVE SUPER-APP:
┌──────────────────────────────────────┐
│  RN Host Shell (native app, app store)│
│  - React Native + Navigation         │
│  - ScriptManager resolvers           │
│  - Federated.importModule for MFEs   │
│  - Auth (secure storage, no cookies) │
│  - bos.config.json runtime loader    │
│  - All native modules live here      │
└──────────┬────────────┬───────────────┘
           │            │
    ┌──────┘            └──────────┐
    │ UI MiniApps (CDN)            │ API (Server, unchanged)
    │ - App1 container.bundle      │ - Hono + oRPC + every-plugin
    │ - App2 container.bundle      │ - Registry plugin for discovery
    │ - Each is an independent MFE │ - Accessed via HTTP (same as web)
    └──────────────────────────────┘─────────────────────────────┘
```

**Key shift**: The Hono host server disappears as the client-side orchestrator. The RN host shell replaces it — it's a native app that loads UI mini-apps as MFE containers on demand. The API server remains unchanged (still Hono + oRPC + every-plugin).

---

## Phase 1: Scaffold RN Host Shell

**Goal**: Get a running RN app with Re.Pack + Module Federation + Zephyr.

### Tasks

1. **Initialize RN project with Re.Pack**
   - Create new workspace `app/` in the monorepo
   - Use `npx @callstack/repack init` or manual setup
   - Replace Metro with Re.Pack's Rspack config (`rspack.config.mts`)
   - Add `@callstack/repack` + `zephyr-repack-plugin`

2. **Configure Module Federation in RN host**

   ```typescript
   // app/rspack.config.mts
   import * as Repack from '@callstack/repack';
   import { withZephyr } from 'zephyr-repack-plugin';

   export default withZephyr(Repack.defineRspackConfig({
     plugins: [
       new Repack.RepackPlugin(),
       new Repack.plugins.ModuleFederationPlugin({
         name: 'host',
         shared: {
           react: Repack.plugins.SHARED_REACT,
           'react-native': Repack.plugins.SHARED_REACT_NATIVE,
         },
       }),
     ],
   }));
   ```

3. **Set up ScriptManager with bos.config.json-based resolvers**
   - On app launch, fetch `bos.config.json` from a known URL (or bundle a bootstrap config)
   - Use `Federated.createURLResolver()` with container URLs from config
   - This replaces the web host's `<script>` tag injection

   ```typescript
   // app/src/bootstrap.tsx
   import { ScriptManager, Federated } from '@callstack/repack/client';
   import { AppRegistry } from 'react-native';

   const config = await loadRuntimeConfig(); // fetch bos.config.json

   ScriptManager.shared.addResolver(async (scriptId, caller) => {
     const resolveURL = Federated.createURLResolver({
       containers: {
         ui: config.app.ui.production, // CDN URL from bos.config
         // Additional mini-apps from registry
       },
     });
     const url = resolveURL(scriptId, caller);
     if (url) return { url };
   });

   AppRegistry.registerComponent('EverythingDev', () => App);
   ```

4. **Runtime config system**
   - Web uses `window.__RUNTIME_CONFIG__` → RN uses `AsyncStorage` + initial fetch
   - Create `RuntimeConfigProvider` context that loads config on app start
   - Same `getAccount()`, `getHostUrl()`, etc. helpers work — they just read from a different source

5. **Entry point** — no `import('./bootstrap')` async boundary (RN limitation):

   ```typescript
   // app/index.js (synchronous entry)
   import './src/bootstrap';
   ```

---

## Phase 2: Authentication Migration

**Goal**: Replace cookie-based web auth with RN-compatible auth.

**Current**: Better-Auth with HTTP-only cookies, SIWN (wallet sign-in), session cookies.

### Migration mapping

| Web Mechanism | RN Replacement | Notes |
|---|---|---|
| HTTP-only cookies | Bearer token + `expo-secure-store` / `react-native-keychain` | Better-Auth supports token-based sessions |
| `credentials: "include"` | `Authorization: Bearer <token>` header | oRPC client interceptor change |
| `window.__RUNTIME_CONFIG__` | `AsyncStorage` + `RuntimeConfigProvider` | Same data, different storage |
| SIWN wallet popup | Wallet SDK deep link (e.g., `near-wallet://`) or embedded `WebView` | NEAR wallet interaction on mobile |
| `authClient.getSession()` | Same, but with token header | Better-Auth client works in RN |

### Key changes

1. **Auth client refactor** — `ui/src/lib/auth-client.ts` currently uses `baseURL` from `getHostUrl()` and `credentials: "include"`. RN version needs:
   - Token storage in SecureStore after sign-in
   - Token refresh interceptor on the oRPC `RPCLink`
   - Session validation on app launch

2. **SIWN for mobile** — The NEAR wallet interaction differs:
   - Deep-link to mobile wallet app → callback with signed message
   - Or use `WebView`-based wallet auth as fallback
   - `better-near-auth` may need a mobile adapter

3. **Shared auth logic** — Extract auth actions from `ui/src/lib/session.ts` into a shared package under `packages/` that works on both web and RN (most actions are just HTTP calls — they already work).

---

## Phase 3: UI Component Migration

**Goal**: Replace shadcn/ui (Radix) with NativeWind v4 + gluestack-ui.

### Current stack → RN equivalent

| Web | RN | Migration effort |
|---|---|---|
| `shadcn/ui` (Radix) | `gluestack-ui` v2 | **High** — Full rewrite of all components |
| `Tailwind CSS v4` | `NativeWind v4` + `@callstack/repack-plugin-nativewind` | **Medium** — Same classes, RN-compatible output |
| `next-themes` | NativeWind dark mode (`useColorScheme`) | **Low** — Built-in |
| `sonner` (toast) | `react-native-toast-message` or gluestack toast | **Low** |
| `framer-motion` | `react-native-reanimated` + `react-native-reanimated` MF plugin | **Medium** |
| `lucide-react` | `lucide-react-native` | **Low** — Same icon set |
| CSS variables | NativeWind tokens / Unistyles | **Medium** |

### Strategy

Create a parallel `app/src/components/ui/` directory using gluestack-ui, keeping the same component API surface (`Button`, `Card`, `Dialog`, `Input`, `Label`, `Tabs`, etc.) so route components can be adapted with minimal prop changes.

### NativeWind setup

```typescript
// app/rspack.config.mts — add NativeWind plugin
import { NativeWindPlugin } from '@callstack/repack-plugin-nativewind';

plugins: [
  new NativeWindPlugin(),
  // ...
],
```

### Tailwind config

The existing `ui/src/styles.css` semantic tokens (`bg-background`, `text-foreground`, etc.) map directly to NativeWind since it uses the same Tailwind config format. The CSS variable → oklch values need conversion to NativeWind's `tailwind.config.ts` format, but the class names stay identical.

---

## Phase 4: Navigation

**Goal**: Replace TanStack Router with React Navigation.

**Current**: TanStack Router with file-based routing (`ui/src/routes/`).

### Migration mapping

| TanStack Router | React Navigation | Notes |
|---|---|---|
| `createFileRoute('/path')` | `Stack.Screen` / `Tab.Screen` | Different API |
| `useRouter().navigate()` | `navigation.navigate()` | Different API |
| `Link to="/path"` | `<Pressable onPress={() => navigation.navigate('Path')}>` | Different API |
| `beforeLoad` auth guard | Navigation state listener / auth context | Different pattern |
| File-based auto-routing | Manual route config or `react-navigation-spec` | No file-based routing in RN |

### Super-app navigation pattern

```
RN Host Shell
├── Tab: Home (browse apps via registry)
├── Tab: My Apps (installed/used mini-apps)
├── Tab: Profile (auth, settings)
└── Stack: Dynamic — loads MFE containers on demand
    ├── App1 (Federated.importModule('app1', './App'))
    ├── App2 (Federated.importModule('app2', './App'))
    └── ...
```

The **browse** experience maps to the existing `registry` plugin — `apiClient.registry.listRegistryApps()` returns available apps, and tapping one triggers `Federated.importModule()` to load that app's MFE container.

---

## Phase 5: MFE Container Structure

**Goal**: Define how mini-apps are built, deployed, and loaded.

### Each mini-app (container) structure

```typescript
// mini-apps/app1/rspack.config.mts
import * as Repack from '@callstack/repack';
import { withZephyr } from 'zephyr-repack-plugin';

export default withZephyr(Repack.defineRspackConfig({
  plugins: [
    new Repack.RepackPlugin(),
    new Repack.plugins.ModuleFederationPlugin({
      name: 'app1',
      exposes: {
        './App': './src/App.tsx',       // Main component
        './Router': './src/router.tsx', // Navigation sub-tree
      },
      shared: {
        react: Repack.plugins.SHARED_REACT,
        'react-native': Repack.plugins.SHARED_REACT_NATIVE,
        // All native deps must be shared + singleton
      },
    }),
  ],
}));
```

### Loading in host shell

```typescript
// Dynamic mini-app loading
const MiniApp = React.lazy(() => Federated.importModule(appId, './App'));

function MiniAppScreen({ appId }: { appId: string }) {
  return (
    <Suspense fallback={<ActivityIndicator />}>
      <MiniApp />
    </Suspense>
  );
}
```

### bos.config.json extension

Add RN-specific container URLs:

```json
{
  "app": {
    "ui": {
      "native": {
        "ios": "https://cdn.example.com/ui-ios/container.bundle",
        "android": "https://cdn.example.com/ui-android/container.bundle"
      }
    }
  },
  "miniApps": {
    "app1": {
      "name": "app1",
      "production": "https://cdn.example.com/app1/container.bundle",
      "productionIntegrity": "sha384-..."
    }
  }
}
```

### Zephyr Cloud

`zephyr-repack-plugin` handles auto-deployment and URL resolution. Same `withZephyr()` wrapper as the web, but using the RN variant. Zephyr automatically resolves the latest deployed version.

---

## Phase 6: API Client (Largely Unchanged)

**The oRPC API client mostly works as-is** — it's HTTP-based.

### Migration mapping

| Current (Web) | RN Adaptation | Effort |
|---|---|---|
| `RPCLink` with `fetch` | `RPCLink` with `fetch` (RN has `fetch`) | **None** |
| `credentials: "include"` | `Authorization: Bearer` header | **Low** |
| `sonner` error toast | RN toast | **Low** |
| Browser singleton (`typeof window`) | No singleton needed (no SSR) | **Low** |

Create a shared `packages/api-client/` package that both web and RN import, with platform-specific auth header injection.

---

## Phase 7: Server-Side (Unchanged)

The entire `host/`, `api/`, `plugins/` stack remains as-is:

- **Hono server** → Still serves the web app and API
- **every-plugin** → API plugins load server-side, unchanged
- **Registry plugin** → Provides app listing data for the RN browse screen
- **oRPC routes** → Both web and RN clients call the same endpoints

The RN app is **another client** of the same API, just like the web app.

---

## Phase 8: Shared Code Strategy

All shared logic lives in `everything-dev` via subpath exports (see
[beta-v2-native.md](./beta-v2-native.md) for the full list). No separate packages.

```
packages/everything-dev/src/
├── api-client.ts       # "everything-dev/api" — oRPC client factory (shared)
├── auth-core.ts        # "everything-dev/auth" — auth actions, session types (shared)
├── runtime-config.ts   # "everything-dev/config" — config types, getAccount() (shared)
├── types.ts            # "everything-dev/types" — shared TypeScript types
├── web/
│   └── compose.ts      # "everything-dev/web" — composeApp, defineWebPlugin
└── native/
    └── compose.ts      # "everything-dev/native" — loadNativePlugins, defineNativePlugin
```

Platform-specific code stays in `web/` and `native/`:
- Component libraries (shadcn vs gluestack)
- Navigation (TanStack Router vs React Navigation)
- Auth client setup (cookies vs tokens)
- Runtime config source (`window.__RUNTIME_CONFIG__` vs `AsyncStorage`)

---

## Limitations & Risks

| Risk | Mitigation |
|---|---|
| Re.Pack 5 MF docs incomplete (v4 docs as reference) | Use v4 patterns + [super-app-showcase](https://github.com/callstack/super-app-showcase) as reference |
| All native modules must be in host shell | Pre-install all native deps (reanimated, gesture-handler, etc.) in host |
| Version lockstep across MFEs (react, react-native versions must match) | Zephyr Cloud manages version alignment |
| No SSR → different data loading pattern | Use TanStack Query `prefetchQuery` on navigation instead |
| Cookie auth → token auth refactor | Better-Auth supports both; refactor is mechanical |
| SIWN wallet on mobile is different | WebView bridge or deep-link; may need custom adapter |
| App store review may flag dynamic code loading | JS-only (no native code loaded dynamically) — allowed by Apple/Google guidelines |
| gluestack-ui components have different APIs than shadcn/ui | Create adapter layer / wrapper components with same props interface |

---

## Execution Timeline

| Phase | Duration | Dependencies |
|---|---|---|
| Phase 1 (Scaffold) | 1-2 weeks | None |
| Phase 6 (Shared API client) | concurrent with Phase 1 | None |
| Phase 2 (Auth) | 1 week | Phase 1 |
| Phase 3 (Components) | 2-3 weeks | Phase 1 (largest effort) |
| Phase 4 (Navigation) | 1 week | Phase 1, Phase 3 |
| Phase 5 (MFE containers) | 1-2 weeks | Phase 1, Phase 4 |
| Phase 7 (Server) | 0 weeks | None |
| Phase 8 (Shared code extraction) | ongoing | Phases 2, 3, 6 |

**Total estimate**: 6-9 weeks for a working super-app that can browse and load mini-apps from CDN.

---

## Key Re.Pack Differences from Web Module Federation

1. **React and React Native must be `eager` + `singleton`** — RN requires synchronous initialization; no `import('./bootstrap')` async boundary
2. **Host cannot use `remotes`** — Must use `Federated.importModule()` instead
3. **All native modules must be in host** — Containers can only load JS; native deps are in the app store binary
4. **No `publicPath`** — All chunk/container resolution via `ScriptManager` resolvers
5. **`Federated.createRemote()`** — Required for `remotes` config in containers (auto-applied by Re.Pack's MF plugin)
6. **No SSR** — RN renders on device; data loading is client-only

---

## References

- [Re.Pack Documentation](https://re-pack.dev/)
- [Re.Pack Module Federation (v4)](https://v4.re-pack.dev/docs/module-federation)
- [Re.Pack NativeWind Plugin](https://re-pack.dev/docs/features/nativewind)
- [Super App Showcase Example](https://github.com/callstack/super-app-showcase)
- [Zephyr Re.Pack Example](https://github.com/ZephyrCloudIO/zephyr-repack-example)
- [Zephyr Cloud + Re.Pack Integration](https://docs.zephyr-cloud.io/recipes/repack-mf)
- [NativeWind Documentation](https://www.nativewind.dev/)
- [gluestack-ui v2](https://gluestack.io/)
