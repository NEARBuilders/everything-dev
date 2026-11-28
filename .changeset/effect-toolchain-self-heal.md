---
"everything-dev": patch
---

`bos typecheck` and `bos` boot fail with an explicit remedy when run in a checkout that was never bootstrapped: "regeneration unavailable in this checkout — bootstrap it first: pnpm install && pnpm run prepare" instead of a bare module-resolution error (#956). Error rendering now skips a `cause` whose text already appears in the outer message, so wrapped failures print once instead of twice.
