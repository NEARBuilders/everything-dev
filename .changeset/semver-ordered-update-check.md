---
"everything-dev": patch
---

The update check is now semver-ordered instead of equality-based: `bos dev`/`bos start` warn about outdated packages only when npm offers a version newer than the installed one. An install that is ahead of npm (an image baked from an unpublished workspace version) no longer prints an "Outdated packages" banner suggesting a downgrade. Unparseable versions also stay silent.
