---
"every-plugin": minor
---

`sonner` joins the UI shared-dependency spec as optional: plugins that declare `sonner` in their dependencies share the provider's toast store; others are unaffected. Shared-dependency specs also accept an `optional: true` flag and `createUiSharedDeps` a `dependencies` map to resolve optionality against.
