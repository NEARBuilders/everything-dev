---
"ui": patch
---

Fix React error #418 (hydration mismatch on the navigation progress bar) by wrapping the progress bar in `ClientOnly`. During SSR, `router.state.status` is `"pending"` (set by `router.beforeLoad()` during `router.load()` and never reset to `"idle"`), causing `isNavigating = true` and rendering the progress bar. On the client, the router is created fresh with `status: "idle"` and the `hydrate()` function only sets matches from dehydrated data without resetting status, so the progress bar is not rendered during hydration. This structural mismatch caused React to throw a hydration error. `ClientOnly` suppresses the progress bar during both SSR and initial hydration so they match, while still allowing it to appear during client-side navigation.
