# Layer 1: Offline Shell — Service Worker for MF Asset Caching

## Summary

Make the app shell render fully offline by caching Module Federation remotes via a service worker. The host is generic — it doesn't know what UI or plugins are loaded, but all MF assets flow through predictable proxy paths, so the SW can cache them transparently.

## Why it's generic

All MF assets flow through predictable proxy paths:
- `{assetsUrl}/remoteEntry.js?v={sha}` — UI remote entry (injected into shell HTML)
- `{assetsUrl}/static/css/style.css` — UI CSS
- `/__mf/plugin-ui/{key}/remoteEntry.js?v={sha}` — plugin UI entries
- `/*.js`, `/*.css` — chunk files proxied through the host's catch-all

The SW just needs to know "cache anything that looks like a static asset." No knowledge of what the UI or plugins actually *are* is required.

## What gets built/changed

### 1. New: `host/src/sw.ts` (~120 lines)

A small, standalone service worker file. Never imported into the app bundle — compiled separately as a self-contained script.

```
// Served at /sw.js by the host
const CACHE_NAME = 'mf-assets-v1';
const ASSET_PATTERNS = [
  /\/remoteEntry\.js(\?|$)/,
  /\/__mf\/plugin-ui\//,
  /\/static\//,
  /\.(js|css|png|jpg|svg|ico|woff2?)$/,
];

// On install: pre-cache the shell HTML itself
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.add('/') // cache the HTML shell
    )
  );
  self.skipWaiting();
});

// On fetch: cache-first for assets, network-first for everything else
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isAsset = ASSET_PATTERNS.some(p => p.test(url.pathname + url.search));

  if (!isAsset) return; // pass through (API calls, etc.)

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
      return cached || fetched;
    })
  );
});

// On activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
```

### 2. New: `host/src/services/sw-registration.ts` (~30 lines)

A function that generates the SW registration snippet:

```typescript
export function getSwRegistrationScript(): string {
  return `
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' });
      });
    }
  `;
}
```

### 3. Modified: `host/src/program.ts` (~5 lines)

In `renderClientShell()`, add the registration script to the shell HTML:

```diff
  ${pluginUiScripts}
+ <script${nonceAttr}>${getSwRegistrationScript()}</script>
  <script${nonceAttr}>${themeInitScript}</script>
```

### 4. Modified: `host/rsbuild.config.ts` (~10 lines)

Add a second entry point for the SW so it gets compiled standalone:

```typescript
// Add next to the existing entry
entry: {
  index: "./src/program.ts",
  sw: "./src/sw.ts",
}
```

### 5. New route in `host/src/program.ts` (~3 lines)

Serve the compiled SW file (must be served from root scope for scope `/` to work):

```typescript
app.get("/sw.js", async (c) => {
  const swContent = await fs.readFile(path.join(__dirname, "../dist/sw.js"), "utf8");
  return c.body(swContent, 200, { "Content-Type": "application/javascript" });
});
```

## How cache invalidation works (free)

SRI hashes are already appended as query params: `remoteEntry.js?v=sha384-abc123`. When a new version deploys, the hash changes → the URL changes → the cache misses → the new file is fetched and re-cached. The old cache entry simply sits until SW activation cleans it up. Zero additional logic needed.

## SSR is fine

When online, SSR runs server-side as normal (the SW doesn't intercept server-side fetches). When offline, there's no server — the SW serves the cached shell HTML, which loads cached MF remotes via the same `<script>` tags. The client app renders itself. The user sees the app, just without server-rendered content. The CSP already allows service workers (`workerSrc: ["'self'", "https:", ...uniqueOrigins]`).

## What the UI doesn't need to know

Nothing. The SW is transparent. The UI loads `remoteEntry.js` the same way it always did. The browser's `fetch` just resolves from cache instead of the network.

## What the host doesn't need to know

Nothing about the UI or plugins. It doesn't need to read bos.config.json for SW generation — the URL pattern matching is purely structural (does this look like a static asset?), not semantic (what remote is this?).

## Line count estimate

~150 lines across 4 files (1 new, 1 new, 2 modified).
