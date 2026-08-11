---
"ui": patch
---

Fix login redirect loop after successful sign-in by invalidating the session query before navigating. Use the typed `detectNearAccount` (removes `as any`) and `getNearClient()` for direct wallet transactions.
