---
"ui": patch
---

Add `MotionConfig reducedMotion="user"` (a11y), fix a `rules-of-hooks` footgun in `useRelayerInfoQuery`, lift 5 dead-state handlers to module scope, and replace 4 `transition-all` Tailwind classes (header, theme toggle, admin banner) with named properties. Clears the 2 ERROR-severity and 9 of the most-cited WARN findings in the `ui` react-doctor report (83 → 72, both ERROR rules to 0).
