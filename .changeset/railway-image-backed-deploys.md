---
"everything-dev": minor
---

Railway deploys are now image-backed — the service's source is a Docker image
ref (connected once in the dashboard; `:rc` during the prerelease train), and
`bos deploy` runs `railway redeploy --from-source` to pull and deploy it.
Railway skips the build entirely for Docker-image sources: no repo upload, no
snapshot, no Metal-builder build (whose cache-mount validation rejected the
repo Dockerfile), and the digest-pin Dockerfile mechanism this replaces is
gone (the CLI v5 dropped `RAILWAY_DOCKERFILE_PATH` and its snapshot respects
`.gitignore`, so generated Dockerfiles never shipped). The root `railway.toml`
is deleted — nothing left for it to own; the healthcheck is a dashboard
service setting. The deploy leg also fails loudly when the Railway CLI is
missing (a spawn failure previously surfaced as a silent instant exit-1) and
streams the CLI's output live with full tails on failure.
