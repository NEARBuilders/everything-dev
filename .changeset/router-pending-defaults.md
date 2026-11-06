---
"everything-dev": patch
---

Router pending defaults (#683, trivial slice): the default pending boundary
renders a spinner instead of bare "Loading..." text, and `defaultPendingMs`
drops to 100ms (from the router's 1000ms default) on both the client and SSR
routers — cold authed navigations no longer sit blank for up to a second, and
children no longer need to re-declare `pendingMs` + `pendingComponent` per
layout. The session-cache unification (double fetch, false-empty flashes)
remains a separate design discussion under #683.
