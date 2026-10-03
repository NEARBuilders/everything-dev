# everything.dev v2 — Native (React Native) Target

## Vision

`app.ts` declares both `web:` and `native:` targets. A full-stack plugin can have `src/`
(backend contract), `web/` (TanStack Router routes for the browser), and `native/` (React
Navigation screens for mobile) — all in one package. The web host composes route trees via
`composeApp()`. The native host composes screens via `registerNativeScreens()`. Both hosts
load their plugins from MF remotes (web via Module Federation, native via Re.Pack). The
backend contract, API client, auth, and sync model are shared. Only the presentation layer
forks.

## Design Principles

1. **Same `app.ts`, different target** — `web:` and `native:` are parallel declarations. Each
   host type only processes its own target. No overlap. No coupling.
2. **Same plugin package, different frontend** — a plugin has `web/` and `native/`
   directories. `bos build` only builds the targets declared in `app.ts`. A web-only deploy
   never builds native code. A native-only deploy never builds web code.
3. **Mount points, not routes** — web uses pathless layout routes (`_public`, `_auth`). Native
   uses tab/stack navigators (`Tab.Home`, `Tab.Profile`). Same concept, different mechanism.
4. **All through `everything-dev`** — `everything-dev/web` for web composition,
   `everything-dev/native` for native composition. No shared packages. One dependency.
5. **Token auth, not cookies** — native uses `expo-secure-store` for tokens. The oRPC client
   injects `Authorization: Bearer` headers. Built into `everything-dev/api`.

## How Native Differs From Web

| | Web | Native |
|---|---|---|
| **Renderer** | DOM (React DOM) | Native views (React Native) |
| **Navigation** | TanStack Router (URL-based) | React Navigation (stack/tab-based) |
| **SSR** | Yes (render to stream) | No (client-only) |
| **MF runtime** | `@module-federation/runtime` | `@callstack/repack` + Re.Pack |
| **Component library** | shadcn/ui (Radix) | gluestack-ui + NativeWind |
| **Auth storage** | HTTP-only cookies | `expo-secure-store` tokens |
| **Runtime config** | `window.__RUNTIME_CONFIG__` | `AsyncStorage` + fetch on launch |
| **Shared deps** | React shared via MF singleton | React + RN shared via Re.Pack singleton |

## Plugin Structure

A full-stack plugin with both web and native:

```
plugins/dashboard/
├── src/                     ← backend (contract, services, router)
│   ├── contract.ts
│   ├── index.ts
│   └── services/
├── web/                     ← web UI (TanStack Router file-based routes)
│   ├── src/routes/
│   │   ├── __root.tsx       ← thin, <Outlet />
│   │   ├── _auth.tsx        ← mount: auth
│   │   │   ├── index.tsx
│   │   │   ├── analytics.tsx
│   │   │   └── $reportId.tsx
│   │   └── plugin.ts       ← export { routeTree } from "./routeTree.gen"
│   └── rsbuild.config.ts
└── native/                  ← native screens (React components)
    ├── src/screens/
    │   ├── _auth/           ← mount: auth tab
    │   │   ├── DashboardScreen.tsx
    │   │   ├── AnalyticsScreen.tsx
    │   │   └── ReportScreen.tsx
    │   └── plugin.ts       ← export { screens, components }
    └── rsbuild.config.mts
```

### Web Plugin Export

```typescript
// plugins/dashboard/web/src/plugin.ts
export { routeTree } from "./routeTree.gen";
// That's it. Standard TanStack Router.
```

### Native Plugin Export

```typescript
// plugins/dashboard/native/src/plugin.ts
import DashboardScreen from "./screens/_auth/DashboardScreen";
import AnalyticsScreen from "./screens/_auth/AnalyticsScreen";

export const screens = {
  dashboard: { component: DashboardScreen, mount: "auth" },
  analytics: { component: AnalyticsScreen, mount: "auth" },
};

export const components = {
  DashboardWidget,  // reusable widget for other plugins
};
```

## Native Host Shell

The native host is a standalone React Native app. It doesn't run in a browser. It loads plugins
as Re.Pack MFE containers and registers their screens with React Navigation:

```typescript
// native/host/src/bootstrap.tsx
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { loadNativePlugins } from "everything-dev/native";
import { createApiClient } from "everything-dev/api";
import { createAuthClient } from "everything-dev/auth";
import { loadRuntimeConfig } from "everything-dev/config";

async function bootstrap() {
  const config = await loadRuntimeConfig();
  const apiClient = createApiClient(config);
  const authClient = createAuthClient(config);

  const pluginRegistry = await loadNativePlugins(config.native);
  // pluginRegistry.screens → { dashboard: { component, mount }, ... }
  // pluginRegistry.components → { DashboardWidget, ... }

  const Stack = createNativeStackNavigator();
  const Tab = createBottomTabNavigator();

  function AuthTab() {
    return (
      <Tab.Navigator>
        <Tab.Screen name="Dashboard" component={pluginRegistry.screens.dashboard.component} />
        <Tab.Screen name="Analytics" component={pluginRegistry.screens.analytics.component} />
      </Tab.Navigator>
    );
  }

  function PublicTab() {
    return (
      <Tab.Navigator>
        <Tab.Screen name="Home" component={pluginRegistry.screens.home.component} />
        <Tab.Screen name="Profile" component={pluginRegistry.screens.profile.component} />
      </Tab.Navigator>
    );
  }

  AppRegistry.registerComponent("EverythingDev", () => () => (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Public" component={PublicTab} options={{ headerShown: false }} />
        <Stack.Screen name="Auth" component={AuthTab} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  ));
}

bootstrap();
```

### `everything-dev/native` — `loadNativePlugins()`

```typescript
// packages/everything-dev/src/native/compose.ts
import { Federated } from "@callstack/repack/client";

interface NativePluginManifest {
  screens: Record<string, { component: React.ComponentType; mount: string }>;
  components?: Record<string, React.ComponentType>;
}

export async function loadNativePlugins(
  plugins: Record<string, string>,  // { name: CDN URL }
): Promise<{ screens: NativePluginManifest["screens"]; components: NativePluginManifest["components"] }> {
  const allScreens: Record<string, { component: React.ComponentType; mount: string }> = {};
  const allComponents: Record<string, React.ComponentType> = {};

  for (const [name, url] of Object.entries(plugins)) {
    const manifest = await Federated.importModule<NativePluginManifest>(name, "./plugin");
    Object.assign(allScreens, manifest.screens);
    if (manifest.components) Object.assign(allComponents, manifest.components);
  }

  return { screens: allScreens, components: allComponents };
}
```

Mount points are just string tags (`"auth"`, `"public"`). The native host has pre-defined tab/stack
navigators keyed by these tags. Plugins declare their mount point in the screen manifest. The host
routes screens to navigators by mount tag. Same pattern as web's `_auth` layout route.

## Auth on Mobile

```typescript
// packages/everything-dev/src/auth-core.ts
// Platform-adaptive auth client
export function createAuthClient(config: RuntimeConfig, options?: { platform?: "web" | "native" }) {
  if (options?.platform === "native") {
    return createNativeAuthClient(config);
  }
  return createWebAuthClient(config);
}

function createNativeAuthClient(config: RuntimeConfig) {
  // Token stored in expo-secure-store
  // Authorization: Bearer header on all requests
  // SIWN via deep-link or WebView bridge
  // No cookies, no window, no DOM
}

function createWebAuthClient(config: RuntimeConfig) {
  // HTTP-only cookies
  // credentials: "include" on all requests
  // SIWN via browser wallet popup
}
```

The **plugin author** doesn't see this split. They call `createAuthClient()` from
`everything-dev/auth`. The platform adapter is selected automatically based on the environment or
passed explicitly by the host.

```typescript
// In any native plugin screen:
import { useAuth } from "everything-dev/auth";
const { signIn, signOut, session } = useAuth();
await signIn.wallet();  // triggers deep-link on mobile, popup on web
```

## `app.ts` Surface

```typescript
// base — multiagency.near / multiagency.ai
export default App({
  account: "multiagency.near",
  domain: "multiagency.ai",

  auth: BetterAuth({ extends: "bos://auth.near/auth.dev#app.auth" }),
  api: API({ path: "api", plugins: { registry: Plugin("registry").path("plugins/registry") } }),

  web: {
    landing: WebPlugin("landing").path("web/landing"),
    dashboard: WebPlugin("dashboard").path("plugins/dashboard/web"),
    auth: WebPlugin("auth").path("plugins/auth/web"),
  },

  native: {
    home: NativePlugin("home").path("native/home"),
    dashboard: NativePlugin("dashboard").path("plugins/dashboard/native"),
    profile: NativePlugin("profile").path("plugins/auth/native"),
  },
});

// tenant — superagency.near / superagency.ai
export default App({
  extends: "bos://multiagency.near/multiagency.ai",
  web: {
    landing: WebPlugin("landing").path("web/my-landing"),
  },
  native: {
    home: NativePlugin("home").path("native/my-home"),
  },
});
```

`bos publish --deploy` only builds targets declared in `app.ts`. A web-only tenant never builds
native code. A native-only deploy never builds web code.

## Deployment

### Dev (`bos dev`)

```
Web host:  http://localhost:3003 (all web plugins on local ports)
Native:    metro/rspack dev server for native host + native plugins
           React Native dev client loads from local dev URLs
```

### Publish (`bos publish --deploy`)

```
For each WebPlugin:
  → rsbuild → dist/ → Zephyr → URL + integrity

For each NativePlugin:
  → rspack (Re.Pack) → container.bundle (iOS) + container.bundle (Android)
  → Zephyr → URL per platform + integrity

Publish config to FastKV:
  web.plugins.landing = "https://landing.zephyr.app"
  native.plugins.home.ios = "https://home-ios.zephyr.app"
  native.plugins.home.android = "https://home-android.zephyr.app"
```

The native host loads containers from Zephyr at launch. Re.Pack's `ScriptManager` resolves URLs
from the published config on FastKV, same as the web host reads URLs from the published config.

## Tenant Model

Tenants follow the same three-tier model as web (see [tenants.md](./tenants.md)):

| Tier | Domain | Native host | Description |
|---|---|---|---|
| **Tier 1** | `other.multiagency.ai` | N/A | Subdomain tenant on shared web host. No native app unless they deploy one separately. |
| **Tier 2** | `superagency.ai` | Own RN app (App Store) | Custom native app that extends base's native plugins. Syncs automatically. |
| **Tier 3** | `superagency.ai` | Own RN app + own backend | Custom native app with custom backend plugins in their own host. Full sovereignty. |

A Tier 2 native tenant:
1. `bos init --extends bos://multiagency.near/multiagency.ai`
2. Customizes `native/home` plugin (their brand, their landing screens)
3. `bos publish --deploy` → builds native plugins → deploys to Zephyr
4. Builds their own RN app (wraps the native host shell with their App Store credentials)
5. Submits to App Store
6. App loads base config from extends → gets base's dashboard, profile screens → auto-syncs

## `everything-dev` Subpath Exports

```json
{
  "exports": {
    ".": "./src/app.ts",
    "./web": "./src/web/index.ts",
    "./web/compose": "./src/web/compose.ts",
    "./native": "./src/native/index.ts",
    "./api": "./src/api-client.ts",
    "./auth": "./src/auth-core.ts",
    "./config": "./src/runtime-config.ts",
    "./types": "./src/types.ts",
    "./mf-build": "./src/mf-build.ts"
  }
}
```

```typescript
// Web host imports
import { composeApp } from "everything-dev/web";
import { createApiClient } from "everything-dev/api";
import { createAuthClient } from "everything-dev/auth";

// Native host imports
import { loadNativePlugins } from "everything-dev/native";
import { createApiClient } from "everything-dev/api";
import { createAuthClient } from "everything-dev/auth";

// Plugin imports (shared)
import { defineUIPlugin } from "everything-dev/web";    // web plugin scaffold
import { defineNativePlugin } from "everything-dev/native"; // native plugin scaffold
import { createRoute } from "@tanstack/react-router";  // web routes (standard)
import { createStackNavigator } from "@react-navigation/stack"; // native nav (standard)
```

## Migration from v1

| Current v1 package | Replaced by |
|---|---|
| `packages/api-client/` | `everything-dev/api` |
| `packages/auth-core/` | `everything-dev/auth` |
| `packages/runtime-config/` | `everything-dev/config` |
| Manual `ScriptManager` setup | `loadNativePlugins()` from `everything-dev/native` |
| Manual screen registration | Plugin manifest + mount point tags |
| RN-specific `bos.config.json` | Same published config, `native:` section |

### Auth migration

| Web mechanism | RN replacement | Notes |
|---|---|---|
| HTTP-only cookies | Bearer token + `expo-secure-store` / `react-native-keychain` | Better-Auth supports token-based sessions |
| `credentials: "include"` | `Authorization: Bearer <token>` header | oRPC client interceptor change |
| `window.__RUNTIME_CONFIG__` | `AsyncStorage` + `RuntimeConfigProvider` | Same data, different storage |
| SIWN wallet popup | Wallet SDK deep link (e.g., `near-wallet://`) or embedded `WebView` | NEAR wallet interaction on mobile |
| `authClient.getSession()` | Same, but with token header | Better-Auth client works in RN |

Key changes:
1. **Auth client refactor** — `ui/src/lib/auth-client.ts` token storage in SecureStore after sign-in, token refresh interceptor on oRPC `RPCLink`, session validation on app launch
2. **SIWN for mobile** — deep-link to mobile wallet app → callback with signed message, or `WebView`-based wallet auth fallback; `better-near-auth` may need a mobile adapter
3. **Shared auth logic** — extract auth actions from `ui/src/lib/session.ts` into `everything-dev/auth` (most actions are just HTTP calls — already platform-agnostic)

### UI component migration

| Web | RN | Effort |
|---|---|---|
| `shadcn/ui` (Radix) | `gluestack-ui` v2 | **High** — full rewrite of all components |
| `Tailwind CSS v4` | `NativeWind v4` + `@callstack/repack-plugin-nativewind` | **Medium** — same classes, RN-compatible output |
| `next-themes` | NativeWind dark mode (`useColorScheme`) | **Low** — built-in |
| `sonner` (toast) | `react-native-toast-message` or gluestack toast | **Low** |
| `framer-motion` | `react-native-reanimated` + Re.Pack MF plugin | **Medium** |
| `lucide-react` | `lucide-react-native` | **Low** — same icon set |
| CSS variables | NativeWind tokens / Unistyles | **Medium** |

Strategy: parallel `app/src/components/ui/` using gluestack-ui with the same component API surface (`Button`, `Card`, `Dialog`, `Input`, `Label`, `Tabs`) so route components adapt with minimal prop changes. Existing `ui/src/styles.css` semantic tokens map directly to NativeWind — class names stay identical, only CSS variable → oklch conversion to `tailwind.config.ts` format.

### Navigation migration

| TanStack Router | React Navigation | Notes |
|---|---|---|
| `createFileRoute('/path')` | `Stack.Screen` / `Tab.Screen` | Different API |
| `useRouter().navigate()` | `navigation.navigate()` | Different API |
| `Link to="/path"` | `<Pressable onPress={() => navigation.navigate('Path')}>` | Different API |
| `beforeLoad` auth guard | Navigation state listener / auth context | Different pattern |
| File-based auto-routing | Manual route config | No file-based routing in RN |

Super-app navigation pattern:

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

## Re.Pack Host Shell Setup

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

ScriptManager resolver with published config:

```typescript
// app/src/bootstrap.tsx
import { ScriptManager, Federated } from '@callstack/repack/client';
import { AppRegistry } from 'react-native';

const config = await loadRuntimeConfig();

ScriptManager.shared.addResolver(async (scriptId, caller) => {
  const resolveURL = Federated.createURLResolver({
    containers: {
      ui: config.app.ui.production,
    },
  });
  const url = resolveURL(scriptId, caller);
  if (url) return { url };
});

AppRegistry.registerComponent('EverythingDev', () => App);
```

MFE container structure (each mini-app):

```typescript
// mini-apps/app1/rspack.config.mts
export default withZephyr(Repack.defineRspackConfig({
  plugins: [
    new Repack.RepackPlugin(),
    new Repack.plugins.ModuleFederationPlugin({
      name: 'app1',
      exposes: {
        './App': './src/App.tsx',
        './Router': './src/router.tsx',
      },
      shared: {
        react: Repack.plugins.SHARED_REACT,
        'react-native': Repack.plugins.SHARED_REACT_NATIVE,
      },
    }),
  ],
}));
```

Dynamic mini-app loading:

```typescript
const MiniApp = React.lazy(() => Federated.importModule(appId, './App'));

function MiniAppScreen({ appId }: { appId: string }) {
  return (
    <Suspense fallback={<ActivityIndicator />}>
      <MiniApp />
    </Suspense>
  );
}
```

## Key Re.Pack Differences from Web Module Federation

1. **React and React Native must be `eager` + `singleton`** — RN requires synchronous initialization; no `import('./bootstrap')` async boundary
2. **Host cannot use `remotes`** — must use `Federated.importModule()` instead
3. **All native modules must be in host** — containers can only load JS; native deps are in the app store binary
4. **No `publicPath`** — all chunk/container resolution via `ScriptManager` resolvers
5. **`Federated.createRemote()`** — required for `remotes` config in containers (auto-applied by Re.Pack's MF plugin)
6. **No SSR** — RN renders on device; data loading is client-only

## Limitations

| Limitation | Mitigation |
|---|---|
| No TanStack Router on RN | Acceptable — React Navigation is the RN standard |
| No SSR on native | App store binary with background data fetch; not a web concern |
| Web and native frontends must be written separately | `src/` backend is shared. `web/` and `native/` fork only at presentation. Shared hooks and API logic can live in `everything-dev` utilities. |
| All native modules must be in the host shell | The native host pre-bundles react-native, reanimated, gesture-handler, etc. Re.Pack enforces this. Plugin containers are JS-only. |
| App Store review may flag dynamic code loading | JS-only containers are permitted by Apple/Google guidelines. No native code is loaded dynamically. |
| Plugin must target both iOS and Android | Re.Pack produces per-platform bundles. `bos publish` builds and publishes both. |

## Implementation Phases (within beta-v2)

### Phase A: `everything-dev` Consolidation

- Fold `api-client`, `auth-core`, `runtime-config` into `everything-dev`
- Add subpath exports: `./api`, `./auth`, `./config`, `./web`, `./native`
- Remove `packages/api-client/`, `packages/auth-core/`

### Phase B: Native Plugin Scaffold + Manifest

- `NativePlugin` constructor in `everything-dev/app.ts`
- `defineNativePlugin()` scaffold utility
- Plugin manifest: `{ screens: {...}, components: {...} }`
- `loadNativePlugins()` in `everything-dev/native`

### Phase C: Native Host Shell

- RN host with Re.Pack + React Navigation
- `ScriptManager` resolvers from published config
- Auth adapter (token-based, `SecureStore`)
- `docker` → `app-store` build pipeline

### Phase D: Tenant Native Overrides

- Tenant `native:` section in `app.ts`
- Per-tenant native plugin URL resolution
- Sync model for native (same extends chain, same TTL)

## Execution Timeline

| Phase | Duration | Dependencies |
|---|---|---|
| Phase A (`everything-dev` consolidation) | concurrent | None |
| Phase B (Native plugin scaffold) | 1-2 weeks | Phase A |
| Phase C (Native host shell) | 2-3 weeks | Phase A, Phase B (largest effort) |
| Phase D (Tenant native overrides) | 1 week | Phase C |

**Total estimate**: 4-6 weeks for a working super-app that can browse and load mini-apps from CDN.

## References

- [Re.Pack Documentation](https://re-pack.dev/)
- [Re.Pack Module Federation (v4)](https://v4.re-pack.dev/docs/module-federation)
- [Re.Pack NativeWind Plugin](https://re-pack.dev/docs/features/nativewind)
- [Super App Showcase Example](https://github.com/callstack/super-app-showcase)
- [Zephyr Re.Pack Example](https://github.com/ZephyrCloudIO/zephyr-repack-example)
- [Zephyr Cloud + Re.Pack Integration](https://docs.zephyr-cloud.io/recipes/repack-mf)
- [NativeWind Documentation](https://www.nativewind.dev/)
- [gluestack-ui v2](https://gluestack.io/)
