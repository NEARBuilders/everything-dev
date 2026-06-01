---
"everything-dev": patch
"host": patch
"ui": patch
---

Replace UI asset 302 redirects with reverse proxy to fix Cloudflare 403 errors

The host now proxies all UI public assets (images, CSS, JS, fonts, favicons) through the host origin instead of 302-redirecting browsers to the Zephyr CDN. This eliminates cross-origin requests that Cloudflare blocks with 403 errors.

**Breaking changes:**

- `RenderOptions.assetsUrl` removed from `everything-dev/ui/types` — assets are now served from the host origin via root-relative paths
- `RouterContext.assetsUrl` removed from `everything-dev/ui/types` — no longer needed since assets resolve through the host proxy
- `getRemoteEntryScript()` removed from `everything-dev/ui/head` — use `getRemoteScripts()` which now returns `{ src: "/remoteEntry.js" }`
- `RemoteScriptsOptions.assetsUrl` removed — `getRemoteScripts()` no longer needs an assets URL
- `UnderConstruction` component: `assetsUrl` prop removed — images use rspack module imports directly
- `ClientRuntimeConfig.assetsUrl` now set to the host origin (`requestUrl.origin`) instead of the CDN URL — existing consumers should note this value change

**What changed:**

- Host: `isUiPublicAssetPath()` deleted, logic inlined; `redirectUiAssetRequest()` replaced with `proxyUiAssetRequest()` using `proxyRequest()`
- Host: `renderClientShell()` uses root-relative paths (`/favicon.ico`, `/remoteEntry.js`) instead of CDN URLs
- Host: Plugin UI `<script>` tags use `/__mf/plugin-ui/${key}/remoteEntry.js` proxy paths
- Host: `buildRuntimeClientConfig` sets `assetsUrl` to `requestUrl.origin`
- UI: All `${assetsUrl}/path` references replaced with `/path` root-relative paths
- UI: `new URL(importedAsset, assetsUrl)` pattern removed — rspack module imports used directly
- UI: `/skill.md` fetched via root-relative path, no `assetsUrl` construction needed