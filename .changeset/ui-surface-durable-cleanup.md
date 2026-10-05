---
"every-plugin": patch
"everything-dev": patch
"ui": patch
---

Trim the core ui's declared MF surface to consumed exposes (drop `./providers` and `./hooks`), construct the core-only tree on the client when a deployment carries no compose payload or a malformed one (plugin-free CSR apps no longer crash on "no route tree"), and correct ownership headers. The ui globals ambient file is trimmed to the rsbuild types reference.
