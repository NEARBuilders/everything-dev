---
"everything-dev": patch
---

A bogus `BOS_BUNDLE_DIR` normalizes to unset instead of warning

An empty, whitespace-only, or quoted-empty value (e.g. the literal two characters `""` from a quoting mistake in a deployment env) is treated as unset — the runtime boots in the registry tier silently, with no `staged namespace … not found under ""` warning. A genuinely-set-but-missing bundle dir still warns, now with the value `JSON.stringify`'d so quoting mistakes are self-evident.
