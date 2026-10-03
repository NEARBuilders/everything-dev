---
"ui": patch
---

Fix React 19 hydration mismatch on every server-rendered page.

- The root route rendered a server-only inline `<script>` (`window.__EVERYTHING_DEV_SSR__=true`, gated on `typeof window === "undefined"`) into `<head>`. During hydration the client rendered the head without it, misaligning the head script children and producing a full-tree hydration failure on all SSR pages.
- The SSR marker is now a `data-everything-ssr` attribute on `<html>`, rendered only during SSR. `<html>` already carries `suppressHydrationWarning`, so the attribute-only difference is tolerated without any child-tree mismatch.
- `isServerRendered()` in the client bootstrap reads the marker attribute (keeping the `window.__EVERYTHING_DEV_SSR__` and `$_TSR` fallbacks for backcompat).
