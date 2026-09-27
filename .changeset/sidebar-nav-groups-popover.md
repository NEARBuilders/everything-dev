---
"ui": minor
---

Collapsible sidebar nav groups: `SidebarItem` gains optional `children`, role filtering recurses through them (a group is dropped when no child passes), and `AppSidebar` renders groups as Radix collapsibles that expand for the active path, with chevron toggle and sub-item links. `AppShell` now passes the router `pathname` down instead of an `isActive` callback.

Add `Popover` and `InfoPopover` primitives (`info`-icon trigger with title, body, and outlinks) exported from `@/components`.

`dao-connect` hardening: new `verifyDaoAccount` re-syncs the zustand store against the connector before signing (stale Trezu sessions now reset the store and prompt reconnect) and `describeDaoError` maps connector failures to actionable messages; `fetchDaoPolicy` uses `btoa` instead of the Node `Buffer`.

The tenant detail page guards a missing `domain`: when the active runtime resolves no gateway id it shows a "gateway not configured" card instead of publishing mutations that would fail, and it reads the runtime config from route context rather than the singleton.
