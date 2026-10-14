---
"everything-dev": patch
---

Bound the boot-path HTTP GET cache (#339): entry count is capped (expired entries swept first, then oldest-inserted evicted) so distinct-URL growth — tenant config endpoints, integrity polls — can no longer creep without bound. TTL behavior unchanged.
