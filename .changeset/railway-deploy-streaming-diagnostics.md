---
"everything-dev": minor
---

Make the Railway deploy leg diagnosable and fix the Railway build input: stream the CLI's output live, log the CLI version up front, fail loudly with "Railway CLI not found" when the binary is missing (a spawn failure previously surfaced as a silent instant exit-1), and include the last 20 lines of both streams in the failure message. The Railway build file is now selected by `railway.toml`'s `[build] dockerfilePath` pointing at the generated thin digest-pin Dockerfile — the CLI v5 dropped `RAILWAY_DOCKERFILE_PATH` and silently built the repo's root Dockerfile instead, whose cache-mount ids the Metal builder rejects. The parent deploy workflow also installs `@railway/cli` explicitly — runners don't ship it.
