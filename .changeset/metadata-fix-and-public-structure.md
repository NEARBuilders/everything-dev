---
"everything-dev": minor
"host": patch
"ui": patch
---

Fix metadata files being blocked by narrowed static asset regex; standardize public file structure; renderClientShell delegates head data to UI's getRouteHead.

- `host/src/program.ts`: Added `md` and `webmanifest` to `staticAssetPattern` (fixes regression from DDoS narrowing that blocked `.md` and `.webmanifest` from being proxied as static assets). DRY'd inline regex copy to use the named constant.
- `host/src/program.ts`: Refactored `renderClientShell` to accept `HeadData` from the MF-loaded UI router module via `getRouteHead`. Host no longer hardcodes metadata (favicon, manifest, OG tags) — the UI's `__root.tsx` `head()` is the single source of truth. Minimal fallback shell (charset, viewport, title, boot scripts) when module is unavailable.
- `packages/everything-dev/src/ui/router.ts`: Added `serializeHeadData` helper to convert structured `HeadData` (meta/links/scripts) to HTML strings for the raw shell.
- `ui/public/`: Standardized on 15-file public structure. Renamed icon.svg→near.svg, icon_rev.svg→near_rev.svg, android-chrome-192x192.png→web-app-manifest-192x192.png, android-chrome-512x512.png→web-app-manifest-512x512.png. Generated favicon-96x96.png, logo.png. Removed legacy files (favicon-16x16.png, favicon-32x32.png, logo192.png, logo512.png, logo_rev.svg, logo.svg, manifest.json). Replaced manifest.json with site.webmanifest as single PWA manifest.
- `ui/src/routes/__root.tsx`: Updated icon and manifest references to match new filenames.
- `ui/public/site.webmanifest`: Merged richer icon set and fields from old manifest.json.
