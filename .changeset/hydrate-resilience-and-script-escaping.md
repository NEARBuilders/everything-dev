---
"everything-dev": patch
"ui": patch
---

Inline `<script>` JSON is now escaped (`</script>`, U+2028, U+2029) to prevent XSS and script-breakage; the CSP nonce is serialized null-safe. Hydration failures now clear `__EVERYTHING_DEV_HYDRATE_PROMISE__` so a retry can succeed instead of permanently returning a rejected promise. An explicit `__EVERYTHING_DEV_SSR__` flag is injected during server render for reliable SSR detection. The `.env.example` template is expanded with all secret placeholders grouped by app section.
