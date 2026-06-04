---
"everything-dev": minor
---

Support nested JSON values (objects, arrays, numbers, booleans) in plugin `variables` config. Previously `bos.config.json` only accepted flat `Record<string, string>` — any nested Zod objects/arrays were silently dropped at config load time. Now variables preserve their full structure through config resolution, runtime loading, and plugin injection, matching what plugin Zod schemas already validate.