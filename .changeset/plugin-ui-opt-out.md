---
"everything-dev": patch
---

Let a plugin entry set `ui: false` to drop the ui attached from the app it extends. A consumer of another app's plugin otherwise loads that app's whole UI on every page, and two core UI containers both named `ui` collide on the page (#636).
