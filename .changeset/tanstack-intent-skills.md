---
"ui": minor
---

Upgrade TanStack Router, Query, Devtools, and Table packages to latest so TanStack Intent agent skills ship in the repo: 11 router skills (router-core, router-plugin) and 30 table skills (react-table, table-core) are now loadable via `bunx @tanstack/intent@latest load`. Migrate the DataTable component and its consumers to react-table v9 (`useTable` with explicit `tableFeatures`, automatic core row model, `table.state`, `getPrePaginatedRowModel`, `getAllCells`).
