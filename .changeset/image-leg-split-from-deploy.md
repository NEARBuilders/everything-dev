---
"everything-dev": minor
---

Split the runtime image leg out of the deploy train

- `bos deploy` gains `--image-digest` (or `BOS_IMAGE_DIGEST`): when set, the image build/push leg is skipped and the Railway deploy pins a thin `FROM <image>@<digest>` Dockerfile to the pre-pushed digest. The digest is validated (`sha256:<64 hex>`) — a malformed value fails the deploy before any publish, both as a flag and via env. With a digest present, the image ref is resolved from the pushed ref (`BOS_IMAGE`/repository derivation); `ci.image` is excluded because it is a build-time choice, not a pin-time one, preventing a digest/ref mismatch. Without a digest the behavior is unchanged — the image is built and pushed locally when docker is available.
- The production Deploy workflow now runs two jobs, image first: an `image` job builds the `runtime` stage and pushes it to GHCR (sha-<short>, exact version tag, floating v<major> + `:latest` on stable and non-semver versions — `:latest` held during prereleases, same parity as `computeImageTags`) and outputs the captured digest — resolved from the registry per pushed ref with all tags asserted equal, not scraped from a single push output. The `deploy` job passes `BOS_IMAGE`/`BOS_IMAGE_DIGEST` so the config/bundle publish only happens for a deploy whose image is already in the registry, and a failed image push no longer leaves a partially published deploy.
- `staging.yml` and the consumer workflows are unchanged: `bos deploy` still builds and pushes the image itself when no digest is provided, and child repos (no Dockerfile) degrade exactly as before.
