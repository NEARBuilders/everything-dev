---
"everything-dev": minor
---

Publish gate: before writing to the registry, every pinned slot's bytes are fetched from its production URL and checked against the pin's SRI. A publish whose pinned bytes are missing or mismatched is blocked instead of silently republishing broken pointers.
