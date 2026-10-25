---
"everything-dev": minor
---

Themed boot shell + head preconnects (#471): the client shell's boot placeholder (and the router's default pending component) now render a themed spinner ring on `bg-background` instead of bare `<p>Loading...</p>` — no unstyled flash, no layout shift, and the shell stays the prod stream-failure fallback. The SSR'd head emits `<link rel="preconnect">` for each distinct module-entry origin so the browser's compose chain starts connecting at head parse.
