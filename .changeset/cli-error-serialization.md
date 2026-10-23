---
"everything-dev": patch
---

CLI failures now render the real error instead of `[CLI] [object Object]`: structured (non-`Error`) failures stringify through a shared formatter, the exit-path prints non-`CliError` failures too, and the upgrade migration phase prefers the re-exec'd child's parsed `error` field over raw stderr/stdout concatenation (#522).
