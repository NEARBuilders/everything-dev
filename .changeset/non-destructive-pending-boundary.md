---
"everything-dev": patch
---

De-scale the router's default pending boundary so navigations no longer blank the page: the default pending component renders a compact centered spinner instead of a full-viewport "Loading..." takeover, and `defaultPendingMs` moves from 100ms to 333ms so brief navigations keep the previous page visible with the root progress bar carrying the signal. Pairs with the login route rendering instantly from the hydrated session cache instead of blocking on a session fetch.
