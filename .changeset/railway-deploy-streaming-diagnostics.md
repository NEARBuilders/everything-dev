---
"everything-dev": minor
---

Stream the Railway deploy leg's CLI output live instead of capturing it silently. A silent `railway up` exit (empty stdout+stderr, as seen on the 2026-10-13 deploy) now still surfaces the CLI's version line, its streamed output, and the last 20 lines of both streams in the failure message.
