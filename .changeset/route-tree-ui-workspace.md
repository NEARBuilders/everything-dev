---
"@everything-dev/every-plugin": patch
---

Fix plugin-local builds writing `src/routeTree.gen.ts` to the process cwd (the plugin root) instead of the ui workspace (`ui/src/routeTree.gen.ts`). Pin the web env's TanStack Router `generatedRouteTree` to the ui workspace root, mirroring the node env's scratch write.

Fixes everything-dev#548
