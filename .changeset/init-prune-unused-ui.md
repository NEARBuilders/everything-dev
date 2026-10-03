---
"everything-dev": minor
---

`bos init` prunes unreferenced ui sources for ui-override children. After copying the parent's ui workspace, a static import graph seeded from framework-owned files and the copied routes walks `@/` and relative imports — named imports through the components barrel keep only the named exports' files; a namespace import keeps everything it exports. Unreachable lib/component/provider files are deleted (their tests go with them, orphaned tests whose subject doesn't exist get cleaned up, empty directories collapse, and the components barrel loses the dead export statements). Framework-owned files, generated types, and route files are never pruned. The init snapshot records the post-prune state, so `bos sync` never re-adds pruned files. On the citynode template this removes the whole app-detail family, four unused shadcn primitives, and dead lib files for every fresh child.
