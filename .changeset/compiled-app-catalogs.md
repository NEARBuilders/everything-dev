---
"ui": patch
---

Compile the app message catalogs (compileMessageOrThrow at load) so production builds ship Lingui compiled messages — ICU interpolation and plurals work and the "Uncompiled message detected" console warning is gone.
