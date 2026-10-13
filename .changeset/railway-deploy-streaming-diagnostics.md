---
"everything-dev": minor
---

Make the Railway deploy leg diagnosable: stream the CLI's output live, log the CLI version up front, fail loudly with "Railway CLI not found" when the binary is missing (a spawn failure previously surfaced as a silent instant exit-1), and include the last 20 lines of both streams in the failure message. The parent deploy workflow installs `@railway/cli` explicitly — runners don't ship it.
