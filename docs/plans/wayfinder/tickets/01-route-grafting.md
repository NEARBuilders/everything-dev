## Question

Given TanStack Router requires the full route tree before `createRouter()` (no lazy route registration), and `getParentRoute` is type-level only (runtime hierarchy comes from `addChildren()`), what's the web plugin grafting strategy?

> **Re-annotation (2026-09-26):** the grafting resolution below is historically
> accurate but **superseded** — PR #134 exposed grafting as a structural
> failure class, and ADR 0007/0008 replaced it with manifest composition
> (host constructs the route tree from generated manifests). See
> [plans/prototypes/manifest-compose/](../../prototypes/manifest-compose/).


Key constraints from research:
- Discussion #585/#646: `getParentRoute` is for TypeScript inference only; runtime uses `addChildren()` structure
- Discussion #7564: a user with 13 MF remotes must `Promise.allSettled` ALL before `createRouter()`. Route trees cannot be added lazily after router creation.
- `route.update({ getParentRoute: () => hostRoute })` can re-parent a remote route before grafting, but this must happen before `createRouter()`
- Code-based routes can't mix with file-based routes in the same tree (issue #2154)
- `davidturissini/tanstack-router-merge` proves type-safe multi-package merging works, but "doesn't scale"

Questions to resolve:
1. Do we need mount points (pathless layout routes like `_public`, `_auth`, `_admin`) or can we just graft at root? What does the host's route tree actually look like?
2. If all remotes must load upfront, is that acceptable for our scale (typically 3-10 plugins, not 13+)?
3. How do we handle the `getParentRoute` mismatch? Each plugin's routes reference their local root, but the host grafts under a different parent. Is `route.update()` the answer?
4. Can we use `createRootRouteWithContext<{ apiClient: ..., auth: ... }>()` to inject shared context (apiClient, auth, runtime config) into all grafted plugin routes?
5. What does a 2-plugin minimum prototype look like? Host with mount points + 2 independently deployed web plugins grafted via `addChildren()`.

## Resolution

**RESOLVED** by the [beta-v2 web grafting prototype](../../prototypes/beta-v2/) and documented in [beta-v2/ui.md](../../beta-v2/ui.md) "Prototype Findings" section.

All five questions answered:
1. **Mount points yes** — pathless layouts (`_public`, `_auth`, `_admin`, `_organization`) with a mount registry. The host derives mount id from the last segment of the pathless layout id.
2. **Upfront loading is fine** — `Promise.allSettled` all remotes before `createRouter()`. Typical scale is 3-10 plugins, well within acceptable range.
3. **Reparent subtree root only** — override `options.getParentRoute` on the subtree root to return the host mount route. One shallow mutation per subtree, not deep traversal. Descendants keep referencing the same subtree-root object.
4. **Yes, context injection works** — `createRootRouteWithContext<{ apiClient, auth, ... }>()` flows to all grafted routes via `useRouteContext()`.
5. **Prototype built and verified** — 5 remotes (4 code-based + 1 file-based) composed headlessly and via browser. See [prototype README](../../prototypes/beta-v2/README.md).
