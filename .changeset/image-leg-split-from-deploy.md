---
"everything-dev": minor
---

Split the runtime image leg out of the deploy train

- `bos deploy` gains `--image-digest` (or `BOS_IMAGE_DIGEST`): when set, the image build/push leg is skipped and the Railway deploy pins a thin `FROM <image>@<digest>` Dockerfile to the pre-pushed digest. Without a digest the behavior is unchanged — the image is built and pushed locally when docker is available.
- The production Deploy workflow now runs two jobs, image first: an `image` job builds the `runtime` stage and pushes it to GHCR (sha-<short>, exact version tag, floating v<major> + `:latest` on stable — `:latest` held during prereleases) and outputs the captured digest; the `deploy` job passes `BOS_IMAGE`/`BOS_IMAGE_DIGEST` so the config/bundle publish only happens for a deploy whose image is already in the registry, and a failed image push no longer leaves a partially published deploy.
- `staging.yml` and the consumer workflows are unchanged: `bos deploy` still builds and pushes the image itself when no digest is provided, and child repos (no Dockerfile) degrade exactly as before.
