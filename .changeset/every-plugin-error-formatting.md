---
"every-plugin": patch
---

Harden error rendering: unknown throwables (symbols, objects, unserializable values) stringify safely in runtime error messages and plugin-load logs instead of throwing or printing `[object Object]`.
