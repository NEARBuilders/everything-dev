---
"@everything-dev/votes-plugin": patch
---

Published vote events now carry a SHA-256-derived channel identifier instead of the raw user id, so subscribing clients can no longer correlate votes with individual users.
