---
"@everything-dev/votes-plugin": patch
---

Honor vote-feed cursors with deterministic ordering for votes sharing a timestamp. Unknown or deleted cursors terminate the page instead of repeating the beginning of the feed.
